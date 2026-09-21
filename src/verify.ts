import { ROW_NOT_REMOVED } from './menu-drive'
import type { ItemResult } from './types'

export const SERVER_NOT_APPLIED = 'server did not apply the removal (video still in playlist)'

/**
 * One server fetch reconciles a run's results in both directions:
 * a claimed removal the server did not apply is downgraded to a failure,
 * and a row that merely lingered in the DOM is upgraded once the video
 * is confirmed gone server-side.
 */
export function reconcileRemovals(results: readonly ItemResult[], presentIds: ReadonlySet<string>): ItemResult[] {
  return results.map((result) => {
    if (result.status === 'removed' && presentIds.has(result.videoId)) {
      return { videoId: result.videoId, title: result.title, status: 'failed', reason: SERVER_NOT_APPLIED }
    }
    if (result.status === 'failed' && result.reason === ROW_NOT_REMOVED && !presentIds.has(result.videoId)) {
      return { videoId: result.videoId, title: result.title, status: 'removed' }
    }
    return result
  })
}
