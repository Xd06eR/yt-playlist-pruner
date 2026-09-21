import { THROTTLE_BASE_MS } from './runner'

const STORAGE_KEY = 'yt-playlist-pruner:interval-ms'

export const MIN_INTERVAL_MS = 1000
export const MAX_INTERVAL_MS = 10000

/** Clamps a requested interval to the safe band; garbage falls back to the default. */
export function clampIntervalMs(ms: number): number {
  if (!Number.isFinite(ms)) return THROTTLE_BASE_MS
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(ms)))
}

export function loadIntervalMs(): number {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw === null) return THROTTLE_BASE_MS
  return clampIntervalMs(Number(raw))
}

export function saveIntervalMs(ms: number): void {
  localStorage.setItem(STORAGE_KEY, String(clampIntervalMs(ms)))
}
