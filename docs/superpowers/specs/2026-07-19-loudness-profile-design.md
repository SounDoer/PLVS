# Loudness Profile — design

**Date:** 2026-07-19  
**Status:** Draft  
**Revises / supersedes (product behaviour):** the thin UI-overlay notes in
`docs/loudness-references.md` and the free-form `loudnessReferenceLufs` /
legacy `settings.referenceLufs` editing model for Loudness reference.

## Summary

Introduce a session-level **Loudness Profile**: a named rule set that drives

1. the Loudness history **reference line** value (when the profile has a target),
2. **Stats** metric value colours for watched / warn / fail states,
3. a single header (and dock) toolbar entry for switch + manage.

This is **not** a claim of platform certification. Built-ins are delivery /
broadcast **references** with clear rules; user profiles are personal watch
rules. Measurement remains ITU-R BS.1770 / existing PLVS dialogue-VAD paths.

Default is **Off**: no rule evaluation, no Stats profile colouring, and no
reference line.

## Motivation

- A single editable LUFS number cannot express real standards (EBU Short-form
  ST Max, ATSC dialogue anchor + TP −2, Live tolerance, etc.).
- Platform names (Spotify / YouTube) mostly share the same −14 / −1 pair; they
  should not be sold as distinct “compliance presets.”
- Stats already aggregates the metrics standards care about; colouring those
  values is the lightest useful QC surface for live monitoring.
- Free-form Reference input in Loudness settings fights a profile-owned target.

## Goals

- One **active** Loudness Profile per session (singleton).
- Single UI entry: header / dock toolbar popover (switch **and** manage).
- Built-in short list + unsaved Custom + saved user profiles + **Off**.
- Stats: colour-only status on **already visible** rows; no summary strip; no
  font-size / weight changes.
- Loudness: remove numeric Ref input; keep Layers `ref` toggle; `ref` line
  follows the active profile target when present.
- Missing prerequisites (hidden Stats rows, including cases that also need
  dialogue gating) surface as one user-facing “missing stats” affordance with
  one-click fulfill.
- Layout **Presets** snapshot the *active* Loudness Profile selection (and
  unsaved custom draft), not the whole user-profile library.
- File-mode QC / report integration is **out of v1** (roadmap note only).

## Non-goals (v1)

- File Analysis summary / CLI report Pass–Fail against profiles.
- Relative LU scale UI (`0 LU` = target).
- Official certification language (“ATSC certified”, “EBU Mode meter”).
- Full Youlean preset catalogue (OP-59, ARIB, AGCOM, Spotify Loud, etc.).
- Auto-changing Stats visibility or Dialogue Gating without the missing fulfill
  action.
- Second entry in System Settings for Loudness Profiles.
- Green “all good” colouring (`signal.good`) for in-range watched metrics.

## Naming

Call this feature **Loudness Profile** everywhere in UI and docs.

Do **not** shorten to “Profile” alone: the app already has **Configuration
Profile** (import/export of `plvs:*` domains).

## Current state (relevant)

- Loudness reference is a per-loudness-panel control:
  `panelControls.loudnessReferenceLufs` (default −23), editable via
  `LoudnessSettingsRows` / `SettingsLufsInput`.
- Loudness history layers include `ref` in
  `loudnessHistoryVisibleLayerIds`; the line uses the panel’s reference LUFS.
- Stats rows are independently visible/ordered; dialogue rows visibility
  already drives VAD / dialogue gating (see dialogue-gated loudness design).
- Persistence domains: `plvs:settings`, `plvs:workspace`, `plvs:presets`,
  `plvs:themes`.
- Layout Presets already snapshot workspace + `panelControlsById` (including
  today’s `loudnessReferenceLufs`).
- Thin doc `docs/loudness-references.md` describes overlay intent only.

## Product model

### Active selection

Exactly one of:

| Selection | Meaning |
| --- | --- |
| `off` | No watched metrics; no status colours; no ref line; Layers hide `ref`. |
| `unsaved-custom` | Editable draft rules; not in the user library until Save as. |
| `builtin:<id>` | Read-only built-in rules. |
| `user:<id>` | Saved user profile; editable in the popover. |

Default on first launch / empty state: **`off`**.

### Rule document (logical shape)

Each non-Off profile carries:

- `id`, `name`, `kind` (`builtin` | `user` | `draft`)
- optional `basedOn` (user/draft duplicated from a built-in)
- `referenceLufs: number | null` — drives the Loudness `ref` line when non-null
- `metrics: { [metricId]: MetricRule }` — evaluation rules
- `preferredMetricIds: string[]` — metrics the profile cares about (for missing
  detection and for which rows can leave muted)

`MetricRule`:

- `role`: `target` | `limit` | `watch` | `descriptor` | `na`
- optional `target`, `tolerance: { minus, plus }`, `max`, `min`
- `severity` for breaches: `fail` | `warn` (descriptors / `na` do not fail)
- `unit` for display/tips only

#### Evaluation input contract

`loudnessProfileEvaluate(document, sample)` takes exactly this `sample`:

```js
{
  values: { [metricId]: number },   // metricId from statsCatalog STATS_CANONICAL_ORDER
  integratedReady: boolean,
  dialogueCoverage: number | null,  // percent, null when the dialogue path is inactive
}
```

All three are already available from the frame the engine emits
(`src/lib/tauriFrameApply.js`); **no new engine or DSP data is required**:

- `integratedReady` — the engine emits `-Infinity` for `integrated` until it is
  ready, so this is `Number.isFinite(displayAudio.integrated)`.
- `dialogueCoverage` — `displayAudio.dialoguePercent` (already `null` when
  unavailable). A `null` here also means "dialogue path inactive"; there is no
  separate flag.

Deliberately **not** in the contract: elapsed time or accumulated gated audio
since Clear. The engine does not expose it, and wall-clock elapsed
(`useSessionTimer`) is not a valid proxy — quiet material can run for minutes
with almost no gated audio. See the Live built-in below for how this is avoided.

Evaluation (per visible Stats row that has a rule):

1. No rule / not in preferred set → treat as unwatched (muted).
2. `na` → muted (e.g. LRA under Short-form); tip may say N/A.
3. Insufficient data (`integratedReady === false`, dialogue coverage below the
   profile's threshold, `dialogueCoverage == null` for a dialogue rule) →
   **inconclusive** / pending → **warn colour**.
4. Outside target band or over hard limit → **fail** colour when
   `severity === fail`, else warn.
5. Near boundary (implementation may use a small fixed margin, e.g. 0.5 LU) →
   warn.
6. Else → watched in-range → **foreground** (not green).

Realtime is **monitoring**: integrated-style conclusions are provisional. Where
a profile wants to say so (Live), it does it as a **static property of the
rule**, never as a time threshold. File QC is later.

### Built-in short list (v1)

| Id | Name | Reference line | Watched rules (summary) |
| --- | --- | --- | --- |
| `ebu-r128` | EBU R128 | −23 | Integrated target −23 (±0.5 production / ±0.2 QC display tol — pick one tol band for v1 UI, document as reference); TP max −1 fail; LRA descriptor; M/ST max watch optional |
| `ebu-r128-live` | EBU R128 Live | −23 | Same as Programme; Integrated tolerance **±1.0**; Integrated is **permanently** provisional (a rule flag, not a timer — realtime Integrated never "settles") |
| `ebu-r128-s1` | EBU R128 S1 | −23 | Integrated −23; **ST Max ≤ −18** fail; TP max −1 fail; LRA `na` |
| `atsc-a85` | ATSC A/85 | −24 | Dialogue Integrated target −24 (±2); TP max −2 fail; Dialogue Coverage used for inconclusive when too low; program Integrated watch/fallback only as documented in tips — **not** claimed certified |
| `streaming-14` | Streaming −14 | −14 | Integrated target −14 **±1.0**, breach severity **warn**; TP max −1 **warn**; framed as playback reference (Spotify Normal / YouTube-class), not reject-on-upload — a hard fail would contradict that framing |

Plus:

- **Off**
- **Unsaved Custom** default draft when created/selected: Integrated target
  **−23**, TP max **−1**, both watched; user may edit in popover

Built-ins are **read-only**. To change numbers: **Duplicate** → unsaved custom
or Save as user profile.

Honesty copy (popover detail / tips): PLVS does not claim legal or platform
certification; ATSC/Netflix-class dialogue uses on-device VAD, not Dolby DI.

### Unsaved Custom vs Off vs user

- **Off**: empty preferred metrics; `referenceLufs = null`.
- **Unsaved Custom**: draft in memory/persistence; Save as → user profile;
  selecting a built-in leaves the draft discarded or kept only if we explicitly
  stash — v1: switching away from unsaved custom **keeps** the last draft in the
  `customDraft` slot so returning to Custom restores it (like a single scratch
  pad).
- **User**: named library entries; rename / delete / edit rules in popover.

## UI

### Entry

- Normal window header only: toolbar **IconButton** + popover, same family as
  Presets / Modules. Slot: after Presets, before Settings.
- Tooltip: `Loudness Profile`.
- Active affordance: when selection ≠ Off, the icon takes the same “active”
  foreground treatment as other header tools.

**No dock entry.** The profile still *applies* while docked — it is session
state, so the reference line, the Stats colouring and the TP Max marker all
follow it there — but it cannot be *changed* from the dock. Docked is a
monitoring posture, not a configuration one, and a 40px strip is the wrong
place to rename or delete library entries. Users configure before docking.

This is also why there is no protocol work here: the dock accessories are
separate windows driven by a serialisable payload plus a whitelisted action
list (`accessoryProtocol.js`), with all state owned by the main window. Note
that letting a dock window call the profile hook directly is **not** an
available shortcut: `pluginStoreBackend.subscribe()` is a deliberate no-op
because persistence assumes a single writing process, so a second writer
would silently clobber settings.

### Popover IA (Presets-like)

1. **List mode (default)**
   - Current selection label (`Off`, `Custom · unsaved`, or name).
   - Groups: Off · Built-in · User (Custom draft sits with Off/Custom, not in
     User until saved).
   - Row click applies.
   - Row actions for user: rename / delete; built-in: duplicate.
   - If preferred metrics are not currently satisfied in Stats (see Missing):
     a single line like `Missing stats: …` + **Show missing** (copy must not
     mention Dialogue Gating).
2. **Edit / detail mode** (user + unsaved custom)
   - Edit name (user), reference target, per-metric target/limit/severity.
   - Built-in detail is read-only summary + Use / Duplicate.
3. **Save as…** from unsaved custom → prompts name → user library.

No System Settings page for this in v1.

### Stats

- Do **not** change `statsVisibleIds` / order except via Missing fulfill.
- Colour only the **value** (existing signal tokens):

| State | Colour |
| --- | --- |
| Unwatched / Off / N/A | `muted-foreground` (or default row styling as today for unwatched) |
| Watched, in range | `foreground` (slightly more present than muted; **not** `signal.good`) |
| Warn / pending / inconclusive | `signal.warn` |
| Fail | `signal.bad` |

- Hover tips may explain limit vs value; no top-of-panel summary.

### Dock Stats is a second implementation

`DockStats.jsx` is its own component, not a rendering mode of `StatsPanel`, and
`dockModuleControls.js` gives it its **own** `statsVisibleIds`. Both facts are
easy to miss and each produces a split-brain bug:

- Status colouring must be applied in **both** components. Colour one and the
  same metric under the same profile reads as a breach in the normal window and
  as neutral in the dock.
- Missing-stats detection must union **both** id sets, and fulfill must append
  to both. Otherwise Show missing appears to succeed while the dock keeps
  hiding the rows the profile needs.

Neither needs the accessory protocol: `dockLayout` lives in the main window and
`DockStats` is rendered by it.

### Level Meter — TP Max marker

The Level Meter already draws a TP Max marker, and it must follow the active
profile rather than keeping a second opinion about "TP is too hot".

Current state: `LevelMeterPanel.jsx` passes
`className="text-[color:var(--ui-signal-tp-max)]"` to `AxisValueMarker`
**unconditionally** — the marker is always that colour, with no threshold check
anywhere. `buildThemeTokens.js` defines `--ui-signal-tp-max` as an alias of
`signal.bad`, so today it renders identically to a failure. The token's
documented meaning (`docs/design-tokens.md`: "TP MAX value text when exceeded")
describes an intent that was never implemented.

Target state — make that `className` conditional:

| Condition | Colour |
| --- | --- |
| No active profile, or TP within the profile's limit | none — inherit `AxisValueMarker`'s base `text-primary` |
| TP over the active profile's limit | `text-[color:var(--ui-signal-tp-max)]` |

`text-primary` is the theme **accent seed** (`buildThemeTokens.js` maps
`--primary: accent`), which is what the Momentary / Short-term floating value
markers on the same meter already use — accent is this app's live-measurement
colour (Momentary curve, peak-sample line, vectorscope, waveform, spectrum all
seed from it). An in-range TP Max readout should look like the other readouts on
its own meter.

**Do not write `text-accent`.** In shadcn's vocabulary `--accent` is a neutral
hover background, unrelated to the brand colour; PLVS's accent seed feeds
`--primary`. `text-accent` renders as near-invisible grey.

No token values change, so `buildThemeTokens.js` and its snapshot test are
untouched. `docs/design-tokens.md`'s existing description becomes accurate as a
side effect and needs no edit.

Accepted visual change: with no profile selected the TP Max marker is no longer
red. That is intended — Off means no judgement — but it is a visible change to
the default first-run appearance.

### Loudness panel

- **Remove** numeric Reference LUFS control from Loudness settings (workspace +
  dock editors).
- Layers: keep Momentary / Short-term / **ref** toggles as today when the
  active profile has `referenceLufs != null`.
- When selection is **Off** (`referenceLufs == null`):
  - **Hide** the `ref` layer control.
  - Do not draw a reference line.
  - Persist the user’s previous “wanted ref visible” preference separately if
    needed so returning to a profile can restore it; do not leave a phantom −23
    line under Off.
- When a profile with a target is selected, `ref` control returns; line uses
  profile `referenceLufs`. Default ref layer visibility when entering from Off:
  restore last preference, else default **on**.

### Footer

`App.jsx` derives one `referenceLufs` and fans it out to **two** consumers: the
loudness history data, and `footer`, which `AppShell.jsx` renders as
`{footer.referenceLufs} LUFS`.

Under Off the value is `null`, so the footer would read `null LUFS` (or a bare
` LUFS`). **Hide the footer reference item entirely when the active profile has
no `referenceLufs`.** This is the same "no phantom −23" rule as the chart; the
footer is easy to miss because it is not part of the Loudness panel, and Off is
the cold-start default, so getting it wrong is visible on the very first screen.

### Missing stats (unified)

User-facing: only “some required stats are not shown.”

Under the hood, **Show missing** may:

1. Append missing `preferredMetricIds` to Stats visibility (additive; no reorder
   of existing; no removals).
2. If those metrics require dialogue gating / VAD, enable whatever existing
   mechanism already ties dialogue rows to the sidechain (today: showing
   dialogue stats). Do **not** surface a separate “Enable Dialogue Gating”
   message.

If fulfill cannot run (e.g. no Stats panel instance), keep the missing line;
do not invent a second Settings path in v1.

## Persistence

### Library + active selection → `plvs:settings`

Suggested fields (names flexible at implement time):

```text
loudnessProfiles: {
  active: "off" | "unsaved-custom" | "builtin:<id>" | "user:<id>",
  customDraft: RuleDocument | null,
  userProfiles: RuleDocument[],
  refLayerWanted: boolean   // last user intent for ref visibility when available
}
```

- Do **not** require migrating old `referenceLufs` / per-panel
  `loudnessReferenceLufs` into meaningful history; cold default is Off.

#### Per-panel `loudnessReferenceLufs`: delete it

Not "mirror it for one release" — **delete the panel control outright.** The
active profile is a session singleton and is the better owner; keeping a
mirrored copy reintroduces the two-writer ambiguity this section exists to
prevent, and it does not save any work (the `App.jsx` read path has to change
either way).

`App.jsx` currently derives `referenceLufs` by finding the first loudness panel
and reading its `panelControls.loudnessReferenceLufs`. Replace that whole
derivation with a read of the active profile's `referenceLufs` (`null` when
Off).

#### Legacy `settings.referenceLufs`: two halves, only one gets removed

These look alike and are not alike. Removing the wrong half causes no visible
failure on a dev machine and silently drops a field from existing users' config
round-trips.

**Delete — genuinely dead:** the `referenceLufs` state, `settingsStore.patch`,
and export in `src/hooks/useMeterSettings.js`. Nothing in the repo consumes the
exported value; `useSettings.js` passes it through and no caller reads it. It
only reads and writes itself.

**Keep — old-data compatibility, do not touch:**

- `src/hooks/usePresets.js` `legacyReferenceLufs` fallback
- `src/persistence/profileShape.js` `normalizeSettings` handling
- the `src-tauri/src/profile.rs` fixture that asserts the round-trip

These do not drive any UI. They exist so configuration files already on disk
still import/export losslessly. Deleting them looks harmless on a fresh install
and breaks upgrading users.

Note the cross-side trap (see AGENTS.md): touching `profileShape` turns a
frontend Vitest suite red because of Rust-side config expectations, which reads
like an unrelated frontend failure.

### Layout Presets → snapshot active only

When saving/updating a layout Preset, include:

- `loudnessProfileActive` (selection id)
- `loudnessProfileCustomDraft` (if active is unsaved-custom)

Do **not** embed the full `userProfiles[]` library in each preset.

On preset apply: restore that selection + draft; resolve `user:<id>` if still
present, else fall back to Off or unsaved draft copy (document in impl).

Themes analogy: theme *library* ≠ each layout preset; *which theme was active*
can be part of a view snapshot — same idea here.

## Modules (implementation sketch)

Deep / testable pure cores (preferred):

1. **`loudnessProfileCatalog`** — built-in definitions + default custom draft.
2. **`loudnessProfileEvaluate`** — `(profile, metricsSample) → perMetricStatus`
   pure function (ok / warn / fail / inconclusive / off / na).
3. **`loudnessProfileMissing`** — `(profile, statsVisibleIds, dialogueReady) →
   missingIds` and fulfill plan.
4. **`useLoudnessProfile`** (or equivalent) — settings persistence, apply,
   duplicate, save-as, preset snapshot helpers.
5. **UI** — toolbar popover; Stats value colour wiring; Loudness ref line +
   layer visibility; remove LUFS input.

Engine / DSP: no change required for v1 built-ins beyond existing integrated /
ST max / TP / dialogue readouts.

## Testing decisions

- Prefer pure-function tests for catalog constants, evaluation, and missing
  fulfill planning (Vitest, colocated).
- Component tests for: Off hides ref layer; selecting built-in draws ref;
  Stats colours by status token class; Missing fulfill appends ids; popover
  apply/save-as/duplicate.
- Do not assert private React state shape; assert visible behaviour and store
  snapshots where the repo already tests presets/settings that way
  (`usePresets.test.jsx`, panel controls tests).

## Roadmap (not v1)

- File Analysis / CLI report: evaluate the same profile rules for session
  summary Pass / Fail / Inconclusive.

  **Constraint on v1 field design.** The CLI already ships a competing rules
  model: `--reference-lufs` (display only) plus `--target-lufs` /
  `--lufs-tolerance` as the actual QC gate (`docs/cli.md`). v1 deliberately does
  not touch it, but the convergence direction is that the CLI flags will one day
  be **derived from a profile**. So a profile's Integrated rule must stay
  losslessly expressible as a target + tolerance pair. This costs v1 nothing; it
  only rules out shapes that would strand the CLI later.
- Additional built-ins: Apple Music −16, Netflix dialogue −27, AES Streaming
  band, regional −24 variants.
- Optional relative LU display mode for EBU-style metering.

## Decisions (locked)

1. Feature name: **Loudness Profile**; session singleton.
2. Single entry: normal-window header popover; switch and manage there only.
   No dock entry — the profile applies while docked but is not editable there.
3. Default: **Off**.
4. Off: no metric colouring; **hide** Layers `ref`; no reference line; no
   phantom −23.
5. Unsaved Custom default rules: Integrated −23 + TP −1.
6. Built-ins v1: EBU R128, EBU R128 Live, EBU R128 S1, ATSC A/85, Streaming −14
   (all read-only; edit via Duplicate).
7. Remove Loudness numeric Ref input; ref line value owned by active profile.
8. Stats: colour only; no summary chrome; no type size/weight changes; no
   `signal.good` for in-range.
9. Do not auto-mutate Stats visibility; Missing = unified “stats not shown” +
   Show missing (may enable dialogue path under the hood without saying so).
10. Persist library + active in `plvs:settings`; Presets snapshot active (+
    custom draft) only.
11. File-mode profile QC deferred, but Integrated rules must stay expressible as
    target + tolerance so the CLI can derive its flags from a profile later.
12. No compliance certification claims in UI.
13. `evaluate` takes `{ values, integratedReady, dialogueCoverage }` and nothing
    else. No time-since-Clear input; Live's provisional status is a static rule
    property.
14. Level Meter TP Max marker follows the active profile: base `text-primary`
    when in range or no profile, `--ui-signal-tp-max` when over limit. No token
    values change.
15. Footer hides its reference item when the active profile has no
    `referenceLufs`.
16. `loudnessReferenceLufs` is **deleted** from panel controls, not mirrored.
17. `useMeterSettings`'s `referenceLufs` is deleted; the `usePresets` /
    `profileShape` / Rust-fixture compatibility paths are kept.

## Open at implement time (non-blocking)

- Exact toolbar slot index and icon.
- Precise Integrated tolerance numbers shown for EBU Programme (±0.5 vs ±0.2
  QC) in tips.
- ATSC minimum Dialogue Coverage threshold for inconclusive.
- Popover visual density / edit form control kit (reuse Settings rows where
  possible).

## Further notes

- Keep `docs/loudness-references.md` as a short source bibliography, or replace
  it with a pointer to this design + the built-in table once implemented.
- PRD user story 14 (“reference targets on the same LUFS readout”) is advanced
  by this work; update `docs/prd.md` appendix when shipping if the living PRD
  still lists it as gap-only.
