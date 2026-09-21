import { extractItems } from './parse-playlist'
import { AbortRun } from './runner'
import { sapisidhash } from './sapisidhash'
import type { ExtractResult } from './types'

export interface InnertubeClient {
  context: unknown
  apiKey?: string
  origin: string
}

type Ytcfg = { data_?: Record<string, unknown>; get?: (key: string) => unknown }

declare global {
  interface Window {
    ytcfg?: Ytcfg
    ytInitialData?: unknown
  }
}

/** Reads the page's own InnerTube context; null when ytcfg has not loaded. */
export function getClient(): InnertubeClient | null {
  const cfg = window.ytcfg
  if (!cfg) return null
  const context = (cfg.get?.('INNERTUBE_CONTEXT') ?? cfg.data_?.['INNERTUBE_CONTEXT']) as unknown
  if (!context || typeof context !== 'object') return null
  const apiKey = cfg.get?.('INNERTUBE_API_KEY') ?? cfg.data_?.['INNERTUBE_API_KEY']
  return { context, apiKey: typeof apiKey === 'string' ? apiKey : undefined, origin: location.origin }
}

/** The session cookie backing SAPISIDHASH; present only while signed in. */
export function getSapisidCookie(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID)=([^;]+)/)
  return match?.[1] ?? null
}

export type FetchLike = typeof fetch

/** Injection points so the transport's abort classification is unit-testable. */
export interface TransportDeps {
  fetchImpl?: FetchLike
  getSapisid?: () => string | null
}

/** Fetches the next page of playlist items (one InnerTube browse continuation). */
export async function fetchContinuation(client: InnertubeClient, token: string, deps: TransportDeps = {}): Promise<ExtractResult> {
  const json = await post(client, '/youtubei/v1/browse', { context: client.context, continuation: token }, deps)
  return extractItems(json)
}

/**
 * Fetches a playlist's first page via browse. Pages that ship an empty initial
 * state fall back to this for enumeration.
 */
export async function fetchPlaylistPage(client: InnertubeClient, playlistId: string, deps: TransportDeps = {}): Promise<ExtractResult> {
  const json = await post(client, '/youtubei/v1/browse', { context: client.context, browseId: `VL${playlistId}` }, deps)
  return extractItems(json)
}

async function post(client: InnertubeClient, path: string, body: Record<string, unknown>, deps: TransportDeps): Promise<Record<string, unknown>> {
  const sapisid = (deps.getSapisid ?? getSapisidCookie)()
  if (!sapisid) throw new AbortRun('auth')

  // The page attaches a clickTracking block to every InnerTube request; the
  // base context from ytcfg omits it, and the server can reject without it.
  if (isRecord(body.context)) {
    body = { ...body, context: { clickTracking: { clickTrackingParams: '' }, ...body.context } }
  }

  const url = `https://www.youtube.com${path}${client.apiKey ? `?key=${client.apiKey}` : ''}`
  // X-Goog-AuthUser / X-Goog-Visitor-Id ride on the page's own requests; without
  // them the server can accept a mutation with 200 and silently not apply it.
  const visitorData = contextString(client.context, 'client', 'visitorData')
  const res = await (deps.fetchImpl ?? fetch)(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Authorization: await sapisidhash(sapisid, client.origin, Math.floor(Date.now() / 1000)),
      'X-Origin': client.origin,
      'X-Goog-AuthUser': '0',
      ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
    },
    body: JSON.stringify(body),
  })

  if (res.status === 401 || res.status === 403) throw new AbortRun('auth')
  if (res.status === 429) throw new AbortRun('rate')

  const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
  if (!res.ok || json?.error) {
    // Sent body + response side by side: when YouTube rejects a request this is
    // the diff surface (compare against the page's own request in DevTools).
    console.error('[yt-playlist-pruner] request rejected', { path, status: res.status, sent: body, response: json })
  }
  if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`)
  if (json?.error) throw new Error(json.error.message ?? 'InnerTube error')
  return (json ?? {}) as Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function contextString(node: unknown, ...path: string[]): string | undefined {
  let cur: unknown = node
  for (const key of path) {
    if (!isRecord(cur)) return undefined
    cur = cur[key]
  }
  return typeof cur === 'string' ? cur : undefined
}
