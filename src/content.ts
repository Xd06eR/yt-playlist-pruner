import { getSapisidCookie, pageReady } from './innertube'
import { removeViaMenu } from './menu-drive'
import { extractItems } from './parse-playlist'
import { runRemoval } from './runner'
import { SelectionModel } from './selection'
import { clampIntervalMs, clampJitterPct, loadIntervalMs, loadJitterPct, saveIntervalMs, saveJitterPct } from './settings'
import type { PlaylistItem } from './types'
import { confirmDialog, makeCheckbox, mountToolbar, reportDialog } from './ui'
import type { ToolbarHandle } from './ui'

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
    try {
      boot()
    } catch (error: unknown) {
      console.error('[yt-playlist-pruner] init failed:', error)
    }
  }
  window.addEventListener('yt-navigate-finish', safeBoot)
  safeBoot()
}

function boot(): void {
  const id = new URLSearchParams(location.search).get('list')
  if (!id) {
    teardown() // navigated off playlist pages: no toolbar on watch pages
    return
  }
  if (id === initializedFor) return
  teardown()
  initializedFor = id
  removedIds = new Set()
  pageKind = detectPageKind()
  items = loadItems()
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
  toolbar.setEnabled(Boolean(pageReady() && getSapisidCookie()))
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

/**
 * The page's initial state is the whole enumerable data source: the server
 * answers self-built reads with an anonymous shell, so anything beyond the
 * first batch joins only as rendered rows, through scroll discovery.
 */
function loadItems(): PlaylistItem[] {
  return extractItems(window.ytInitialData).items
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
  const rows = [...document.querySelectorAll<HTMLElement>(rowSelector())]
  const domIds: string[] = []
  for (const row of rows) {
    const id = rowVideoId(row)
    if (!id || removedIds.has(id)) continue

    // Rows the initial load missed (unavailable videos toggled on,
    // scroll-loaded lockups) join the selectable universe here.
    if (!known.has(id)) {
      const found = itemFromRow(row, id)
      if (!found) continue // nothing trustworthy to select against
      items.push(found)
      known.add(id)
    }

    domIds.push(id)
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
        // dataset, not a captured id: the box may have been rebound since.
        const currentId = input.dataset.videoid
        if (currentId) selection.onCheckbox(currentId, input.checked, event.shiftKey)
        refresh()
      })
      mountCheckbox(box, row, id)
    } else {
      // dom-repeat recycles row elements when the page inserts rows (the
      // unavailable-videos toggle): a box can outlive its element's binding
      // to a video, so re-check the binding on every pass.
      const staleId = box.dataset.videoid
      if (staleId !== id) {
        if (staleId && rowByVideoId.get(staleId) === row) rowByVideoId.delete(staleId)
        box.dataset.videoid = id
      }
      box.checked = selection.has(id)
    }
  }

  // Late-discovered rows (unavailable videos, scroll batches) would otherwise
  // pile up at the end of `items` while sitting mid-list on screen; shift
  // ranges slice `items` order, so it must match the DOM the user sees.
  // Items without a rendered row keep their tail positions.
  const uniqueDomIds = [...new Set(domIds)]
  if (uniqueDomIds.length > 0) {
    const domSet = new Set(uniqueDomIds)
    const byId = new Map(items.map((item) => [item.videoId, item]))
    const ordered = uniqueDomIds.flatMap((id) => {
      const item = byId.get(id)
      return item ? [item] : []
    })
    for (const item of items) if (!domSet.has(item.videoId)) ordered.push(item)
    items = ordered
    selection.reset(items.map((i) => i.videoId))
  }

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

/**
 * The row's own identity only — renderer data on classic rows, the content-id
 * class on lockups. Never map by DOM position: the page inserts rows (the
 * "show unavailable videos" toggle) whose data binds after insertion, and a
 * positional lookup at that instant binds a neighbor's id to the checkbox
 * forever. A row not yet carrying its id simply joins on a later pass.
 */
function rowVideoId(row: HTMLElement): string | null {
  if (pageKind === 'lockup') {
    const host = (row.querySelector('.ytLockupViewModelHost') ?? row) as HTMLElement
    const match = host.className.match(/content-id-([\w-]+)/) ?? row.className.match(/content-id-([\w-]+)/)
    return match?.[1] ?? null
  }
  const data = (row as unknown as { data?: { videoId?: string } }).data
  return data?.videoId ?? null
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

  // Receipts are per item — the page drops the row, or on the lockup layout
  // the page's own request completes — and no post-run server re-check exists:
  // the browse family answers anonymous shells, so a lingering card stays
  // visible until reload.
  if (!report.dryRun && report.aborted === null) {
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
