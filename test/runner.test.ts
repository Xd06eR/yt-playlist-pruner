import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runRemoval, AbortRun } from '../src/runner'
import type { PlaylistItem } from '../src/types'

function items(n: number): PlaylistItem[] {
  return Array.from({ length: n }, (_, i) => ({
    videoId: `v${i + 1}`,
    title: `Video ${i + 1}`,
    channel: 'Chan',
    unavailable: false,
  }))
}

function rig(opts: {
  behavior?: (id: string) => Promise<void>
} = {}) {
  const calls: string[] = []
  const sleeps: number[] = []
  const removeVideo = async (item: PlaylistItem) => {
    calls.push(item.videoId)
    if (opts.behavior) await opts.behavior(item.videoId)
  }
  const sleep = async (ms: number) => {
    sleeps.push(ms)
  }
  return { calls, sleeps, removeVideo, sleep }
}

test('removes every item in order and reports no abort', async () => {
  const r = rig()
  const report = await runRemoval(items(3), { removeVideo: r.removeVideo, dryRun: false, sleep: r.sleep })
  assert.deepEqual(r.calls, ['v1', 'v2', 'v3'])
  assert.equal(report.aborted, null)
  assert.equal(report.dryRun, false)
  assert.deepEqual(
    report.results.map((x) => x.status),
    ['removed', 'removed', 'removed'],
  )
})

test('throttles between items but not before the first', async () => {
  const r = rig()
  await runRemoval(items(3), { removeVideo: r.removeVideo, dryRun: false, throttleMs: 400, sleep: r.sleep })
  assert.deepEqual(r.sleeps, [400, 400])
})

test('dry run touches no network and sleeps not at all', async () => {
  const r = rig()
  const report = await runRemoval(items(3), { removeVideo: r.removeVideo, dryRun: true, sleep: r.sleep })
  assert.deepEqual(r.calls, [])
  assert.deepEqual(r.sleeps, [])
  assert.equal(report.dryRun, true)
  assert.deepEqual(
    report.results.map((x) => x.status),
    ['would-remove', 'would-remove', 'would-remove'],
  )
})

test('a failed item is reported and the run continues', async () => {
  const r = rig({ behavior: async (id) => { if (id === 'v2') throw new Error('HTTP 400') } })
  const report = await runRemoval(items(3), { removeVideo: r.removeVideo, dryRun: false, sleep: r.sleep })
  assert.deepEqual(r.calls, ['v1', 'v2', 'v3'])
  assert.equal(report.aborted, null)
  assert.equal(report.results[1]!.status, 'failed')
  if (report.results[1]!.status === 'failed') assert.equal(report.results[1]!.reason, 'HTTP 400')
})

test('rate-limit abort stops the run and keeps prior results', async () => {
  const r = rig({ behavior: async (id) => { if (id === 'v3') throw new AbortRun('rate') } })
  const report = await runRemoval(items(4), { removeVideo: r.removeVideo, dryRun: false, sleep: r.sleep })
  assert.equal(report.aborted, 'rate')
  assert.equal(report.results.length, 2)
  assert.deepEqual(r.calls, ['v1', 'v2', 'v3'])
})

test('auth abort stops the run', async () => {
  const r = rig({ behavior: async (id) => { if (id === 'v1') throw new AbortRun('auth') } })
  const report = await runRemoval(items(3), { removeVideo: r.removeVideo, dryRun: false, sleep: r.sleep })
  assert.equal(report.aborted, 'auth')
  assert.equal(report.results.length, 0)
})

test('cancel hook aborts as user before the next item', async () => {
  const r = rig()
  let count = 0
  const report = await runRemoval(items(4), {
    removeVideo: r.removeVideo,
    dryRun: false,
    sleep: r.sleep,
    shouldContinue: () => (count++ < 1),
  })
  assert.equal(report.aborted, 'user')
  assert.deepEqual(r.calls, ['v1'])
})
