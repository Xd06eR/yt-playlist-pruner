import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chooseRemovalIndex, findUnlikeRequest, isRemoveMenuItem } from '../src/menu-drive'

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

/** Item texts as the rendered lockup menu offers them (zh-HK live capture). */
const lockupMenuTexts = ['加入序列', '儲存至「稍後觀看」清單', '儲存至播放清單', '下載', '分享', '已從喜歡的影片中移除']

test('chooseRemovalIndex trusts the serialized unlike index when its item still reads as a removal', () => {
  assert.equal(chooseRemovalIndex(lockupMenuTexts, 5), 5)
})

test('chooseRemovalIndex falls back to the first removal-looking text when the index misses', () => {
  assert.equal(chooseRemovalIndex(lockupMenuTexts, 99), 5)
  assert.equal(chooseRemovalIndex(lockupMenuTexts, 1), 5)
  assert.equal(chooseRemovalIndex(lockupMenuTexts), 5)
})

test('chooseRemovalIndex recognizes the English remove label', () => {
  assert.equal(chooseRemovalIndex(['Add to queue', 'Save to Watch Later', 'Save to playlist', 'Download', 'Share', 'Remove from Liked videos'], 5), 5)
})

test('chooseRemovalIndex returns null when no item reads as a removal', () => {
  assert.equal(chooseRemovalIndex(['加入序列', '分享']), null)
  assert.equal(chooseRemovalIndex(['加入序列', '分享'], 1), null)
})

/** Minimal resource-timing entry shape findUnlikeRequest reads. */
const entry = (name: string, startTime: number, responseStatus?: number) => ({ name, startTime, responseStatus })

test('findUnlikeRequest matches the unlike request fired after the mark, with its status', () => {
  const entries = [
    entry('https://www.youtube.com/youtubei/v1/browse?key=x', 10),
    entry('https://www.youtube.com/youtubei/v1/like/removelike?prettyPrint=false', 12, 200),
  ]
  assert.deepEqual(findUnlikeRequest(entries, 11), { status: 200 })
})

test('findUnlikeRequest ignores the previous item request (before the mark)', () => {
  const entries = [entry('https://www.youtube.com/youtubei/v1/like/removelike', 9, 200)]
  assert.equal(findUnlikeRequest(entries, 10), null)
})

test('findUnlikeRequest reports a fired request without a reported status as unknown', () => {
  const entries = [entry('https://www.youtube.com/youtubei/v1/like/removelike', 15)]
  assert.deepEqual(findUnlikeRequest(entries, 10), { status: undefined })
})
