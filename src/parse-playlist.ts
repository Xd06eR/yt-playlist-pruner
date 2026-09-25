import type { ExtractResult, PlaylistItem } from './types'

/**
 * Walks any YouTube data blob (initial page state or a continuation response)
 * and collects playlist items plus the continuation token, if any. Two renderer
 * families are recognized: the classic playlistVideoRenderer and the newer
 * lockupViewModel (Liked Videos). A recursive walk is deliberate: YouTube nests
 * these renderers at varying depths depending on page layout, so anchoring on
 * a fixed path is the fragile option.
 */
export function extractItems(root: unknown): ExtractResult {
  const items: PlaylistItem[] = []
  const seen = new Set<string>()
  let continuationToken: string | null = null

  const collect = (item: PlaylistItem | null): void => {
    if (item && !seen.has(item.videoId)) {
      seen.add(item.videoId)
      items.push(item)
    }
  }

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    const obj = node as Record<string, unknown>

    const renderer = obj.playlistVideoRenderer
    if (isRecord(renderer)) collect(toPlaylistItem(renderer))

    const lockup = obj.lockupViewModel
    if (isRecord(lockup)) collect(fromLockup(lockup))

    const cont = obj.continuationItemRenderer
    if (isRecord(cont)) {
      const token = dig(cont, 'continuationEndpoint', 'continuationCommand', 'token')
      if (typeof token === 'string') continuationToken = token
    }

    for (const key of Object.keys(obj)) {
      if (key !== 'playlistVideoRenderer' && key !== 'lockupViewModel' && key !== 'continuationItemRenderer') walk(obj[key])
    }
  }

  walk(root)
  return { items, continuationToken }
}

function toPlaylistItem(renderer: Record<string, unknown>): PlaylistItem | null {
  const videoId = renderer.videoId
  if (typeof videoId !== 'string') return null
  const title = text(renderer.title) ?? '(untitled)'
  return {
    videoId,
    setVideoId: typeof renderer.setVideoId === 'string' ? renderer.setVideoId : undefined,
    title,
    channel: text(renderer.shortBylineText) ?? '',
    thumbnailUrl: lastThumbnail(renderer.thumbnail),
    unavailable: title === '[Private video]' || title === '[Deleted video]',
  }
}

/** New-layout item (Liked Videos): lockupViewModel carries the videoId as contentId. */
function fromLockup(node: Record<string, unknown>): PlaylistItem | null {
  // Only video lockups belong in a playlist; a present-but-other contentType
  // marks e.g. an embedded playlist card. Absent passes: field presence varies.
  if (typeof node.contentType === 'string' && node.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null
  const videoId = node.contentId
  if (typeof videoId !== 'string') return null
  const meta = dig(node, 'metadata', 'lockupMetadataViewModel')
  const title =
    isRecord(meta) && isRecord(meta.title) && typeof meta.title.content === 'string' ? meta.title.content : '(untitled)'
  return {
    videoId,
    title,
    channel: firstMetadataText(meta),
    thumbnailUrl: lastSourceUrl(dig(node, 'contentImage', 'thumbnailViewModel', 'image', 'sources')),
    unavailable: title === '[Private video]' || title === '[Deleted video]',
    unlikeIndex: findUnlikeIndex(node, videoId),
  }
}

/** First metadata part's text, where the lockup layout puts the channel name. */
function firstMetadataText(meta: unknown): string {
  const rows = dig(meta, 'metadata', 'contentMetadataViewModel', 'metadataRows')
  const first = Array.isArray(rows) ? (rows[0] as unknown) : undefined
  const part = isRecord(first) && Array.isArray(first.metadataParts) ? (first.metadataParts[0] as unknown) : undefined
  const content = isRecord(part) && isRecord(part.text) && typeof part.text.content === 'string' ? part.text.content : ''
  return content
}

/**
 * The lockup's serialized menu lives somewhere inside its subtree under a
 * container key that varies, so this walks for listItemViewModel nodes in
 * document order — the order the rendered menu's buttons follow. The action
 * must target this card's own video: a likeEndpoint aiming elsewhere belongs
 * to some other embedded menu, not this card's unlike action.
 */
function findUnlikeIndex(node: unknown, videoId: string): number | undefined {
  const menuItems: unknown[] = []
  const collect = (current: unknown): void => {
    if (!current || typeof current !== 'object') return
    if (Array.isArray(current)) {
      for (const child of current) collect(child)
      return
    }
    const obj = current as Record<string, unknown>
    if (isRecord(obj.listItemViewModel)) {
      menuItems.push(obj.listItemViewModel)
      return
    }
    for (const key of Object.keys(obj)) collect(obj[key])
  }
  collect(node)
  const found = menuItems.findIndex((item) => {
    const like = dig(item, 'rendererContext', 'commandContext', 'onTap', 'innertubeCommand', 'likeEndpoint')
    return isRecord(like) && like.status === 'INDIFFERENT' && dig(like, 'target', 'videoId') === videoId
  })
  return found >= 0 ? found : undefined
}

/** Reads {runs:[{text}...]} or {simpleText}. */
function text(node: unknown): string | null {
  if (!isRecord(node)) return null
  if (typeof node.simpleText === 'string') return node.simpleText
  if (Array.isArray(node.runs)) {
    const joined = node.runs
      .filter(isRecord)
      .map((run) => run.text)
      .filter((t): t is string => typeof t === 'string')
      .join('')
    return joined.length > 0 ? joined : null
  }
  return null
}

function lastThumbnail(node: unknown): string | undefined {
  if (!isRecord(node) || !Array.isArray(node.thumbnails) || node.thumbnails.length === 0) return undefined
  return lastSourceUrl(node.thumbnails)
}

/** Reads the last (widest) entry of an image sources array. */
function lastSourceUrl(sources: unknown): string | undefined {
  if (!Array.isArray(sources) || sources.length === 0) return undefined
  const last = sources[sources.length - 1]
  return isRecord(last) && typeof last.url === 'string' ? last.url : undefined
}

function dig(node: unknown, ...path: string[]): unknown {
  let cur: unknown = node
  for (const key of path) {
    if (!isRecord(cur)) return undefined
    cur = cur[key]
  }
  return cur
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
