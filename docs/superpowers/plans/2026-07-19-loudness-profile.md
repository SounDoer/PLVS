# Loudness Profile Implementation Plan

> **For agentic workers:** Implement slice-by-slice. Steps use checkbox (`- [ ]`)
> syntax. Keep commits small enough that each slice can be reviewed independently.
> Spec wins on product questions; this plan wins on sequencing.

**Goal:** Ship session-level Loudness Profiles per
`docs/superpowers/specs/2026-07-19-loudness-profile-design.md`: Off by default,
built-in short list + unsaved Custom + user library, toolbar switch/manage,
Stats value colouring, Loudness `ref` line owned by the active profile.

**Architecture:** Pure catalog/evaluate/missing modules under `src/lib/` (or
`src/config/`), session state in `plvs:settings` via a `useLoudnessProfile`
hook, UI entry as a Presets-like popover on normal header + dock header.
Loudness panels stop owning an editable `loudnessReferenceLufs`; they read the
active profile’s `referenceLufs` (null when Off). Stats colours are derived at
render from evaluate(status). Layout Presets snapshot only the active selection
(+ custom draft), not the user library.

**Tech Stack:** React 19, Vitest, existing settings/presets/persistence patterns,
`lucide-react`, signal CSS tokens (`--ui-signal-warn` / `--ui-signal-bad`).

**Spec:** `docs/superpowers/specs/2026-07-19-loudness-profile-design.md`

**Implement-time locks (close open items from the spec):**

- EBU R128 Programme Integrated tolerance in UI: **±0.5 LU**.
- ATSC Dialogue Coverage below **15%** → inconclusive (warn colour) for
  dialogue target evaluation.
- Cut over by **deleting independent writes** of `loudnessReferenceLufs` from
  Loudness settings UI; keep the field only as a mirrored/derived value for
  one release if presets/tests still need it, then prefer reading
  `activeProfile.referenceLufs` directly in Loudness render paths.
- Toolbar icon: `Gauge` from `lucide-react` (swap only if it collides visually
  with another header control in review).
- Header slot: after **Presets**, before **Settings** (and the same relative
  order in dock header accessories).

---

## File Structure (expected)

**Add**

- `src/lib/loudnessProfileCatalog.js` (+ `.test.js`) — Off, built-ins, default
  custom draft factories; selection id helpers.
- `src/lib/loudnessProfileEvaluate.js` (+ `.test.js`) — pure status evaluation.
- `src/lib/loudnessProfileMissing.js` (+ `.test.js`) — missing preferred metrics
  + fulfill plan (append stats ids).
- `src/lib/loudnessProfileNormalize.js` (+ `.test.js`) — persist shape normalize.
- `src/hooks/useLoudnessProfile.js` (+ `.test.jsx`) — settings R/W, apply,
  duplicate, save-as, rename, delete, refLayerWanted, preset snapshot helpers.
- `src/components/LoudnessProfilePopover.jsx` (+ `.test.jsx`) — list / detail /
  missing fulfill UI.

**Modify (high touch)**

- `src/settings/defaults.js` — settings defaults / normalize for
  `loudnessProfiles` blob; retire standalone editable reference as product
  surface (keep `normalizeReferenceLufs` only if still used as a number clamp).
- `src/config/loudnessReferenceProfiles.js` — either delete after catalog lands
  or reduce to re-export default custom numbers from catalog.
- `src/lib/panelControls.js` + tests — stop treating editable reference as a
  user-facing default path; align defaults with Off (no forced −23 ownership).
- `src/components/PanelSettingsContent.jsx` + tests — remove
  `SettingsLufsInput` / Reference row from `LoudnessSettingsRows`.
- `src/dock/editors/DockModuleSettings.jsx` — same removal for dock loudness.
- `src/components/panels/LoudnessPanel.jsx`, `src/dock/modules/DockLoudness.jsx`
  — ref line from active profile; hide `ref` layer when Off.
- Loudness history layer pickers (panel settings / dock) — conditional `ref`
  option.
- `src/components/panels/StatsPanel.jsx` (+ tests) — colour values from evaluate.
- `src/components/AppHeader.jsx` (+ tests) — Loudness Profile popover trigger.
- Dock header accessory path (`DockHeader` / preset rows pattern like
  `DockPresetsRow.jsx`) — same popover content.
- `src/hooks/usePresets.js` (+ tests) — snapshot/restore active + customDraft.
- `src/persistence/profileShape.js` (+ tests) if configuration-profile export
  must round-trip the new settings fields.
- `docs/loudness-references.md` — already pointed at the design; touch only if
  built-in copy drifts.

**Avoid**

- Rust / DSP changes for v1.
- File analysis / CLI QC wiring (roadmap only).
- System Settings page for Loudness Profiles.

---

## Slice 0: Pure cores (catalog / evaluate / missing)

No UI. Land testable rule logic first.

### Task 0.1 — Catalog

- [ ] **Step 1:** Add `loudnessProfileCatalog.js` with:
  - selection ids: `off`, `unsaved-custom`, `builtin:ebu-r128`,
    `builtin:ebu-r128-live`, `builtin:ebu-r128-s1`, `builtin:atsc-a85`,
    `builtin:streaming-14`, `user:<uuid>`
  - `createDefaultCustomDraft()` → reference −23, preferred
    `integrated` + `truePeak`, rules matching design
  - built-in table from the spec (Programme ±0.5, Live ±1.0, S1 ST Max −18,
    ATSC dialogue −24 ±2 + TP −2, Streaming −14 + TP −1)
  - `resolveActiveDocument(state) → RuleDocument | null` (null for Off)
- [ ] **Step 2:** Colocated tests for ids, default draft, every built-in’s
  `referenceLufs` + key limits.
- [ ] **Step 3:** `npm test -- src/lib/loudnessProfileCatalog.test.js`

### Task 0.2 — Evaluate

- [ ] **Step 1:** `loudnessProfileEvaluate(document, sample) → { [metricId]: status }`
  statuses: `off` | `na` | `unwatched` | `pending` | `inconclusive` | `ok` |
  `warn` | `fail`
- [ ] **Step 2:** Cover: Off → all unwatched/off; S1 ST Max fail; Live
  provisional pending; ATSC low coverage inconclusive; near-band warn; in-range
  ok; descriptor never fail.
- [ ] **Step 3:** `npm test -- src/lib/loudnessProfileEvaluate.test.js`

### Task 0.3 — Missing

- [ ] **Step 1:** `listMissingPreferredMetrics(document, statsVisibleIds)` and
  `planShowMissing(visibleIds, missingIds) → nextVisibleIds` (append only,
  stable order of existing).
- [ ] **Step 2:** Tests: no missing when visible; append without reordering;
  dialogue ids included in missing list when preferred but hidden (gating is
  implicit via showing those rows — do not special-case copy here).
- [ ] **Step 3:** `npm test -- src/lib/loudnessProfileMissing.test.js`

---

## Slice 1: Persistence + `useLoudnessProfile`

### Task 1.1 — Settings shape

- [ ] **Step 1:** Define normalize for:

```js
loudnessProfiles: {
  active: "off",
  customDraft: null | RuleDocument,
  userProfiles: RuleDocument[],
  refLayerWanted: true,
}
```

Default `active: "off"`. Invalid `user:<id>` → fall back to `off`.
- [ ] **Step 2:** Wire into settings read/patch path the same way other
  settings blobs are normalized (follow `useSettings` / domain patterns).
- [ ] **Step 3:** Tests for normalize + default cold start.

### Task 1.2 — Hook API

- [ ] **Step 1:** `useLoudnessProfile()` returns at least:
  - `active`, `document` (resolved), `userProfiles`, `customDraft`
  - `select(id)`, `selectOff()`, `selectUnsavedCustom()`
  - `duplicateBuiltin(id)`, `saveCustomAs(name)`, `updateUser(id, patch)`,
    `renameUser(id, name)`, `removeUser(id)`
  - `setRefLayerWanted(bool)`, `refLayerWanted`
  - `snapshotForPreset()` / `applyPresetSnapshot(snap)`
- [ ] **Step 2:** Hook tests with `settingsStore` (mirror `usePresets.test.jsx`
  store reset patterns): default Off; select built-in; edit custom draft
  persists; Save as creates user and selects it; delete active user → Off;
  draft preserved when switching built-in → back to Custom.
- [ ] **Step 3:** `npm test -- src/hooks/useLoudnessProfile.test.jsx`

---

## Slice 2: Loudness ref ownership (no popover yet)

Wire profile → ref line + remove numeric input. Can temporarily drive
`active` from tests / hook without full popover.

### Task 2.1 — Remove numeric Ref UI

- [ ] **Step 1:** Update `PanelSettingsContent` / dock loudness settings tests
  to expect **no** Reference LUFS input.
- [ ] **Step 2:** Remove `SettingsLufsInput` row from `LoudnessSettingsRows`
  (and dock equivalent). Layers row remains.
- [ ] **Step 3:** Fix any settings tests that only existed for that input.

### Task 2.2 — Ref line + Off hides layer

- [ ] **Step 1:** Loudness panel/dock read `referenceLufs` from
  `useLoudnessProfile().document` (null when Off).
- [ ] **Step 2:** When null: do not draw ref; omit `ref` from layer toggle UI;
  if `ref` was in `loudnessHistoryVisibleLayerIds`, stop drawing it (optionally
  strip on select Off while storing `refLayerWanted`).
- [ ] **Step 3:** When non-null: show `ref` toggle; restore visibility from
  `refLayerWanted` (default on); line Y uses profile reference.
- [ ] **Step 4:** Tests for Off vs EBU selection behaviour
  (`DockLoudness` / `LoudnessPanel` / layer settings as applicable).

---

## Slice 3: Stats colouring

### Task 3.1 — Wire evaluate → value colour

- [ ] **Step 1:** In `StatsPanel` (and dock Stats if separate), map each visible
  metric through `loudnessProfileEvaluate`.
- [ ] **Step 2:** Apply classes only on the **value** node:
  - unwatched / na / off → muted
  - ok → foreground
  - warn / pending / inconclusive → `text-[color:var(--ui-signal-warn)]`
  - fail → `text-[color:var(--ui-signal-bad)]`
- [ ] **Step 3:** Off → no warn/fail colours (everything muted/default).
- [ ] **Step 4:** Component tests with a mocked profile document + metric
  fixture values (S1 ST Max fail, etc.).

---

## Slice 4: Toolbar popover (header + dock)

### Task 4.1 — `LoudnessProfilePopover`

- [ ] **Step 1:** Component tests first (PresetsPopover style):
  - lists Off, built-ins, user profiles, Custom unsaved
  - click applies `select`
  - Duplicate on built-in → unsaved custom basedOn
  - Save as… names and creates user
  - user rename/delete
  - Missing stats line + Show missing calls fulfill (append visible ids)
  - built-in detail read-only; custom/user editable fields for reference +
    key limits (v1 edit surface can be minimal: reference + integrated
    target/tol + TP max + which preferred ids — keep form small)
- [ ] **Step 2:** Implement list + detail modes; honesty microcopy for ATSC /
  Streaming (reference, not certification).
- [ ] **Step 3:** Missing copy only: `Missing stats: …` / `Show missing`.
  Fulfill uses `planShowMissing` against **all** Stats panel instances in the
  workspace (and dock stats controls if independent): append ids everywhere
  Stats is shown; if no Stats instance exists, keep the missing line.

### Task 4.2 — Header + dock entry

- [ ] **Step 1:** `AppHeader` — IconButton tip `Loudness Profile`, slot after
  Presets / before Settings; active styling when `active !== "off"`.
- [ ] **Step 2:** Dock header — mirror via the same content component (follow
  `DockPresetsRow` pattern: thin wrapper that mounts
  `LoudnessProfilePopover`).
- [ ] **Step 3:** Header/dock tests for trigger presence and tip text.
- [ ] **Step 4:** Wire Show missing into workspace/dock panelControls updates
  (`statsVisibleIds`).

---

## Slice 5: Layout Presets snapshot

### Task 5.1 — Save / apply

- [ ] **Step 1:** Extend preset object with:
  - `loudnessProfileActive`
  - `loudnessProfileCustomDraft` (only needed when active is unsaved-custom;
    may always store draft snapshot for simplicity)
- [ ] **Step 2:** `usePresets` save/update capture via
  `snapshotForPreset()`; apply calls `applyPresetSnapshot`.
- [ ] **Step 3:** Missing `user:<id>` on apply → `off` (or apply draft copy —
  prefer **Off** + leave library untouched; assert in test).
- [ ] **Step 4:** Tests in `usePresets.test.jsx` for round-trip and missing user
  fallback.
- [ ] **Step 5:** Ensure configuration-profile export/import still validates if
  it freezes settings shape (`profileShape`).

---

## Slice 6: Cleanup + verification

### Task 6.1 — Dead paths

- [ ] Remove or narrow legacy `settings.referenceLufs` UI if any remains in
  Settings (product surface should not offer a second Ref editor).
- [ ] Update tests that still patch `loudnessReferenceLufs` as the way to move
  the ref line; point them at Loudness Profile selection instead.
- [ ] Confirm `docs/loudness-references.md` still matches shipped built-ins.

### Task 6.2 — Gate

- [ ] Targeted Vitest for all new/changed files while slicing.
- [ ] `npm run check` before merge.
- [ ] Manual smoke (normal + dock):
  1. Cold start → Off, no ref line, Stats uncoloured.
  2. Select EBU R128 → ref at −23, Layers shows `ref`.
  3. Select Off → `ref` hidden, line gone.
  4. EBU S1 with ST Max over −18 → value warn/fail colour.
  5. ATSC with dialogue stats hidden → Missing + Show missing appends rows
     (dialogue sidechain follows visibility).
  6. Save Custom as user; restart; still selected.
  7. Save layout Preset with Streaming −14; switch Off; apply Preset →
     Streaming restored.
  8. Dock header can switch profiles the same way.

---

## Suggested commit boundaries

1. Slice 0 pure libs  
2. Slice 1 hook + settings  
3. Slice 2 Loudness ref cutover  
4. Slice 3 Stats colours  
5. Slice 4 popover + toolbar/dock  
6. Slice 5 presets snapshot  
7. Slice 6 cleanup + docs touch-ups  

## Out of plan (do not sneak in)

- File / CLI QC against profiles  
- Extra built-ins (Apple / Netflix / regional)  
- Relative LU scale  
- Settings page duplicate entry  
