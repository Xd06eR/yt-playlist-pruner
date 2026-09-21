import type { ExtractResult, PlaylistItem } from './types'

/**
 * Walks any YouTube data blob (initial page state or a continuation response)
 * and collects playlist items plus the continuation token, if any, from
 * playlistVideoRenderer nodes. A recursive walk is deliberate: YouTube nests
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

    const cont = obj.continuationItemRenderer
    if (isRecord(cont)) {
      const token = dig(cont, 'continuationEndpoint', 'continuationCommand', 'token')
      if (typeof token === 'string') continuationToken = token
    }

    for (const key of Object.keys(obj)) {
      if (key !== 'playlistVideoRenderer' && key !== 'continuationItemRenderer') walk(obj[key])
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
