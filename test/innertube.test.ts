import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchContinuation, fetchPlaylistPage } from '../src/innertube'
import { AbortRun } from '../src/runner'
import type { InnertubeClient } from '../src/innertube'

const client: InnertubeClient = { context: { client: { clientName: 'WEB' } }, origin: 'https://www.youtube.com' }

function fakeFetch(status: number, body: unknown = {}): typeof fetch {
  return (async () => ({ status, ok: status >= 200 && status < 300, json: async () => body })) as unknown as typeof fetch
}

function recordingFetch(status = 200): { fetchImpl: typeof fetch; calls: { url: string; body: Record<string, unknown> }[] } {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    return { status, ok: true, json: async () => ({}) }
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

for (const status of [401, 403]) {
  test(`HTTP ${status} classifies as an auth abort`, async () => {
    await assert.rejects(
      fetchContinuation(client, 'TOK', { fetchImpl: fakeFetch(status), getSapisid: () => 'sid' }),
      (e: unknown) => e instanceof AbortRun && e.kind === 'auth',
    )
  })
}

test('HTTP 429 classifies as a rate abort', async () => {
  await assert.rejects(
    fetchContinuation(client, 'TOK', { fetchImpl: fakeFetch(429), getSapisid: () => 'sid' }),
    (e: unknown) => e instanceof AbortRun && e.kind === 'rate',
  )
})

test('missing SAPISID aborts as auth before any request goes out', async () => {
  const { fetchImpl, calls } = recordingFetch()
  await assert.rejects(
    fetchContinuation(client, 'TOK', { fetchImpl, getSapisid: () => null }),
    (e: unknown) => e instanceof AbortRun && e.kind === 'auth',
  )
  assert.equal(calls.length, 0)
})

test('non-ok response without an error body surfaces the HTTP status', async (t) => {
  t.mock.method(console, 'error', () => {})
  await assert.rejects(
    fetchContinuation(client, 'TOK', { fetchImpl: fakeFetch(500), getSapisid: () => 'sid' }),
    /HTTP 500/,
  )
})

test('playlist browse fallback sends a VL-prefixed browseId', async () => {
  const { fetchImpl, calls } = recordingFetch()
  await fetchPlaylistPage(client, 'LL', { fetchImpl, getSapisid: () => 'sid' })
  assert.equal(calls.length, 1)
  assert.match(calls[0]!.url, /\/youtubei\/v1\/browse$/)
  assert.equal((calls[0]!.body as { browseId?: string }).browseId, 'VLLL')
})

test('requests carry the clickTracking block the page normally attaches', async () => {
  const { fetchImpl, calls } = recordingFetch()
  await fetchContinuation(client, 'TOK', { fetchImpl, getSapisid: () => 'sid' })
  const ctx = calls[0]!.body.context as { clickTracking?: unknown; client?: unknown }
  assert.deepEqual(ctx.clickTracking, { clickTrackingParams: '' })
  assert.deepEqual(ctx.client, { clientName: 'WEB' })
})
