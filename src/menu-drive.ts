/**
 * Removal transport: drives the page's own overflow menu instead of
 * reconstructing the edit_playlist request. The server once answered our
 * hand-built mutation with 200 and `loggedOut: true` — a silent no-op.
 * Clicking the page's real menu cannot be silently downgraded: the page signs
 * and sends its own request.
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

async function waitFor<T>(probe: () => T | null | undefined, timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const found = probe()
    if (found) return found
    if (Date.now() >= deadline) return null
    await new Promise((resolve) => setTimeout(resolve, 60))
  }
}

/** Menu item elements across the menu generations YouTube ships. */
const ITEM_SELECTOR = 'ytd-menu-service-item-renderer, ytd-menu-navigation-item-renderer, tp-yt-paper-item'

/** A popup counts as ready once it is visible and at least one item is legible. */
function readyPopup(): HTMLElement | null {
  const popups = [...document.querySelectorAll<HTMLElement>('ytd-menu-popup-renderer, tp-yt-paper-listbox')]
  const visible = popups.find((p) => p.offsetParent !== null) ?? popups[0] ?? null
  if (!visible) return null
  const legible = [...visible.querySelectorAll<HTMLElement>(ITEM_SELECTOR)].some((el) => (el.textContent ?? '').trim().length > 0)
  return legible ? visible : null
}

/**
 * Menu items stamp in progressively (the remove action is often last), so this
 * is a poll probe, not a snapshot: it re-reads the live popup each call.
 */
function pickRemoveItem(): HTMLElement | null {
  const popup = readyPopup()
  if (!popup) return null
  const items = [...popup.querySelectorAll<HTMLElement>(ITEM_SELECTOR)]
  return (
    items.find((el) => isRemoveMenuItem((el as unknown as { data?: unknown }).data)) ??
    items.find((el) => /remove|移除|刪除|删除/i.test(el.textContent ?? '')) ??
    null
  )
}

function closeMenus(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

/** One bounded retry for pre-click menu misses. */
async function retryAfterMiss(row: HTMLElement, attempt: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 500))
  return removeViaMenu(row, attempt + 1)
}

/** Failure reason when the menu click landed but the row lingered in the DOM. */
export const ROW_NOT_REMOVED = 'the page did not remove the row after the menu action'

/** Failure reason when no removable item appeared before the poll deadline. */
export const NO_REMOVE_ACTION = 'no remove action in the overflow menu'

/** Removes one video by clicking through the page's own row overflow menu. */
export async function removeViaMenu(row: HTMLElement, attempt = 0): Promise<void> {
  row.scrollIntoView({ block: 'center' })
  row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))

  const trigger =
    row.querySelector<HTMLElement>('#menu yt-icon-button button') ??
    row.querySelector<HTMLElement>('#menu button') ??
    row.querySelector<HTMLElement>('yt-icon-button button') ??
    row.querySelector<HTMLElement>('button[aria-label]')
  if (!trigger) throw new Error('overflow menu button not found on this row')

  trigger.click()
  // The popup mounts before its items stamp in, and items stamp progressively:
  // poll for the remove action itself instead of snapshotting the menu once.
  const target = await waitFor(pickRemoveItem, 3000)
  if (!target) {
    // Dump what the menu actually offered, as one flat line: the picker's ground truth on a miss.
    const popup = readyPopup()
    const items = popup ? [...popup.querySelectorAll<HTMLElement>(ITEM_SELECTOR)] : []
    console.error(
      '[yt-playlist-pruner] menu items seen:',
      items
        .map((el) => `${el.tagName.toLowerCase()} :: "${(el.textContent ?? '').trim().slice(0, 60)}" :: remove=${isRemoveMenuItem((el as unknown as { data?: unknown }).data)}`)
        .join(' | '),
    )
    closeMenus()
    if (attempt === 0) return retryAfterMiss(row, attempt)
    throw new Error(NO_REMOVE_ACTION)
  }
  target.click()

  // The page drops or hides the row itself when its own request succeeds.
  // A hidden row counts: some layouts animate removal via display toggling.
  if (!(await waitFor(() => !row.isConnected || row.offsetParent === null, 5000))) {
    throw new Error(ROW_NOT_REMOVED)
  }
}
