import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { sapisidhash } from '../src/sapisidhash'

test('matches SHA-1 of "<ts> <sapisid> <origin>" with SAPISIDHASH prefix', async () => {
  const ts = 1700000000
  const sid = 'TEST-SAPISID-abc123'
  const origin = 'https://www.youtube.com'
  const expected = createHash('sha1').update(`${ts} ${sid} ${origin}`).digest('hex')
  const got = await sapisidhash(sid, origin, ts)
  assert.equal(got, `SAPISIDHASH ${expected}`)
})

test('format is "SAPISIDHASH <40 lowercase hex chars>"', async () => {
  const got = await sapisidhash('sid', 'https://www.youtube.com', 123)
  const parts = got.split(' ')
  assert.equal(parts.length, 2)
  assert.equal(parts[0], 'SAPISIDHASH')
  assert.match(parts[1]!, /^[0-9a-f]{40}$/)
})
