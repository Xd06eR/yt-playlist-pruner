import { THROTTLE_BASE_MS } from './runner'
import type { RunReport } from './types'

export interface ToolbarHandlers {
  onSelectAll(): void
  onClear(): void
  onRemove(): void
  onCancel(): void
  onDryRunChange(dryRun: boolean): void
}

export interface ToolbarHandle {
  root: HTMLElement
  setSelected(count: number): void
  setTotals(total: number): void
  setStatus(text: string): void
  setEnabled(enabled: boolean): void
  setDryRun(dryRun: boolean): void
  setRunning(done: number, total: number, cancelling: boolean): void
  clearRunning(): void
}

export const THROTTLE_MS = THROTTLE_BASE_MS

/**
 * All DOM is built with createElement/textContent on purpose: the script runs
 * in the page world, where YouTube's Trusted Types CSP makes innerHTML throw.
 * Third-party strings (titles, error reasons) reach the page as text nodes only.
 */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

function button(label: string, onClick: () => void, extraClass?: string): HTMLButtonElement {
  const btn = el('button', extraClass ? `ypp-btn ${extraClass}` : 'ypp-btn')
  btn.textContent = label
  btn.addEventListener('click', onClick)
  return btn
}

export function mountToolbar(handlers: ToolbarHandlers): ToolbarHandle {
  const root = el('div', 'ypp-toolbar')
  const title = el('div', 'ypp-title')
  title.textContent = 'YT Playlist Pruner'
  const status = el('div', 'ypp-status')

  const actions = el('div', 'ypp-actions')
  const row1 = el('div', 'ypp-row')
  const count = el('span', 'ypp-count')
  row1.append(
    count,
    button('Select all', handlers.onSelectAll),
    button('Clear', handlers.onClear),
  )
  const row2 = el('div', 'ypp-row')
  const dryLabel = el('label', 'ypp-dry')
  const dryInput = document.createElement('input')
  dryInput.type = 'checkbox'
  dryInput.addEventListener('change', () => handlers.onDryRunChange(dryInput.checked))
  dryLabel.append(dryInput, document.createTextNode(' dry-run'))
  const removeBtn = button('', handlers.onRemove, 'ypp-remove')
  row2.append(dryLabel, removeBtn)
  actions.append(row1, row2)

  const progress = el('div', 'ypp-progress')
  progress.hidden = true
  const bar = el('div', 'ypp-bar')
  const barFill = el('div', 'ypp-bar-fill')
  bar.append(barFill)
  const progressRow = el('div', 'ypp-row')
  const progressText = el('span', 'ypp-progress-text')
  progressRow.append(progressText, button('Cancel', handlers.onCancel))
  progress.append(bar, progressRow)

  root.append(title, status, actions, progress)
  document.body.appendChild(root)

  let selected = 0
  let dryRun = false

  function renderRemoveLabel(): void {
    removeBtn.textContent = dryRun ? `Dry-run ${selected} video${selected === 1 ? '' : 's'}` : `Remove ${selected} video${selected === 1 ? '' : 's'}…`
    removeBtn.disabled = selected === 0
  }

  return {
    root,
    setSelected(n) {
      selected = n
      count.textContent = `${n} selected`
      renderRemoveLabel()
    },
    setTotals(total) {
      status.textContent = `${total} video${total === 1 ? '' : 's'} loaded`
    },
    setStatus(text) {
      status.textContent = text
    },
    setEnabled(enabled) {
      removeBtn.disabled = removeBtn.disabled || !enabled
      removeBtn.title = enabled ? '' : 'Sign in to YouTube to enable pruning'
    },
    setDryRun(on) {
      dryRun = on
      dryInput.checked = on
      renderRemoveLabel()
    },
    setRunning(done, total, cancelling) {
      actions.hidden = true
      progress.hidden = false
      const remaining = Math.max(total - done, 0)
      const eta = Math.ceil((remaining * THROTTLE_MS) / 1000)
      const etaText = eta < 90 ? `${eta}s` : `${Math.floor(eta / 60)}m ${eta % 60}s`
      progressText.textContent = `${done}/${total}${cancelling ? ' · cancelling…' : ` · ~${etaText} left`}`
      barFill.style.width = `${total === 0 ? 0 : Math.round((done / total) * 100)}%`
    },
    clearRunning() {
      progress.hidden = true
      actions.hidden = false
    },
  }
}

/** Irreversible-action confirmation. Resolves true when the user confirms. */
export function confirmDialog(count: number, titles: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = el('div', 'ypp-backdrop')
    const modal = el('div', 'ypp-modal')
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    const heading = el('div', 'ypp-modal-title')
    heading.textContent = `Remove ${count} video${count === 1 ? '' : 's'} from this playlist?`
    const warning = el('p')
    warning.textContent = 'This cannot be undone. Use a dry run first if you want to preview what will go.'

    const list = el('div', 'ypp-confirm-list')
    if (titles.length > 0) {
      for (const title of titles.slice(0, 10)) {
        const line = el('div')
        line.textContent = title
        list.append(line)
      }
      if (titles.length > 10) {
        const more = el('div')
        more.textContent = `…and ${titles.length - 10} more`
        list.append(more)
      }
    } else {
      list.hidden = true
    }

    const actionRow = el('div', 'ypp-row ypp-modal-actions')
    const cancelBtn = button('Cancel', () => done(false))
    const confirmBtn = button('Remove', () => done(true), 'ypp-remove')
    actionRow.append(cancelBtn, confirmBtn)

    modal.append(heading, warning, list, actionRow)
    backdrop.append(modal)

    const done = (answer: boolean): void => {
      document.removeEventListener('keydown', onKey)
      backdrop.remove()
      resolve(answer)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') done(false)
    }
    document.addEventListener('keydown', onKey)
    document.body.appendChild(backdrop)
    // Focus lands on the safe answer, so Enter cannot re-trigger the toolbar button.
    cancelBtn.focus()
  })
}

/** End-of-run report; offers a page reload whenever local state may have diverged. */
export function reportDialog(report: RunReport, suggestReload: boolean): void {
  const removed = report.results.filter((r) => r.status === 'removed').length
  const wouldRemove = report.results.filter((r) => r.status === 'would-remove').length
  const failed = report.results.filter((r) => r.status === 'failed')
  const abortedText =
    report.aborted === 'auth'
      ? 'Stopped: you appear to be signed out.'
      : report.aborted === 'rate'
        ? 'Stopped: YouTube rate-limited the requests. Wait a while and run again.'
        : report.aborted === 'user'
          ? 'Cancelled.'
          : ''

  const backdrop = el('div', 'ypp-backdrop')
  const modal = el('div', 'ypp-modal')
  modal.setAttribute('role', 'dialog')
  modal.setAttribute('aria-modal', 'true')
  const heading = el('div', 'ypp-modal-title')
  heading.textContent = report.dryRun ? 'Dry run' : 'Removal report'
  const summary = el('p')
  summary.textContent = report.dryRun
    ? `${wouldRemove} video${wouldRemove === 1 ? '' : 's'} would be removed.`
    : `${removed} removed, ${failed.length} failed.`
  modal.append(heading, summary)
  if (abortedText) {
    const abortedLine = el('p')
    abortedLine.textContent = abortedText
    modal.append(abortedLine)
  }
  if (failed.length > 0) {
    const list = el('div', 'ypp-failed')
    for (const f of failed) {
      const line = el('div')
      const title = el('span')
      title.textContent = f.title
      const reason = el('span')
      reason.textContent = ` — ${f.reason}`
      line.append(title, reason)
      list.append(line)
    }
    modal.append(list)
  }
  const actionRow = el('div', 'ypp-row ypp-modal-actions')
  if (suggestReload) {
    actionRow.append(button('Reload page', () => location.reload()))
  }
  actionRow.append(button('Close', () => backdrop.remove()))
  modal.append(actionRow)
  backdrop.append(modal)
  document.body.appendChild(backdrop)
}

export function makeCheckbox(checked: boolean): HTMLInputElement {
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.className = 'ypp-check'
  input.checked = checked
  input.title = 'Select for batch removal (shift-click for a range)'
  return input
}
