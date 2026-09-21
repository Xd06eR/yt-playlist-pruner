import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampIntervalMs, loadIntervalMs, MAX_INTERVAL_MS, MIN_INTERVAL_MS, saveIntervalMs } from '../src/settings'
import { THROTTLE_BASE_MS } from '../src/runner'

function stubStorage(initial: Record<string, string> = {}): { store: Map<string, string> } {
  const store = new Map(Object.entries(initial))
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  } as unknown as Storage
  return { store }
}

test('clamps intervals into the 1-10 second band', () => {
  assert.equal(clampIntervalMs(2500), 2500)
  assert.equal(clampIntervalMs(100), MIN_INTERVAL_MS)
  assert.equal(clampIntervalMs(999999), MAX_INTERVAL_MS)
  assert.equal(clampIntervalMs(1234.6), 1235)
})

test('garbage falls back to the default', () => {
  assert.equal(clampIntervalMs(Number.NaN), THROTTLE_BASE_MS)
})

test('loads the stored interval, clamped', () => {
  stubStorage({ 'yt-playlist-pruner:interval-ms': '4000' })
  assert.equal(loadIntervalMs(), 4000)
  stubStorage({ 'yt-playlist-pruner:interval-ms': '50' })
  assert.equal(loadIntervalMs(), 1000)
})

test('missing or garbage storage falls back to the default', () => {
  stubStorage()
  assert.equal(loadIntervalMs(), THROTTLE_BASE_MS)
  stubStorage({ 'yt-playlist-pruner:interval-ms': 'quick' })
  assert.equal(loadIntervalMs(), THROTTLE_BASE_MS)
})

test('saving clamps and persists the raw string', () => {
  const { store } = stubStorage()
  saveIntervalMs(99999)
  assert.equal(store.get('yt-playlist-pruner:interval-ms'), '10000')
})
