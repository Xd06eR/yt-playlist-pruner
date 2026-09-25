/**
 * Page-context glue only. The self-built InnerTube transport (browse,
 * continuations, SAPISIDHASH) is gone: the server answers that whole request
 * family with an anonymous `loggedOut: true` shell (verified on VLLL,
 * VL playlists, and continuations), so the page's initial data and rendered
 * rows are the only live read sources.
 */

type Ytcfg = { data_?: Record<string, unknown>; get?: (key: string) => unknown }

declare global {
  interface Window {
    ytcfg?: Ytcfg
    ytInitialData?: unknown
  }
}

/** The page's own InnerTube context has loaded; false when ytcfg has not booted. */
export function pageReady(): boolean {
  const cfg = window.ytcfg
  if (!cfg) return false
  const context = (cfg.get?.('INNERTUBE_CONTEXT') ?? cfg.data_?.['INNERTUBE_CONTEXT']) as unknown
  return Boolean(context && typeof context === 'object')
}

/** The session cookie backing a signed-in page; null when signed out. */
export function getSapisidCookie(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID)=([^;]+)/)
  return match?.[1] ?? null
}
