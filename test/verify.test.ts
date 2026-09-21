import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconcileRemovals, SERVER_NOT_APPLIED } from '../src/verify'
import { ROW_NOT_REMOVED } from '../src/menu-drive'
import type { ItemResult } from '../src/types'

const removed: ItemResult = { videoId: 'a', title: 'A', status: 'removed' }
const lingered: ItemResult = { videoId: 'b', title: 'B', status: 'failed', reason: ROW_NOT_REMOVED }
const other: ItemResult = { videoId: 'c', title: 'C', status: 'failed', reason: 'row is not rendered' }

test('a claimed removal still present server-side is downgraded', () => {
  const [first] = reconcileRemovals([removed], new Set(['a']))
  assert.equal(first!.status, 'failed')
  if (first!.status === 'failed') assert.equal(first!.reason, SERVER_NOT_APPLIED)
})

test('a lingering row whose video is gone server-side is upgraded', () => {
  const [first] = reconcileRemovals([lingered], new Set(['z']))
  assert.equal(first!.status, 'removed')
})

test('a lingering row whose video is still there stays failed', () => {
  const [first] = reconcileRemovals([lingered], new Set(['b']))
  assert.equal(first!.status, 'failed')
  if (first!.status === 'failed') assert.equal(first!.reason, ROW_NOT_REMOVED)
})

test('unrelated failures and clean removals pass through untouched', () => {
  const results = reconcileRemovals([removed, other], new Set(['z']))
  assert.deepEqual(results[0], removed)
  assert.deepEqual(results[1], other)
})
