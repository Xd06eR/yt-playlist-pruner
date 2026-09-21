import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRemoveMenuItem } from '../src/menu-drive'

test('menu items carrying an explicit remove action are removal actions', () => {
  assert.equal(
    isRemoveMenuItem({
      serviceEndpoint: { playlistEditEndpoint: { playlistId: 'WL', actions: [{ action: 'ACTION_REMOVE_VIDEO', setVideoId: 'S1' }] } },
    }),
    true,
  )
})

test('the save-to-playlist item (add actions) is NOT a removal', () => {
  assert.equal(
    isRemoveMenuItem({
      serviceEndpoint: { playlistEditEndpoint: { playlistId: 'PL1', actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: 'v1' }] } },
    }),
    false,
  )
})

test('an edit endpoint with no actions is not a removal', () => {
  assert.equal(isRemoveMenuItem({ serviceEndpoint: { playlistEditEndpoint: { playlistId: 'WL' } } }), false)
})

test('non-removal menu items are rejected', () => {
  assert.equal(isRemoveMenuItem({ serviceEndpoint: { shareEntityServiceEndpoint: {} } }), false)
  assert.equal(isRemoveMenuItem({ text: { runs: [{ text: 'Save to playlist' }] } }), false)
})

test('missing or malformed items are rejected', () => {
  assert.equal(isRemoveMenuItem(null), false)
  assert.equal(isRemoveMenuItem(undefined), false)
  assert.equal(isRemoveMenuItem('remove'), false)
  assert.equal(isRemoveMenuItem({ serviceEndpoint: 'not-an-object' }), false)
})
