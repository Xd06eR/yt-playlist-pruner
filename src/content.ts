import { fetchContinuation, getClient, getSapisidCookie, fetchPlaylistPage } from './innertube'
import { removeViaMenu, ROW_NOT_REMOVED } from './menu-drive'
import { extractItems } from './parse-playlist'
import { runRemoval } from './runner'
import { SelectionModel } from './selection'
import { clampIntervalMs, clampJitterPct, loadIntervalMs, loadJitterPct, saveIntervalMs, saveJitterPct } from './settings'
import { reconcileRemovals } from './verify'
import type { PlaylistItem } from './types'
import { confirmDialog, makeCheckbox, mountToolbar, reportDialog } from './ui'
import type { ToolbarHandle } from './ui'

/** Guard against runaway loops if YouTube keeps returning tokens. */
const MAX_CONTINUATIONS = 200

let playlistId: string | null = null
let items: PlaylistItem[] = []
/** Videos deleted this page session; rows may linger in the DOM, never re-admit them. */
let removedIds = new Set<string>()
let dryRun = false
/** Milliseconds between removals; user-tunable, persisted in localStorage. */
let intervalMs = loadIntervalMs()
/** Random jitter around each interval, in percent; user-tunable, persisted. */
let jitterPct = loadJitterPct()
let running = false
let cancelRequested = false
let toolbar: ToolbarHandle | null = null
let observer: MutationObserver | null = null
let initializedFor: string | null = null
/** Page layout this boot serves; decided by rendered rows, not the URL. */
let pageKind: 'classic' | 'lockup' = 'classic'
/** Lockup-only: the page-level layer checkboxes float in, clear of card DOM. */
let overlay: HTMLDivElement | null = null
const overlayBoxes = new Map<string, HTMLInputElement>()
let repositionFn: (() => void) | null = null
let repositionScheduled = false

const selection = new SelectionModel()

/** Menu-driven removal needs the rendered row; keep them mapped as they appear. */
const rowByVideoId = new Map<string, HTMLElement>()

function main(): void {
  const safeBoot = (): void => {
    boot().catch((error: unknown) => console.error('[yt-playlist-pruner] init failed:', error))
  }
  window.addEventListener('yt-navigate-finish', safeBoot)
  safeBoot()
}

async function boot(): Promise<void> {
  const id = new URLSearchParams(location.search).get('list')
  if (!id) {
    teardown() // navigated off playlist pages: no toolbar on watch pages
    return
  }
  if (id === initializedFor) return
  teardown()
  initializedFor = id
  playlistId = id
  removedIds = new Set()
  pageKind = detectPageKind()
  const loaded = await loadItems()
  if (initializedFor !== id) return // a newer navigation superseded this boot
  items = loaded
  selection.reset(items.map((i) => i.videoId))

  toolbar = mountToolbar({
    onSelectAll: () => {
      selection.selectAll()
      refresh()
    },
    onClear: () => {
      selection.clear()
      refresh()
    },
    onRemove: () => void run(),
    onCancel: () => {
      cancelRequested = true
    },
    onDryRunChange: (on) => {
      dryRun = on
    },
    onIntervalChange: (seconds) => {
      intervalMs = clampIntervalMs(seconds * 1000)
      saveIntervalMs(intervalMs)
      toolbar?.setIntervalMs(intervalMs)
    },
    onJitterChange: (pct) => {
      jitterPct = clampJitterPct(pct)
      saveJitterPct(jitterPct)
      toolbar?.setJitterPct(jitterPct)
    },
  })
  toolbar.setSelected(selection.size)
  toolbar.setIntervalMs(intervalMs)
  toolbar.setJitterPct(jitterPct)
  toolbar.setTotals(items.length)
  toolbar.setEnabled(Boolean(getClient() && getSapisidCookie()))
  if (!getSapisidCookie()) toolbar.setStatus('Sign in to YouTube to enable pruning')

  attachCheckboxes()
  observeRows()
  if (pageKind === 'lockup') addRepositionListeners()
}

/** Layout, not URL, decides: YouTube has served Liked Videos both ways. */
function detectPageKind(): 'classic' | 'lockup' {
  // Classic rows win when present: classic pages embed lockup-shaped
  // recommendation shelves below the list, which must not flip the page kind.
  if (document.querySelector('ytd-playlist-video-renderer')) return 'classic'
  if (document.querySelector('yt-lockup-view-model')) return 'lockup'
  // Cold loads can run before the grid stamps its rows; the page data cannot
  // lag: lockup items carry the serialized menu the classic family lacks.
  return extractItems(window.ytInitialData).items.some((item) => item.unlikeIndex !== undefined) ? 'lockup' : 'classic'
}

function teardown(): void {
  observer?.disconnect()
  observer = null
  toolbar?.root.remove()
  toolbar = null
  initializedFor = null
  removeRepositionListeners()
  overlay?.remove()
  overlay = null
  overlayBoxes.clear()
}

/** Initial page state first, then every continuation until the list is exhausted. */
async function loadItems(): Promise<PlaylistItem[]> {
  const collected: PlaylistItem[] = []
  const seen = new Set<string>()
  const push = (list: PlaylistItem[]): void => {
    for (const item of list) {
      if (!seen.has(item.videoId)) {
        seen.add(item.videoId)
        collected.push(item)
      }
    }
  }

  const first = extractItems(window.ytInitialData)
  push(first.items)

  let token = first.continuationToken
  const client = getClient()

  // The lockup layout ships no continuation token and its browse endpoint
  // returns an anonymous shell, so rows scrolled into view are the only
  // enumeration source there (the mutation observer picks them up).
  if (pageKind === 'classic') {
    // Pages that ship an empty initial state are enumerated through InnerTube's
    // browse endpoint instead.
    if (collected.length === 0 && !token && client && playlistId) {
      try {
        const browsed = await fetchPlaylistPage(client, playlistId)
        push(browsed.items)
        token = browsed.continuationToken
      } catch {
        // leave the list to the page's own lazy-load discovery
      }
    }
  }

  for (let page = 0; token && client && page < MAX_CONTINUATIONS; page++) {
    try {
      const next = await fetchContinuation(client, token)
      push(next.items)
      token = next.continuationToken
    } catch {
      break // partial list is still usable; the page itself lazy-loads the rest on scroll
    }
  }
  return collected
}

function observeRows(): void {
  const container = document.querySelector('ytd-playlist-video-list-renderer') ?? document.body
  let scheduled = false
  observer = new MutationObserver(() => {
    if (scheduled) return
    scheduled = true
    setTimeout(() => {
      scheduled = false
      attachCheckboxes()
    }, 100)
  })
  observer.observe(container, { childList: true, subtree: true })
}

function rowSelector(): string {
  return pageKind === 'lockup' ? 'yt-lockup-view-model' : 'ytd-playlist-video-renderer'
}

function addRepositionListeners(): void {
  repositionFn = () => scheduleReposition()
  window.addEventListener('scroll', repositionFn, { passive: true, capture: true })
  window.addEventListener('resize', repositionFn, { passive: true })
}

function removeRepositionListeners(): void {
  if (!repositionFn) return
  window.removeEventListener('scroll', repositionFn, { capture: true })
  window.removeEventListener('resize', repositionFn)
  repositionFn = null
}

function scheduleReposition(): void {
  if (repositionScheduled) return
  repositionScheduled = true
  requestAnimationFrame(() => {
    repositionScheduled = false
    positionOverlayBoxes()
  })
}

/** Overlay checkboxes track their cards; hidden when the card is gone or collapsed. */
function positionOverlayBoxes(): void {
  if (!overlay) return
  // Reads first, writes after: interleaving rect reads with style writes
  // forces a layout per box, which janks once the grid holds thousands.
  const placements: Array<[HTMLInputElement, { left: number; top: number }]> = []
  const drops: HTMLInputElement[] = []
  for (const [id, box] of overlayBoxes) {
    const row = rowByVideoId.get(id)
    if (!row || !row.isConnected || row.classList.contains('ypp-gone')) {
      drops.push(box)
      continue
    }
    const rect = row.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      drops.push(box)
      continue
    }
    placements.push([box, checkboxPlacement(row)])
  }
  for (const box of drops) box.hidden = true
  for (const [box, spot] of placements) {
    box.hidden = false
    // Write only on change: a scroll frame over thousands of cards should
    // not restyle boxes that did not move.
    const left = `${spot.left}px`
    const top = `${spot.top}px`
    if (box.style.left !== left) box.style.left = left
    if (box.style.top !== top) box.style.top = top
  }
}

/**
 * The checkbox floats in the gutter left of the thumbnail, level with its
 * top edge — the lockup equivalent of the classic row's index-column spot.
 */
function checkboxPlacement(row: HTMLElement): { left: number; top: number } {
  const image = row.querySelector('img')
  const base = (image as HTMLElement | null)?.getBoundingClientRect() ?? row.getBoundingClientRect()
  // Clamped so a narrow window cannot push the first column's boxes off-screen.
  return { left: Math.max(base.left - 42, 4), top: base.top - 2 }
}

function attachCheckboxes(): void {
  const known = new Set(items.map((i) => i.videoId))
  const rows = document.querySelectorAll<HTMLElement>(rowSelector())
  rows.forEach((row, index) => {
    const id = rowVideoId(row, index)
    if (!id || removedIds.has(id)) return

    // Rows the initial load missed (scroll-loaded lockups, a failed fetch)
    // join the selectable universe here, in DOM order.
    if (!known.has(id)) {
      const found = itemFromRow(row, id)
      if (!found) return // nothing trustworthy to select against
      items.push(found)
      known.add(id)
      selection.reset(items.map((i) => i.videoId))
    }

    rowByVideoId.set(id, row)

    let box = checkboxFor(id, row)
    if (!box) {
      box = makeCheckbox(selection.has(id))
      box.dataset.videoid = id
      box.addEventListener('click', (event) => {
        // Keep the click from reaching the card's navigation handler; no
        // preventDefault, so the checkbox still toggles natively.
        event.stopPropagation()
        const input = event.currentTarget as HTMLInputElement
        selection.onCheckbox(id, input.checked, event.shiftKey)
        refresh()
      })
      mountCheckbox(box, row, id)
    } else {
      box.checked = selection.has(id)
    }
  })
  toolbar?.setTotals(items.length)
  if (pageKind === 'lockup') scheduleReposition()
}

function checkboxFor(id: string, row: HTMLElement): HTMLInputElement | null {
  if (pageKind === 'lockup') return overlayBoxes.get(id) ?? null
  return row.querySelector<HTMLInputElement>('input.ypp-check')
}

function mountCheckbox(box: HTMLInputElement, row: HTMLElement, id: string): void {
  if (pageKind === 'lockup') {
    // Never touch the card's DOM (its overlays re-anchor and corrupt): the
    // checkbox floats in a page-level layer beside the card's ⋮ button.
    if (!overlay) overlay = ensureOverlay()
    const spot = checkboxPlacement(row)
    box.style.left = `${spot.left}px`
    box.style.top = `${spot.top}px`
    overlay.appendChild(box)
    overlayBoxes.set(id, box)
  } else {
    row.classList.add('ypp-row')
    row.appendChild(box)
  }
}

function ensureOverlay(): HTMLDivElement {
  const layer = document.createElement('div')
  layer.className = 'ypp-overlay'
  document.body.appendChild(layer)
  return layer
}

function itemFromRow(row: HTMLElement, id: string): PlaylistItem | null {
  if (pageKind === 'lockup') return lockupItemFromRow(row, id)
  const data = (row as unknown as { data?: Record<string, unknown> }).data
  return data ? (extractItems({ playlistVideoRenderer: data }).items[0] ?? null) : null
}

/**
 * Scroll-loaded lockup cards carry no page-data mirror on the element, so the
 * rendered metadata is the only source: first line the title, second the
 * channel.
 */
function lockupItemFromRow(row: HTMLElement, videoId: string): PlaylistItem | null {
  const meta = row.querySelector('yt-lockup-metadata-view-model')
  if (!meta) return null
  const lines = (meta.textContent ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const title = lines[0] ?? ''
  if (!title) return null
  return {
    videoId,
    title,
    channel: lines[1] ?? '',
    unavailable: title === '[Private video]' || title === '[Deleted video]',
  }
}

/** Prefer the row's own identity (renderer data, content-id class); then positional mapping. */
function rowVideoId(row: HTMLElement, index: number): string | null {
  if (pageKind === 'lockup') {
    const host = (row.querySelector('.ytLockupViewModelHost') ?? row) as HTMLElement
    const match = host.className.match(/content-id-([\w-]+)/) ?? row.className.match(/content-id-([\w-]+)/)
    if (match) return match[1] ?? null
  }
  const data = (row as unknown as { data?: { videoId?: string } }).data
  return data?.videoId ?? items[index]?.videoId ?? null
}

function refresh(): void {
  const inItems = new Set(items.map((i) => i.videoId))
  for (const box of document.querySelectorAll<HTMLInputElement>('input.ypp-check')) {
    const id = box.dataset.videoid
    if (!id) continue
    box.checked = selection.has(id)
    // The page occasionally leaves a removed row in the DOM (stale render);
    // rows whose video left the list are hidden here. Overlay checkboxes are
    // not row children, so the row comes from the registry.
    rowByVideoId.get(id)?.classList.toggle('ypp-gone', !inItems.has(id))
  }
  toolbar?.setSelected(items.filter((i) => selection.has(i.videoId)).length)
  if (pageKind === 'lockup') scheduleReposition() // hiding a card reflows the grid
}

async function run(): Promise<void> {
  if (running || !toolbar) return
  const chosen = items.filter((i) => selection.has(i.videoId))
  if (chosen.length === 0) return

  if (!dryRun) {
    const confirmed = await confirmDialog(chosen.length, chosen.map((i) => i.title))
    if (!confirmed || running) return // re-check after the await: no parallel runs
  }

  // Menu-driven removal acts on rendered rows only: warn before starting a run
  // that would hit unrendered videos.
  if (!dryRun) {
    const missing = chosen.filter((i) => !rowByVideoId.get(i.videoId)?.isConnected)
    if (missing.length > 0) {
      toolbar.setStatus(
        `${missing.length} selected row${missing.length === 1 ? '' : 's'} not loaded — scroll through the playlist to render ${missing.length === 1 ? 'it' : 'them'} first`,
      )
      return
    }
  }

  running = true
  cancelRequested = false
  let done = 0
  toolbar.setRunning(0, chosen.length, false)
  overlay?.classList.add('ypp-hidden') // checkboxes must not float over open menus

  const client = getClient()
  const report = await runRemoval(chosen, {
    dryRun,
    removeVideo: (item) => {
      const row = rowByVideoId.get(item.videoId)
      if (!row || !row.isConnected) return Promise.reject(new Error('row is not rendered'))
      return removeViaMenu(row, 0, item.unlikeIndex, pageKind === 'lockup' ? 'request' : 'row').finally(() => {
        done++
        toolbar?.setRunning(done, chosen.length, cancelRequested)
      })
    },
    throttleMs: intervalMs,
    // Each interval gets random ±jitter%: a metronome-exact pace reads automated.
    sleep: (ms) => {
      const spread = jitterPct / 100
      const factor = 1 - spread + Math.random() * 2 * spread
      return new Promise<void>((resolve) => setTimeout(resolve, ms * factor))
    },
    shouldContinue: () => !cancelRequested,
  })

  running = false
  toolbar.clearRunning()
  overlay?.classList.remove('ypp-hidden')

  // A success claim is not proof, and a lingering row is not proof of failure:
  // one reconciliation pass sorts both directions before the report speaks.
  // The lockup list skips it: its grid keeps unliked cards on screen, so the
  // page's completed removelike request (see removeViaMenu) is the receipt.
  if (!report.dryRun && report.aborted === null) {
    if (pageKind === 'classic' && client && playlistId) {
      const claimed = report.results.some((r) => r.status === 'removed')
      const lingering = report.results.some((r) => r.status === 'failed' && r.reason === ROW_NOT_REMOVED)
      if (claimed || lingering) {
        try {
          const page = await fetchPlaylistPage(client, playlistId)
          report.results = reconcileRemovals(report.results, new Set(page.items.map((i) => i.videoId)))
        } catch {
          // verification fetch failed: keep results as reported
        }
      }
    }
    const verified = new Set(report.results.filter((r) => r.status === 'removed').map((r) => r.videoId))
    for (const id of verified) removedIds.add(id)
    items = items.filter((i) => !verified.has(i.videoId))
    selection.reset(items.map((i) => i.videoId))
    toolbar.setTotals(items.length)
  }

  const clean = report.aborted === null && report.results.every((r) => r.status !== 'failed')
  reportDialog(
    report,
    !report.dryRun && !clean,
    !report.dryRun && pageKind === 'lockup'
      ? "Liked Videos keeps removed cards on screen; this report counts removals confirmed by the page's own completed request — reload to see the list settle."
      : undefined,
  )
  refresh()
}

main()
