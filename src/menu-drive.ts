/**
 * Removal transport: drives the page's own overflow menu instead of
 * reconstructing the edit_playlist request. A hand-built mutation can come
 * back 200 with `loggedOut: true` — a silent no-op — while the page's own
 * click cannot be silently downgraded: the page signs and sends its request.
 */

/**
 * Language-independent check on a rendered menu item: does it perform a removal?
 * The save-to-playlist item ALSO carries a playlistEditEndpoint (with add
 * actions), so the presence of the endpoint alone is not enough: an explicit
 * ACTION_REMOVE_VIDEO action is required.
 */
export function isRemoveMenuItem(item: unknown): boolean {
  if (typeof item !== 'object' || item === null) return false
  const endpoint = (item as Record<string, unknown>).serviceEndpoint
  if (typeof endpoint !== 'object' || endpoint === null) return false
  const endpointObject = endpoint as Record<string, unknown>

  const edit = endpointObject.playlistEditEndpoint
  if (isRecord(edit) && Array.isArray(edit.actions)) {
    return edit.actions.some(
      (action) => isRecord(action) && (action as Record<string, unknown>).action === 'ACTION_REMOVE_VIDEO',
    )
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Locales seen on live pages (zh-Hant/HK, en); a fallback, so broad beats exact. */
const REMOVE_TEXT = /remove|移除|刪除|删除/i

/**
 * Picks the removal item's position among a menu's item texts. The serialized
 * unlike index (read from page data at enumeration time) wins while its item's
 * text still reads as a removal — a cross-check against menu order drift —
 * then any removal-looking text. Null when nothing qualifies.
 */
export function chooseRemovalIndex(texts: readonly string[], unlikeIndex?: number): number | null {
  if (
    typeof unlikeIndex === 'number' &&
    unlikeIndex >= 0 &&
    unlikeIndex < texts.length &&
    REMOVE_TEXT.test(texts[unlikeIndex] ?? '')
  ) {
    return unlikeIndex
  }
  const found = texts.findIndex((text) => REMOVE_TEXT.test(text))
  return found >= 0 ? found : null
}

async function waitFor<T>(probe: () => T | null | undefined, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = probe()
    if (found) return found
    if (Date.now() >= deadline) return null
    await new Promise((resolve) => setTimeout(resolve, 60))
  }
}

/**
 * Menu item elements across the menu generations YouTube ships. The lockup
 * (Liked Videos) menu wraps each item in yt-list-item-view-model; exactly one
 * selector hit per item keeps positional picking meaningful.
 */
const ITEM_SELECTOR =
  'ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer, tp-yt-paper-item, yt-list-item-view-model'

/** A popup counts as ready once it is visible and at least one item is legible. */
function readyPopup(): HTMLElement | null {
  const popups = [...document.querySelectorAll<HTMLElement>('ytd-menu-popup-renderer, tp-yt-paper-listbox, yt-list-view-model')]
  const visible = popups.find((p) => p.offsetParent !== null) ?? popups[0] ?? null
  if (!visible) return null
  const legible = [...visible.querySelectorAll<HTMLElement>(ITEM_SELECTOR)].some((el) => (el.textContent ?? '').trim().length > 0)
  return legible ? visible : null
}

/**
 * Menu items stamp in progressively (the remove action is often last), so this
 * is a poll probe, not a snapshot: it re-reads the live popup each call.
 * Classic items carry their serialized command on the element; the lockup
 * menu's buttons carry nothing (verified on live pages), so lockups pick by
 * the page-data unlike index with a text cross-check instead.
 */
function pickRemoveItem(unlikeIndex?: number): HTMLElement | null {
  const popup = readyPopup()
  if (!popup) return null
  const items = [...popup.querySelectorAll<HTMLElement>(ITEM_SELECTOR)]
  const byData = items.find((el) => isRemoveMenuItem((el as unknown as { data?: unknown }).data))
  if (byData) return byData
  const byText = chooseRemovalIndex(items.map((el) => (el.textContent ?? '').trim()), unlikeIndex)
  return byText === null ? null : (items[byText] ?? null)
}

function closeMenus(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

/** One bounded retry for pre-click menu misses. */
async function retryAfterMiss(row: HTMLElement, attempt: number, unlikeIndex?: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 500))
  return removeViaMenu(row, attempt + 1, unlikeIndex)
}

/** Failure reason when the menu click landed but the row lingered in the DOM. */
export const ROW_NOT_REMOVED = 'the page did not remove the row after the menu action'

/** Failure reason when no removable item appeared before the poll deadline. */
export const NO_REMOVE_ACTION = 'no remove action in the overflow menu'

/** Failure reason when the page's own removal request never completed. */
export const REQUEST_NOT_SEEN = 'no completed removal request from the page'

/** The resource-timing entry shape findUnlikeRequest reads. */
export interface RequestLike {
  name: string
  startTime: number
  responseStatus?: number
}

/**
 * Scans resource-timing entries for the page's own unlike request fired after
 * `mark`. Its completion — with HTTP status where the browser reports it — is
 * the removal receipt the lockup layout cannot provide any other way: no row
 * drop, and its toast renders in a closed shadow root. Observation only; the
 * request is never built or replayed here.
 */
export function findUnlikeRequest(entries: readonly RequestLike[], mark: number): { status?: number } | null {
  const match = entries.find((entry) => entry.name.includes('/youtubei/v1/like/removelike') && entry.startTime >= mark)
  return match ? { status: match.responseStatus } : null
}

/**
 * Removes one video by clicking through the page's own row overflow menu.
 * `unlikeIndex` is the lockup card's serialized remove-from-Liked-Videos
 * position (see chooseRemovalIndex); classic rows ignore it. `successSignal`
 * picks what counts as done: classic layouts drop the row themselves, while
 * the Liked Videos grid keeps the card and renders its confirmation toast in
 * a closed shadow root (verified live), so there the page's own completed
 * removelike request is the receipt.
 */
export async function removeViaMenu(
  row: HTMLElement,
  attempt = 0,
  unlikeIndex?: number,
  successSignal: 'row' | 'request' = 'row',
): Promise<void> {
  row.scrollIntoView({ block: 'center' })
  row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))

  // No bare button[aria-label] catch-all: on lockup cards it matches the
  // thumbnail's Watch Later overlay and misfires. A missed ladder fails
  // honestly instead of clicking the wrong button.
  const trigger =
    row.querySelector<HTMLElement>('#menu yt-icon-button button') ??
    row.querySelector<HTMLElement>('#menu button') ??
    row.querySelector<HTMLElement>('yt-icon-button button') ??
    row.querySelector<HTMLElement>('.ytLockupMetadataViewModelMenuButton button')
  if (!trigger) throw new Error('overflow menu button not found on this row')

  trigger.click()
  // The popup mounts before its items stamp in, and items stamp progressively:
  // poll for the remove action itself instead of snapshotting the menu once.
  const target = await waitFor(() => pickRemoveItem(unlikeIndex), 3000)
  if (!target) {
    // Dump what the menu actually offered, as one flat line: the picker's ground truth on a miss.
    const popup = readyPopup()
    const items = popup ? [...popup.querySelectorAll<HTMLElement>(ITEM_SELECTOR)] : []
    console.error(
      '[yt-playlist-pruner] menu items seen:',
      items
        .map((el) => `${el.tagName.toLowerCase()} :: "${(el.textContent ?? '').trim().slice(0, 60)}" :: remove=${isRemoveMenuItem((el as unknown as { data?: unknown }).data)}`)
        .join(' | '),
      `| unlikeIndex=${unlikeIndex ?? 'none'}`,
    )
    closeMenus()
    if (attempt === 0) return retryAfterMiss(row, attempt, unlikeIndex)
    throw new Error(NO_REMOVE_ACTION)
  }
  // New-generation items are yt-list-item-view-model hosts whose handler sits
  // on the inner button; classic items handle the click themselves.
  const requestMark = performance.now()
  const clickTarget = target.querySelector<HTMLElement>('button') ?? target
  clickTarget.click()

  if (successSignal === 'request') {
    // Close explicitly: a menu the page fails to dismiss would feed the next
    // item's poll a stale unlike item — a false success with nothing
    // downstream to catch it.
    closeMenus()
    // A busy page can fill the default resource-timing buffer and drop
    // entries; a roomy one keeps a whole run observable.
    performance.setResourceTimingBufferSize?.(10000)
    const seen = await waitFor(() => findUnlikeRequest(performance.getEntriesByType('resource'), requestMark), 5000)
    if (!seen) throw new Error(REQUEST_NOT_SEEN)
    if (typeof seen.status === 'number' && seen.status >= 400) {
      throw new Error(`removal request failed (HTTP ${seen.status})`)
    }
    return
  }

  // The page drops or hides the row itself when its own request succeeds.
  // A hidden row counts: some layouts animate removal via display toggling.
  if (!(await waitFor(() => !row.isConnected || row.offsetParent === null, 5000))) {
    throw new Error(ROW_NOT_REMOVED)
  }
}
