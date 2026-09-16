# Transport Notice — error surfacing + status broadcast removal (Design)

**Status:** approved direction (owner, 2026-07-09) · **Scope:** frontend

## Problem

The `status` / `status2` strings are written from 24 sites but rendered nowhere: the
2026-05-16 chrome redesign (`c73ca9e`) removed the footer status line by design (minimal
chrome) and nobody deleted the broadcasting side. Most messages are redundant with the
derived transport UI, but a handful are the **only** channel for user-facing failures —
most painfully a live capture error, where today the START button silently flips back
with zero explanation.

## Decision (option A′)

1. **New surface — the transport notice.** One small, truncating text slot in the header
   transport cluster, immediately right of the StatusPill / START button. Identical
   position and behavior in Live and File mode. It is the **single** error surface:
   the File-mode error banner (`FileAnalysisSummary`'s `state === "error"` branch) is
   **removed** (owner decision 2026-07-09) — a failed file renders the summary area's
   normal non-complete presentation, and the failure itself is communicated by the
   notice. The session ledger keeps `state: "error"` / `error` fields (the history
   menu's per-entry error marker still uses them); only the banner rendering goes.
2. **Delete the status broadcast system entirely.** `status`, `status2`, their setters,
   and all 24 write sites go away. No footer status line returns (respects the minimal
   chrome decision).

## The notice

**Data model** (owned by `useMeterDisplay`, replacing `status`/`status2`):

```js
notice: { kind: "error" | "guard", text: string } | null
raiseNotice(kind, text)   // replaces any current notice
clearNotice()
```

**Lifecycle:**

- `error` notices persist until replaced or cleared by the next transport action
  (START click, source switch, file analyze start).
- `guard` notices (e.g. "File analysis already in progress") auto-dismiss after ~5 s,
  and are likewise replaced/cleared by newer activity.
- Only one notice at a time; newest wins.

**Presentation** (AppHeader, right of StatusPill):

- `error`: destructive/red text, prefix icon optional; `guard`: muted foreground.
- Single line, `truncate`, full text in `title` tooltip. Empty slot renders nothing —
  the header looks exactly as today when there is no notice.

## Message disposition (all 24 write sites)

| Today's message | Fate |
| --- | --- |
| `Error: {capture error}` (useAudioEngine catch) | → `raiseNotice("error", …)` — the headline fix |
| `Error: {file analysis error}` (2 sites) | → `raiseNotice("error", …)` — now the only error surface (banner removed) |
| `Report export failed` | → `raiseNotice("error", …)` |
| `File analysis already in progress` (2 sites) | → `raiseNotice("guard", …)` |
| `Choose a file to analyze` / `Choose a completed file analysis to export` | → `raiseNotice("guard", …)` |
| Everything else — Ready/Stopped/Monitoring/History snapshot/File mode…/File analysis result/Starting…/Probing…/Analyzing…/complete/stopped/exported/entry removed/cleared, and every `status2` `Device:` line | **deleted, no replacement** (redundant with derived transport UI, file banner/summary, and footer device label) |

Deliberate call: success confirmations (`File analysis report exported`) are dropped —
minimal chrome; the exported file existing is the confirmation. Revisit only if missed
in practice.

## Removal scope

- `useMeterDisplay`: drop `status`/`status2`/setters; add `notice`/`raiseNotice`/`clearNotice`.
- Engines / transport / runtime / source-actions hooks: drop their `setStatus`/`setStatus2`
  reads from `display`; error paths call `raiseNotice`.
- App: delete the "History snapshot (not live input)" status effect and all remaining
  write sites per the table.
- AppHeader: render the notice slot; smoke/AppHeader tests grow assertions
  (capture error → visible red text; guard auto-dismisses).
- `FileAnalysisSummary`: delete the `state === "error"` banner branch; its tests move
  to asserting the notice instead.
- Tests asserting old `setStatus` calls updated alongside.

## Non-goals

- No footer status line, no toast framework, no notice history.
- Session error plumbing (`state: "error"`, `error` on the ledger entry) unchanged —
  only the banner rendering is removed.
