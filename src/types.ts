export interface PlaylistItem {
  videoId: string
  /** Present on Watch Later items; required by edit_playlist for those. */
  setVideoId?: string
  title: string
  channel: string
  thumbnailUrl?: string
  /** YouTube marks dead entries with the literal titles [Private video] / [Deleted video]. */
  unavailable: boolean
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
