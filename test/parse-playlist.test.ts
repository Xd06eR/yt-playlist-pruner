import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractItems } from '../src/parse-playlist'

/** Shaped like the initial page state for youtube.com/playlist?list=... */
const initialData = {
  header: { playlistHeaderRenderer: { playlistId: 'PLTEST' } },
  contents: {
    twoColumnBrowseResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: [
                  {
                    itemSectionRenderer: {
                      contents: [
                        {
                          playlistVideoListRenderer: {
                            contents: [
                              {
                                playlistVideoRenderer: {
                                  videoId: 'v1',
                                  setVideoId: 'SV1',
                                  title: { runs: [{ text: 'First Video' }] },
                                  shortBylineText: { runs: [{ text: 'Chan A' }] },
                                  thumbnail: {
                                    thumbnails: [
                                      { url: 'https://i.ytimg.com/vi/v1/hq72.jpg', width: 168 },
                                      { url: 'https://i.ytimg.com/vi/v1/hqdefault.jpg', width: 480 },
                                    ],
                                  },
                                  isPlayable: true,
                                },
                              },
                              {
                                playlistVideoRenderer: {
                                  videoId: 'v2',
                                  title: { runs: [{ text: '[Private video]' }] },
                                  shortBylineText: { runs: [{ text: 'Chan B' }] },
                                  thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/v2/default.jpg', width: 480 }] },
                                },
                              },
                              { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'TOK1' } } } },
                            ],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  },
}

/** Shaped like a youtubei/v1/browse continuation response. */
const continuationResponse = {
  onResponseReceivedActions: [
    {
      appendContinuationItemsAction: {
        continuationItems: [
          {
            playlistVideoRenderer: {
              videoId: 'v3',
              title: { simpleText: 'Third' },
              shortBylineText: { runs: [{ text: 'Chan C' }] },
            },
          },
          { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'TOK2' } } } },
        ],
      },
    },
  ],
}

test('extracts items and continuation token from initial page data', () => {
  const { items, continuationToken } = extractItems(initialData)
  assert.equal(items.length, 2)
  assert.equal(continuationToken, 'TOK1')
  assert.equal(items[0]!.videoId, 'v1')
  assert.equal(items[0]!.setVideoId, 'SV1')
  assert.equal(items[0]!.title, 'First Video')
  assert.equal(items[0]!.channel, 'Chan A')
  assert.equal(items[0]!.thumbnailUrl, 'https://i.ytimg.com/vi/v1/hqdefault.jpg')
  assert.equal(items[0]!.unavailable, false)
})

test('picks the widest (last) thumbnail', () => {
  const { items } = extractItems(initialData)
  assert.equal(items[0]!.thumbnailUrl, 'https://i.ytimg.com/vi/v1/hqdefault.jpg')
})

test('detects unavailable items by their literal bracket titles', () => {
  const { items } = extractItems(initialData)
  assert.equal(items[1]!.unavailable, true)
  assert.equal(items[1]!.title, '[Private video]')
})

test('extracts items from a continuation response, supporting simpleText titles', () => {
  const { items, continuationToken } = extractItems(continuationResponse)
  assert.equal(items.length, 1)
  assert.equal(items[0]!.videoId, 'v3')
  assert.equal(items[0]!.title, 'Third')
  assert.equal(items[0]!.thumbnailUrl, undefined)
  assert.equal(continuationToken, 'TOK2')
})

test('deduplicates by videoId when the same renderer is reachable twice', () => {
  const twice = { x: [initialData.contents, initialData.contents] }
  const { items } = extractItems(twice)
  assert.equal(items.length, 2)
})

test('returns empty result for shapes without playlist items', () => {
  const { items, continuationToken } = extractItems({ foo: { bar: [1, 2, 3] } })
  assert.equal(items.length, 0)
  assert.equal(continuationToken, null)
})
