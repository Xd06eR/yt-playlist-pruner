import { THROTTLE_BASE_MS } from './runner'

const INTERVAL_KEY = 'yt-playlist-pruner:interval-ms'
const JITTER_KEY = 'yt-playlist-pruner:jitter-pct'

export const MIN_INTERVAL_MS = 1000
export const MAX_INTERVAL_MS = 10000

export const DEFAULT_JITTER_PCT = 20
export const MAX_JITTER_PCT = 50

/** Clamps a requested interval to the safe band; garbage falls back to the default. */
export function clampIntervalMs(ms: number): number {
  if (!Number.isFinite(ms)) return THROTTLE_BASE_MS
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(ms)))
}

/** Clamps a requested jitter to 0-50%; garbage falls back to the default. */
export function clampJitterPct(pct: number): number {
  if (!Number.isFinite(pct)) return DEFAULT_JITTER_PCT
  return Math.min(MAX_JITTER_PCT, Math.max(0, Math.round(pct)))
}

export function loadIntervalMs(): number {
  const raw = localStorage.getItem(INTERVAL_KEY)
  if (raw === null) return THROTTLE_BASE_MS
  return clampIntervalMs(Number(raw))
}

export function saveIntervalMs(ms: number): void {
  localStorage.setItem(INTERVAL_KEY, String(clampIntervalMs(ms)))
}

export function loadJitterPct(): number {
  const raw = localStorage.getItem(JITTER_KEY)
  if (raw === null) return DEFAULT_JITTER_PCT
  return clampJitterPct(Number(raw))
}

export function saveJitterPct(pct: number): void {
  localStorage.setItem(JITTER_KEY, String(clampJitterPct(pct)))
}
