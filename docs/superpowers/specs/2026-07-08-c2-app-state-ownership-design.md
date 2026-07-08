# C2 — App.jsx State Ownership Inversion (Design)

**Status:** approved (owner-delegated) · **Date:** 2026-07-08 · **Scope:** frontend architecture

## Problem

`src/App.jsx` (1813 lines, ~98 hook call sites) owns nearly all application state and lends
it to hooks via parameter lists: `useAudioEngine` takes 22 named params, `useFileAnalysisEngine`
18, `useHistoryInteraction` 15 — mostly refs and setters created in App. The hooks are
*borrowers*, not *owners*: their interface is as complex as their implementation (shallow
modules), every new piece of state touches three places (App useState → hook signature →
call site), and App itself cannot be render-tested — `App.toolbar.test.js` reads App.jsx as
text and greps 156 substrings, which catches no runtime regression.

## Current architecture (as-built)

Two *producer* engines write into a set of **shared display states** that live loose in App;
panels *consume* them via `AudioDataContext`:

| Shared state (owned by App today) | Written by | Read by |
| --- | --- | --- |
| `audio` (meter frame snapshot) | live engine, file engine (gated by `shouldDriveDisplay`) | all panels |
| `selectedOffset` + `selectedOffsetRef` | both engines, history interaction | panels, engines |
| `status` / `status2` | both engines, many App flows | header/status UI |
| session clock (`useSessionTimer`) + `showClock` | both engines via `resetTimer`/`setShowClock` | header |
| `frameRef` | both engines (via `tauriFrameApply`) | engines |
| intake rings (`liveIntakeRef`, per-file-session intakes, `intakeRef` switch) | engines | panels via context |

Because this shared layer has no owner, neither engine can be given ownership of it —
that is why naive "let useAudioEngine own its state" fails and why the param lists exploded.

Additional finding: `setHistoryPathM` / `setHistoryPathST` are threaded App → both engines →
`tauriFrameApply`, but **both** call sites pass `() => {}`. Dead plumbing, deletable end to end.

Finding from Phase 0 (2026-07-08): the raw `status` / `status2` strings are **write-only** —
dozens of `setStatus(...)` calls across App and both engines, but no component renders them
(the header shows the derived `statusLabel` from `sourceTransportState.js`). Kept as-is in
Phase 1 (they still move behind `useMeterDisplay` as display-domain state); whether to
resurface them in the UI or delete the whole chain is a product decision for a later phase.

## Target architecture

Introduce owners; App becomes layout + assembly.

```
useMeterDisplay()  ← NEW: owns the shared display layer (audio, selectedOffset(+ref),
                     status, status2, clock+showClock, frameRef, clear helpers)
      ▲ writers            ▲ reads
useAudioEngine(display, …) useFileAnalysisEngine(display, …)   panels (via AudioDataContext)
      owns capture lifecycle (audioRef, rafRef)  owns decode lifecycle
```

- **`useMeterDisplay`** — the one owner of the shared display layer. Exposes plain state +
  setters + `clock` + clear helpers as one object. Engines receive this object instead of
  8–10 individual setters/refs.
- **Engines** — receive `display` + their own config/prefs; later phases move exclusive
  state (`audioRef`, `rafRef`, `running`) inside and expose `{ start, stop, status }`.
- **Setter identity**: React state setters and refs are identity-stable; engines keep their
  intentionally narrow effect dep arrays (`[running, captureDeviceId, captureFormatSignature]`)
  and read `display.*` inside effects, exactly as they read individual props today. The
  `display` wrapper object identity may change per render — engines must not list it in deps
  (they already don't list any of its fields).

## Phases

| Phase | Content | Exit criteria |
| --- | --- | --- |
| **0** | Safety net: real render smoke test for App (mount, START click drives real wiring in browser mode) | `App.smoke.test.jsx` green in CI |
| **1a** | Delete dead `setHistoryPathM/ST` plumbing (4 files + tests) | full check green |
| **1b** | Add `useMeterDisplay`; App consumes it by destructuring (all 1800 lines of consumers unchanged) | hook unit-tested; check green |
| **1c** | Engines take `display` object; param lists shrink (audio 22→13, file 18→13) | check green; hook tests updated |
| **2** | Capture engine owns `audioRef`/`rafRef`/`running`; exposes `{start, stop}` (needs `running` consumer audit) | separate plan |
| **3** | File engine + intake ring ownership (`liveIntakeRef`/`intakeRef` switching moves out of App) | separate plan |
| **4** | App slimming; retire the grep-test (`App.toolbar.test.js`) in favor of behavior tests | separate plan |

Phases 0–1c are covered by `docs/superpowers/plans/2026-07-08-c2-phase1-meter-display-owner.md`.
Each phase lands as independent commits with the full `npm run check` gate (learned: guard
tests cross language sides in this repo — always run the full suite).

## Non-goals

- `useSettings` split (that is review item C3, separate track).
- `useHistoryInteraction` rework (phase 4+, after the display owner exists).
- Any behavior/visual change. Every phase is observable-behavior-preserving; the smoke test
  plus the full suite must stay green without assertion changes (except where a test asserted
  the dead params).

## Risks

- **Effect dep arrays** in `useAudioEngine` rely on stable identities and eslint-disable
  blocks; moving params into an object must not add the object to deps (see Setter identity).
- **`clearMeterDisplayState` vs initial audio state**: App's initial `audio` object and its
  clear-time object must be diffed before unifying into one constant; if they differ, keep
  both shapes verbatim.
- **jsdom smoke test** may reveal unmocked imports (tauri APIs, ResizeObserver, canvas).
  Iterate mocks in Phase 0 rather than weakening the assertions.
