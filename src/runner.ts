import type { ItemResult, PlaylistItem, RunReport } from './types'

/** Thrown from a removal's receipt when the run must stop: 401/403 (signed out) or 429 (rate limit). */
export class AbortRun extends Error {
  constructor(public readonly kind: 'auth' | 'rate') {
    super(`aborted: ${kind}`)
  }
}

export interface RemoveVideoFn {
  (item: PlaylistItem): Promise<void>
}

export interface RunOptions {
  removeVideo: RemoveVideoFn
  dryRun: boolean
  /** Pause between deletions; YouTube-side rate limits are the ceiling, not politeness. */
  throttleMs?: number
  sleep?: (ms: number) => Promise<void>
  /** Polled before each item; return false to cancel. */
  shouldContinue?: () => boolean
}

/** Human-pace default: one removal request roughly every 2.5 seconds. */
export const THROTTLE_BASE_MS = 2500

/**
 * Deletes the given items one by one, throttled. Dry runs touch nothing.
 * A failing item is recorded and the run continues; only auth/rate aborts
 * (thrown as AbortRun) and the cancel hook stop the run.
 */
export async function runRemoval(items: PlaylistItem[], opts: RunOptions): Promise<RunReport> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const throttleMs = opts.throttleMs ?? THROTTLE_BASE_MS
  const results: ItemResult[] = []

  for (const [index, item] of items.entries()) {
    if (opts.shouldContinue && !opts.shouldContinue()) {
      return { dryRun: opts.dryRun, results, aborted: 'user' }
    }
    if (index > 0 && !opts.dryRun) await sleep(throttleMs)

    if (opts.dryRun) {
      results.push({ videoId: item.videoId, title: item.title, status: 'would-remove' })
      continue
    }

    try {
      await opts.removeVideo(item)
      results.push({ videoId: item.videoId, title: item.title, status: 'removed' })
    } catch (error) {
      if (error instanceof AbortRun) {
        return { dryRun: false, results, aborted: error.kind }
      }
      results.push({
        videoId: item.videoId,
        title: item.title,
        status: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { dryRun: opts.dryRun, results, aborted: null }
}
