# YT Playlist Pruner — Agent Notes

AGENTS.md is a symlink to this file; edit here, never there.

What the code and README cannot say: the reasons behind the architecture, and the traps that shaped it.

## The one law

Removals drive the page's own overflow menu (`src/menu-drive.ts`). Never rebuild the `edit_playlist` / `removelike` request: a hand-built mutation comes back `200` with `loggedOut: true` and silently does nothing — every visible field can match the page's own request and the mutation still will not apply. Reads are different: self-built InnerTube `browse` requests are fine and load the playlist. Writes belong to the page; reads are ours.

## Hard conventions

- Zero `chrome.*` APIs anywhere. The engine stays host-portable (userscript-shell compatible); persistence goes through `localStorage` on the youtube.com origin.
- All injected DOM is built with `createElement`/`textContent`: the content script runs in `world: MAIN`, where YouTube's Trusted Types CSP makes `innerHTML` throw. Third-party strings (titles, error reasons) reach the page as text nodes only.
- Never restyle or reposition YouTube's own elements (e.g. `position: relative` on cards): their internals re-anchor and the layout twists. Overlays anchor to an already-positioned container inside the row.
- A removal claim is not success. Post-run, `src/verify.ts` re-fetches the playlist and reconciles both ways: claimed-but-present downgrades to failed; row-lingering-but-gone upgrades to removed. Preserve this honesty in any new write path.
- Out of scope by owner decision: Liked Videos (the lockup layout) and CSV export. Re-adding either needs an explicit request with evidence, not a drive-by.

## Operational traps

- Long runs need the tab visible (a corner of its window is enough): Chrome throttles background-tab timers to ~1/min after 5 minutes hidden, stretching intervals and causing menu-poll deadlines to misfire. Windows counts fully occluded windows as hidden.
- Rows can go stale mid-run when YouTube re-renders the list (~2.5% of items): the menu then misses twice and the item fails honestly. Remedy: reload, re-select, re-run. Known open issue; the `[yt-playlist-pruner] menu items seen:` console line is the diagnostic (empty = menu never opened = stale row reference; populated = menu lacks the remove item).
- `dist/` is gitignored: build (`npm run build`) before any load-unpacked testing.

## Process

- Commits are run by the owner, never by the agent; one logical change per commit, files staged by name.
- Pure logic lives in pure modules with `node:test` coverage; browser-only code stays a thin shell over them.
- Artifacts (code, comments, commits, docs) are English.
