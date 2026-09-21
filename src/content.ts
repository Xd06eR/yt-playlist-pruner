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
/** Seconds between removals; user-tunable, persisted in localStorage. */
let intervalMs = loadIntervalMs()
/** Random jitter around each interval, in percent; user-tunable, persisted. */
let jitterPct = loadJitterPct()
let running = false
let cancelRequested = false
let toolbar: ToolbarHandle | null = null
let observer: MutationObserver | null = null
let initializedFor: string | null = null

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
}

function teardown(): void {
  observer?.disconnect()
  observer = null
  toolbar?.root.remove()
  toolbar = null
  initializedFor = null
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

const ROW_SELECTOR = 'ytd-playlist-video-renderer'

function attachCheckboxes(): void {
  const known = new Set(items.map((i) => i.videoId))
  const rows = document.querySelectorAll<HTMLElement>(ROW_SELECTOR)
  rows.forEach((row, index) => {
    const id = rowVideoId(row, index)
    if (!id || removedIds.has(id)) return

    // Rows the initial load missed (a failed fetch) join the selectable
    // universe here, in DOM order.
    if (!known.has(id)) {
      const data = (row as unknown as { data?: Record<string, unknown> }).data
      const found = data ? extractItems({ playlistVideoRenderer: data }).items[0] : null
      if (!found) return // nothing trustworthy to select against
      items.push(found)
      known.add(id)
      selection.reset(items.map((i) => i.videoId))
    }

    rowByVideoId.set(id, row)

    let box = row.querySelector<HTMLInputElement>('input.ypp-check')
    if (!box) {
      row.classList.add('ypp-row')
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
      row.appendChild(box)
    } else {
      box.checked = selection.has(id)
    }
  })
  toolbar?.setTotals(items.length)
}

/** Prefer the renderer's own data (MAIN world); then positional mapping. */
function rowVideoId(row: HTMLElement, index: number): string | null {
  const data = (row as unknown as { data?: { videoId?: string } }).data
  return data?.videoId ?? items[index]?.videoId ?? null
}

function refresh(): void {
  const inItems = new Set(items.map((i) => i.videoId))
  for (const box of document.querySelectorAll<HTMLInputElement>('input.ypp-check')) {
    const id = box.dataset.videoid
    if (!id) continue
    box.checked = selection.has(id)
    // Rows we no longer know (already removed) leave the page: direct deletes
    // bypass YouTube's own render pipeline, so hide them here.
    box.closest(ROW_SELECTOR)?.classList.toggle('ypp-gone', !inItems.has(id))
  }
  toolbar?.setSelected(items.filter((i) => selection.has(i.videoId)).length)
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

  const client = getClient()
  const report = await runRemoval(chosen, {
    dryRun,
    removeVideo: (item) => {
      const row = rowByVideoId.get(item.videoId)
      if (!row || !row.isConnected) return Promise.reject(new Error('row is not rendered'))
      return removeViaMenu(row).finally(() => {
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

  // A success claim is not proof, and a lingering row is not proof of failure:
  // one server fetch reconciles both directions before the report speaks.
  if (!report.dryRun && report.aborted === null) {
    const claimed = report.results.some((r) => r.status === 'removed')
    const lingering = report.results.some((r) => r.status === 'failed' && r.reason === ROW_NOT_REMOVED)
    if ((claimed || lingering) && client && playlistId) {
      try {
        const page = await fetchPlaylistPage(client, playlistId)
        report.results = reconcileRemovals(report.results, new Set(page.items.map((i) => i.videoId)))
      } catch {
        // verification fetch failed: keep results as reported
      }
    }
    const verified = new Set(report.results.filter((r) => r.status === 'removed').map((r) => r.videoId))
    for (const id of verified) removedIds.add(id)
    items = items.filter((i) => !verified.has(i.videoId))
    selection.reset(items.map((i) => i.videoId))
    toolbar.setTotals(items.length)
  }

  const clean = report.aborted === null && report.results.every((r) => r.status !== 'failed')
  reportDialog(report, !report.dryRun && !clean)
  refresh()
}

main()
