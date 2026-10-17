# Cross-platform desktop-performance acceptance implementation plan

**Date:** 2026-10-18

**Design:**
`docs/history/specs/2026-10-18-cross-platform-desktop-performance-acceptance-design.md`

## 1. Add the private development performance protocol

- Add a continuous renderer probe owned at application scope. Keep animation-frame count, maximum
  gap, latest-frame time and DOM count available through a synchronous snapshot.
- Add closed request normalization and handlers for private performance snapshot and bounded stall
  methods beside the existing development-fixture protocol.
- Gate both methods on the dev identity and omit them from public capabilities, generated docs and
  the packaged CLI parser.
- Extend the feature-gated Rust CLI with hidden development performance commands and exact JSON
  adaptation.
- Test disabled-identity refusal, request bounds, timeout-safe snapshots, deterministic stalls and
  private-method coverage.

## 2. Split orchestration from platform observation

- Refactor `desktop-perf-rig.mjs` into shared lifecycle/scenario orchestration plus Windows and
  macOS launch and process adapters.
- Preserve the existing Windows executable, WebView2, PowerShell and CDP behavior behind its
  adapter before changing verdict code.
- Add an optimized macOS dev launch with isolated app data and registry roots, exact executable
  binding, single-instance checks, and foreground-window verification.
- Reuse the cross-platform capture route, targeted player cleanup and rig lease rather than
  duplicating VB-Cable or BlackHole discovery.
- Represent unsupported adapter metrics explicitly with capability and reason fields.

## 3. Normalize observations and verdicts

- Move phase comparison into platform-neutral functions over the shared diagnostic snapshot.
- Run normal, bounded-stall and recovered phases for default and heavy workspaces.
- Retain the heavy-workspace leaf-count and Stereo Map assertion.
- Add hard request and phase deadlines so a throttled or wedged renderer becomes evidence rather
  than hanging the runner.
- Cover advancing frames, bounded drops, audio continuity, stale animation frames, recovery,
  malformed optional fields and unsupported capabilities in unit tests.

## 4. Produce shared acceptance evidence

- Add `performance` to the shared acceptance domain list only in the same commit that makes the
  short runner write a valid result on every success and failure path.
- Record the six fixed scenario ids, exact clean source SHA, normalized capabilities, snapshots,
  artifact hashes, warnings and cleanup observations.
- Keep the current console report readable while making `result.json` authoritative.
- Extend acceptance-report tests for passed, failed, missing, stale and unsupported optional
  performance observations on Windows, macOS and future Linux evidence.

## 5. Make desktop soak cross-platform

- Use the same launch, scenario, capture, snapshot and process adapters in `soak-desktop.mjs`.
- Preserve default duration, sample cadence, JSONL shape where compatible, and the hard failure on
  UI-frame or audio-chunk drops.
- Add a normalized final summary and capability metadata without inventing values for unavailable
  WKWebView metrics.
- Unit-test resource attribution and summary behavior with captured Windows and macOS fixtures.

## 6. Document the current workflow

- Update `CONTRIBUTING.md` with prerequisites, both commands, optimized dev identity behavior,
  artifact locations and interpretation of unsupported metrics.
- Update the durable performance and Agent Control documentation only for behavior implemented by
  the finished runner; keep spike measurements and implementation history in `docs/history/`.
- Extend documentation structure checks where command names or private/public boundaries can be
  derived from code.

## 7. Verify and commit in recoverable stages

1. Commit the private protocol and continuous probe after focused frontend/Rust tests and the
   repository-required mixed-change checks.
2. Commit the adapter refactor only after existing Windows contract fixtures pass unchanged and a
   real macOS optimized app completes a diagnostic snapshot and bounded recovery run.
3. Commit shared evidence and report integration after failure-path and cleanup tests.
4. Commit the cross-platform soak adapter after a short macOS default and heavy run proves the
   output contract.
5. Run `npm test`, `npm run format:check`, `npm run lint`, `npm run typecheck`, and
   `npm run rust:check` before each mixed frontend/Rust commit.
6. Run `npm run check:changes` before any push or merge.

Retain one real macOS short-run evidence receipt and short default/heavy soak artifacts. When a
Windows rig becomes available, run the same commands there and report the missing evidence
prominently until then; do not weaken, skip or reinterpret its automated contract.
