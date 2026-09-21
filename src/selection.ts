/**
 * Selection state for the visible playlist, keyed by videoId so it survives
 * DOM re-renders and items that are not currently rendered (long playlists
 * lazy-render on scroll). Order comes from the parsed playlist item list.
 */
export class SelectionModel {
  private selected = new Set<string>()
  private orderedIds: readonly string[] = []
  private lastClicked: string | null = null

  /** Sets the ordered universe of selectable ids; drops selections outside it. */
  reset(orderedIds: readonly string[]): void {
    this.orderedIds = orderedIds
    const keep = new Set(orderedIds)
    for (const id of this.selected) if (!keep.has(id)) this.selected.delete(id)
    if (this.lastClicked !== null && !keep.has(this.lastClicked)) this.lastClicked = null
  }

  /**
   * Handles one checkbox interaction. Plain click toggles a single id;
   * shift-click applies the checked state to the inclusive range between the
   * last click and this one (in playlist order, either direction).
   */
  onCheckbox(id: string, checked: boolean, shiftKey: boolean): void {
    if (shiftKey && this.lastClicked !== null && this.lastClicked !== id) {
      this.selectRange(this.lastClicked, id, checked)
    } else {
      this.set(id, checked)
    }
    this.lastClicked = id
  }

  set(id: string, on: boolean): void {
    if (on) this.selected.add(id)
    else this.selected.delete(id)
  }

  selectRange(fromId: string, toId: string, on = true): void {
    const i = this.orderedIds.indexOf(fromId)
    const j = this.orderedIds.indexOf(toId)
    if (i === -1 || j === -1) return
    const lo = Math.min(i, j)
    const hi = Math.max(i, j)
    for (let k = lo; k <= hi; k++) this.set(this.orderedIds[k]!, on)
  }

  selectAll(): void {
    for (const id of this.orderedIds) this.selected.add(id)
  }

  clear(): void {
    this.selected.clear()
    this.lastClicked = null
  }

  has(id: string): boolean {
    return this.selected.has(id)
  }

  get size(): number {
    return this.selected.size
  }

  /** Selected ids in playlist order, not click order. */
  selectedIds(): string[] {
    return this.orderedIds.filter((id) => this.selected.has(id))
  }
}
