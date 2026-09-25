# YT Playlist Pruner — Agent Notes

AGENTS.md is a symlink to this file; edit here, never there.

What the code and README cannot say: the reasons behind the architecture, and the traps that shaped it.

## The one law

Removals drive the page's own overflow menu (`src/menu-drive.ts`). Never rebuild the `edit_playlist` / `removelike` request: a hand-built mutation comes back `200` with `loggedOut: true` and silently does nothing — every visible field can match the page's own request and the mutation still will not apply. Reads are different in kind: a hand-built read cannot corrupt anything, but the server hands the whole self-built `browse` family an anonymous `loggedOut: true` shell (verified), so the page's initial data and rendered rows are the live read sources. Writes belong to the page; reads are ours.

The lockup (Liked Videos) menu cannot be driven the classic way: its rendered buttons carry no serialized data (verified — no `.data`, no command properties), so the remove item is identified by the `unlikeIndex` the parser reads from the page data (`likeEndpoint.status: "INDIFFERENT"` aiming at the card's own `contentId`), cross-checked against the item text. Browsing `VLLL` also returns the anonymous `loggedOut: true` shell, so the lockup list is enumerated from rendered rows only. The lockup grid also keeps unliked cards on screen (even for manual removals) and renders its toast in a closed shadow root (verified: no `.shadowRoot`, no light children), so the page's own completed `removelike` request — observed passively through resource timing, never built or replayed — is the only removal receipt there: no row drop, no readable toast.

## Hard conventions

- Zero `chrome.*` APIs anywhere. The engine stays host-portable (userscript-shell compatible); persistence goes through `localStorage` on the youtube.com origin.
- All injected DOM is built with `createElement`/`textContent`: the content script runs in `world: MAIN`, where YouTube's Trusted Types CSP makes `innerHTML` throw. Third-party strings (titles, error reasons) reach the page as text nodes only.
- Never restyle or reposition YouTube's own elements beyond what a layout provably tolerates. Classic rows tolerate being made their checkbox's positioning context (`position: relative` on `.ypp-row`); lockup cards do not — their internals re-anchor and the layout twists (proven) — so their checkboxes float in a page-level overlay layer tracked from `getBoundingClientRect` instead.
- A removal claim is not success. Every removal counts only against its own receipt — the page dropping the row, or on the lockup layout the page's own completed `removelike` request. No post-run server re-check exists (the self-built browse family answers anonymous shells), so a lingering card stays until reload. Preserve this honesty in any new write path.
- Out of scope by owner decision: CSV export. Re-adding it needs an explicit request with evidence, not a drive-by.

## Operational traps

- Long runs need the tab visible (a corner of its window is enough): Chrome throttles background-tab timers to ~1/min after 5 minutes hidden, stretching intervals and causing menu-poll deadlines to misfire. Windows counts fully occluded windows as hidden.
- Rows can go stale mid-run when YouTube re-renders the list (measured: ~2.5% of items): the menu then misses twice and the item fails honestly. Remedy: reload, re-select, re-run. Known open issue; the `[yt-playlist-pruner] menu items seen:` console line is the diagnostic (empty = menu never opened = stale row reference; populated = menu lacks the remove item).
- Liked Videos keeps unliked cards on screen until reload and gives no readable per-action confirmation (its toast lives in a closed shadow root); the report counts removals the page's own request completed and says so.
- YouTube's playlist list recycles row elements when rows are inserted (the "show unavailable videos" toggle): per-row state must re-verify its binding on every mutation pass. A checkbox bound once keeps its element's previous occupant's id, and DOM-position mapping is wrong for the same reason — bind to the row's own data (`rowVideoId`), never to an index. `items` order must also track the DOM: shift ranges slice it, so without order tracking a shift across a late-discovered row sweeps most of the list.
- `window.ytInitialData` is frozen at hard load: after any SPA navigation it still describes the previous page. Never seed items or detect the layout from it past a page session's first boot — rendered rows are the truth (`boot`'s seed flag, `attachCheckboxes`' kind flip).
- `dist/` is gitignored: build (`npm run build`) before any load-unpacked testing.

## Process

- Commits are run by the owner, never by the agent; one logical change per commit, files staged by name.
- Pure logic lives in pure modules with `node:test` coverage; browser-only code stays a thin shell over them.
- Artifacts (code, comments, commits, docs) are English.
