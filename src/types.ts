export interface PlaylistItem {
  videoId: string
  /** Present on Watch Later entries in the page data. */
  setVideoId?: string
  title: string
  channel: string
  thumbnailUrl?: string
  /** YouTube marks dead entries with the literal titles [Private video] / [Deleted video]. */
  unavailable: boolean
  /**
   * Lockup (Liked Videos) items only: index of the remove-from-Liked-Videos
   * action in the card's serialized menu, matching the rendered menu's button
   * order. Absent when the page data carries no such action.
   */
  unlikeIndex?: number
}

export interface ExtractResult {
  items: PlaylistItem[]
  continuationToken: string | null
}

export type ItemResult =
  | { videoId: string; title: string; status: 'removed' }
  | { videoId: string; title: string; status: 'would-remove' }
  | { videoId: string; title: string; status: 'failed'; reason: string }

export type AbortKind = 'auth' | 'rate' | 'user'

export interface RunReport {
  dryRun: boolean
  results: ItemResult[]
  aborted: AbortKind | null
}
