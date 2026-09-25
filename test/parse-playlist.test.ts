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

/**
 * Shaped like the new-layout Liked Videos page: lockupViewModel items whose
 * serialized metadata menu carries the remove-from-Liked-Videos action as a
 * likeEndpoint with status INDIFFERENT (captured from live page data).
 */
const menuAction = (title: string, likeEndpoint?: Record<string, unknown>) => ({
  listItemViewModel: {
    title: { content: title },
    ...(likeEndpoint
      ? {
          rendererContext: {
            commandContext: {
              onTap: {
                innertubeCommand: {
                  commandMetadata: { webCommandMetadata: { sendPost: true, apiUrl: '/youtubei/v1/like/removelike' } },
                  likeEndpoint,
                },
              },
            },
          },
        }
      : {}),
  },
})

const lockupCard = (overrides: Record<string, unknown> = {}) => ({
  lockupViewModel: {
    contentId: 'L1',
    contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
    contentImage: {
      thumbnailViewModel: {
        image: { sources: [{ url: 'https://i.ytimg.com/vi/L1/small.jpg' }, { url: 'https://i.ytimg.com/vi/L1/big.jpg' }] },
      },
    },
    metadata: {
      lockupMetadataViewModel: {
        title: { content: 'Lockup Title' },
        metadata: {
          contentMetadataViewModel: {
            metadataRows: [{ metadataParts: [{ text: { content: 'Chan L' } }, { text: { content: '1M views' } }] }],
          },
        },
        menu: {
          items: [
            menuAction('加入序列'),
            menuAction('儲存至「稍後觀看」清單'),
            menuAction('儲存至播放清單'),
            menuAction('下載'),
            menuAction('分享'),
            menuAction('已從喜歡的影片中移除', { status: 'INDIFFERENT', target: { videoId: 'L1' } }),
          ],
        },
      },
    },
    ...overrides,
  },
})

const lockupData = {
  contents: {
    items: [
      lockupCard(),
      {
        playlistVideoRenderer: {
          videoId: 'v9',
          title: { simpleText: 'Classic Neighbor' },
          shortBylineText: { runs: [{ text: 'Chan X' }] },
        },
      },
    ],
  },
}

test('extracts lockup items with their unlike menu index, alongside classic ones', () => {
  const { items, continuationToken } = extractItems(lockupData)
  assert.equal(items.length, 2)
  const lockupItem = items[0]!
  assert.equal(lockupItem.videoId, 'L1')
  assert.equal(lockupItem.title, 'Lockup Title')
  assert.equal(lockupItem.channel, 'Chan L')
  assert.equal(lockupItem.thumbnailUrl, 'https://i.ytimg.com/vi/L1/big.jpg')
  assert.equal(lockupItem.unavailable, false)
  assert.equal(lockupItem.unlikeIndex, 5)
  assert.equal(lockupItem.setVideoId, undefined)
  assert.equal(items[1]!.videoId, 'v9')
  assert.equal(continuationToken, null)
})

test('unlikeIndex stays undefined when the unlike action targets another video or is absent', () => {
  const suspicious = {
    contents: {
      items: [
        lockupCard({
          contentId: 'L2',
          metadata: {
            lockupMetadataViewModel: {
              title: { content: 'Poisoned Menu' },
              menu: {
                items: [
                  menuAction('分享'),
                  menuAction('已從喜歡的影片中移除', { status: 'INDIFFERENT', target: { videoId: 'OTHER' } }),
                ],
              },
            },
          },
        }),
        lockupCard({ contentId: 'L3', metadata: { lockupMetadataViewModel: { title: { content: 'No Menu' } } } }),
      ],
    },
  }
  const { items } = extractItems(suspicious)
  assert.equal(items[0]!.unlikeIndex, undefined)
  assert.equal(items[1]!.unlikeIndex, undefined)
})

test('skips lockups that are not videos, keeping video lockups without a contentType', () => {
  const mixed = {
    contents: {
      items: [
        lockupCard({ contentId: 'PL1', contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST' }),
        lockupCard({ contentId: 'L4', contentType: undefined }),
      ],
    },
  }
  const { items } = extractItems(mixed)
  assert.equal(items.length, 1)
  assert.equal(items[0]!.videoId, 'L4')
})
