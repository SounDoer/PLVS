# Loudness Profile editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Loudness Profiles a floating editor where a user picks which metrics a profile watches, sets each rule's numbers and severity, and sees the meter follow the draft live.

**Architecture:** A `LoudnessProfileProvider` replaces four independent `useLoudnessProfile()` instances with one, and holds a preview draft alongside the persisted state. `document` resolves to `draft ?? resolveActiveDocument(persisted)`, so a draft outranks the selection for every reader without touching disk. The editor panel copies `ThemeEditor`'s frame but not its rollback machinery — with an overlay, Cancel is `setDraft(null)`.

**Tech Stack:** React 19, Vitest + @testing-library/react, Tailwind, Radix (`Dialog`, `Popover`), `lucide-react`.

**Spec:** `docs/superpowers/specs/2026-07-20-loudness-profile-editor-design.md`

---

## Before you start

Run `npm run check` once. It must be green (209 files / 1847 tests as of `a146aebf`). If it is not, stop — you are not on a clean base.

Every task ends green. Commit messages are English, subjects never start with `@`.

**The cross-side trap (AGENTS.md):** Vitest collects every `*.test.js` in the repo, including suites that read `src-tauri/tauri.conf.json`. If one of those goes red, fix the config, not the test. Nothing in this plan should touch them.

## File structure

| File | Responsibility | Task |
| --- | --- | --- |
| `src/lib/loudnessProfileCatalog.js` | Built-ins, selection ids, metric→shape table, draft factories | 1, 4, 5, 10 |
| `src/lib/loudnessProfileNormalize.js` | Persisted-blob normalization; empty rules survive | 1, 10 |
| `src/lib/loudnessProfileEvaluate.js` | Empty rules judge nothing | 2 |
| `src/lib/loudnessProfileMissing.js` | Empty rules demand nothing | 3 |
| `src/hooks/LoudnessProfileContext.jsx` | **New.** Provider: persisted state + preview draft + editor API | 6, 7, 11 |
| `src/hooks/useLoudnessProfile.js` | **Deleted** — replaced by the context file | 6 |
| `src/components/LoudnessProfileEditor.jsx` | **New.** The panel. Presentational | 8 |
| `src/components/AppSettingsOverlays.jsx` | Mounts the editor | 9 |
| `src/components/LoudnessProfilePopover.jsx` | Entry points; loses Custom and the Reference input | 9, 10 |
| `src/components/AppShell.jsx` | Footer names the profile | 12 |
| `src/App.jsx` | Provider placement, footer prop, preset-apply cancels the draft | 6, 12, 13 |
| `src/hooks/usePresets.js` | Snapshot drops `loudnessProfileCustomDraft` | 10 |

---

## Task 1: Empty rules survive normalization

A metric can be watched with nothing filled in yet. Today `normalizeRule` returns `null` for such a rule, so the row vanishes on reload.

**Files:**
- Modify: `src/lib/loudnessProfileCatalog.js` (add `isRuleEmpty`)
- Modify: `src/lib/loudnessProfileNormalize.js:40-70`
- Test: `src/lib/loudnessProfileNormalize.test.js`, `src/lib/loudnessProfileCatalog.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/loudnessProfileCatalog.test.js`:

```js
describe("isRuleEmpty", () => {
  it("calls a target rule with no target empty", () => {
    expect(isRuleEmpty({ role: "target", severity: "fail" })).toBe(true);
  });

  it("calls a target rule with a target filled", () => {
    expect(
      isRuleEmpty({ role: "target", target: -23, tolerance: { minus: 1, plus: 1 } })
    ).toBe(false);
  });

  it("calls a limit rule with neither bound empty", () => {
    expect(isRuleEmpty({ role: "limit", severity: "fail" })).toBe(true);
  });

  it("accepts either bound as filled", () => {
    expect(isRuleEmpty({ role: "limit", max: -1 })).toBe(false);
    expect(isRuleEmpty({ role: "limit", min: 0 })).toBe(false);
  });

  // descriptor and na are deliberate annotations, not half-finished rules.
  it("does not call descriptor or na empty", () => {
    expect(isRuleEmpty({ role: "descriptor" })).toBe(false);
    expect(isRuleEmpty({ role: "na" })).toBe(false);
  });

  it("calls a missing rule empty", () => {
    expect(isRuleEmpty(undefined)).toBe(true);
  });
});
```

Add `isRuleEmpty` to that file's import list from `./loudnessProfileCatalog.js`.

Append to `src/lib/loudnessProfileNormalize.test.js`:

```js
describe("empty rules", () => {
  it("keeps a target rule the user has not filled in", () => {
    const state = normalizeLoudnessProfiles({
      active: "off",
      userProfiles: [
        {
          id: "u1",
          name: "Mine",
          metrics: { integrated: { role: "target", severity: "fail" } },
          preferredMetricIds: ["integrated"],
        },
      ],
    });
    expect(state.userProfiles[0].metrics.integrated).toEqual({
      role: "target",
      severity: "fail",
    });
    // Preferring it is what keeps the row on screen; the row is the thing being filled in.
    expect(state.userProfiles[0].preferredMetricIds).toEqual(["integrated"]);
  });

  it("keeps a limit rule with neither bound", () => {
    const state = normalizeLoudnessProfiles({
      active: "off",
      userProfiles: [
        {
          id: "u1",
          name: "Mine",
          metrics: { correlation: { role: "limit", severity: "warn" } },
          preferredMetricIds: ["correlation"],
        },
      ],
    });
    expect(state.userProfiles[0].metrics.correlation).toEqual({
      role: "limit",
      severity: "warn",
    });
  });

  it("gives a target a zero band when none was stored", () => {
    const state = normalizeLoudnessProfiles({
      active: "off",
      userProfiles: [
        {
          id: "u1",
          name: "Mine",
          metrics: { integrated: { role: "target", target: -20 } },
          preferredMetricIds: ["integrated"],
        },
      ],
    });
    // A target always carries a band, so evaluateTarget never has to guess.
    // Superseded by 6facec91: the shipped behaviour leaves the band unset instead, and the
    // rule stays unfilled. See the note further down this task.
    expect(state.userProfiles[0].metrics.integrated.tolerance).toBeUndefined();
  });

  it("still rejects an unknown role", () => {
    const state = normalizeLoudnessProfiles({
      active: "off",
      userProfiles: [
        { id: "u1", name: "Mine", metrics: { integrated: { role: "nonsense" } } },
      ],
    });
    expect(state.userProfiles[0].metrics).toEqual({});
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/loudnessProfileNormalize.test.js src/lib/loudnessProfileCatalog.test.js`
Expected: FAIL — `isRuleEmpty is not a function`, and the empty-rule cases report `metrics: {}`.

- [ ] **Step 3: Add `isRuleEmpty` to the catalog**

In `src/lib/loudnessProfileCatalog.js`, after `isKnownMetricId`:

```js
/// A rule the user has added but not yet filled in. It judges nothing and demands nothing, and
/// it has to survive a round-trip: the alternative is a row that vanishes when the panel closes.
/// `descriptor` and `na` are deliberate annotations rather than half-finished rules, so they are
/// never empty.
export function isRuleEmpty(rule) {
  if (!rule) return true;
  if (rule.role === "target") return !Number.isFinite(rule.target);
  if (rule.role === "limit") return !Number.isFinite(rule.max) && !Number.isFinite(rule.min);
  return false;
}
```

- [ ] **Step 4: Let empty rules through normalization**

In `src/lib/loudnessProfileNormalize.js`, replace the two role blocks inside `normalizeRule`:

> **Superseded during execution — do not copy the block below.** Defaulting the band to
> `{minus: 0, plus: 0}` was wrong: a zero-width band meets `NEAR_BOUNDARY_MARGIN` in
> `evaluateTarget` and becomes a warning no value can escape, so typing a target before its
> tolerance lit the row permanently. It is also an invented threshold, which this feature forbids.
> `6facec91` replaced it with the shipped version — each half kept only when usable, and
> `isRuleEmpty` treating a rule missing either half as unfilled:
>
> ```js
>   if (raw.role === "target") {
>     const target = Number(raw.target);
>     if (Number.isFinite(target)) rule.target = target;
>     const tolerance = normalizeTolerance(raw.tolerance);
>     if (tolerance) rule.tolerance = tolerance;
>   }
> ```

```js
  if (raw.role === "target") {
    const target = Number(raw.target);
    // A target always carries a band so evaluation never has to guess one. Without a target
    // there is nothing to band, and the rule stays empty until the user fills it in.
    if (Number.isFinite(target)) {
      rule.target = target;
      rule.tolerance = normalizeTolerance(raw.tolerance) ?? { minus: 0, plus: 0 };
    }
  }

  if (raw.role === "limit") {
    if (Number.isFinite(Number(raw.max))) rule.max = Number(raw.max);
    if (Number.isFinite(Number(raw.min))) rule.min = Number(raw.min);
  }
```

Leave the `VALID_ROLES` guard and the `provisional` / `requiresDialogueCoverage` handling as they are.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/loudnessProfileNormalize.test.js src/lib/loudnessProfileCatalog.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/loudnessProfileCatalog.js src/lib/loudnessProfileCatalog.test.js src/lib/loudnessProfileNormalize.js src/lib/loudnessProfileNormalize.test.js
git commit -m "feat(loudness): let a half-filled profile rule survive a reload" -m "A metric can be watched before its numbers are typed. Dropping the rule made the row vanish when the panel closed, which is the one thing an editor must not do." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Empty rules judge nothing

**Files:**
- Modify: `src/lib/loudnessProfileEvaluate.js`
- Test: `src/lib/loudnessProfileEvaluate.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/loudnessProfileEvaluate.test.js`:

```js
describe("empty rules", () => {
  const withRule = (metricId, rule) => ({
    id: "u1",
    name: "Mine",
    kind: "user",
    referenceLufs: null,
    metrics: { [metricId]: rule },
    preferredMetricIds: [metricId],
  });

  it("does not judge a target rule with no target", () => {
    const statuses = loudnessProfileEvaluate(
      withRule("integrated", { role: "target", severity: "fail" }),
      { values: { integrated: -30 }, integratedReady: true, dialogueCoverage: null }
    );
    expect(statuses.integrated).toBe("unwatched");
  });

  it("does not report an empty integrated rule as pending", () => {
    // Pending is a claim about the engine, not about the profile. An unfilled rule has no
    // opinion to be pending on.
    const statuses = loudnessProfileEvaluate(
      withRule("integrated", { role: "target", severity: "fail" }),
      { values: {}, integratedReady: false, dialogueCoverage: null }
    );
    expect(statuses.integrated).toBe("unwatched");
  });

  it("does not judge a limit rule with neither bound", () => {
    const statuses = loudnessProfileEvaluate(
      withRule("correlation", { role: "limit", severity: "warn" }),
      { values: { correlation: -1 }, integratedReady: true, dialogueCoverage: null }
    );
    expect(statuses.correlation).toBe("unwatched");
  });

  it("judges as soon as one bound is filled", () => {
    const statuses = loudnessProfileEvaluate(
      withRule("correlation", { role: "limit", min: 0, severity: "fail" }),
      { values: { correlation: -1 }, integratedReady: true, dialogueCoverage: null }
    );
    expect(statuses.correlation).toBe("fail");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/loudnessProfileEvaluate.test.js`
Expected: FAIL — the first case returns `"fail"`, the second `"pending"`.

- [ ] **Step 3: Skip empty rules in evaluation**

In `src/lib/loudnessProfileEvaluate.js`, import the helper and add the guard as the first thing `evaluateMetric` does after the descriptor check:

```js
import { isRuleEmpty } from "./loudnessProfileCatalog.js";
```

```js
function evaluateMetric(metricId, rule, sample) {
  if (rule.role === "descriptor") return "unwatched";

  // Before anything else, including the readiness checks: a rule the user has not filled in has
  // no opinion, so it cannot be pending or inconclusive either.
  if (isRuleEmpty(rule)) return "unwatched";

  // Integrated-family readouts are meaningless until the engine says they are ready.
  if (metricId === "integrated" && !sample.integratedReady) return "pending";
  ...
```

Leave the rest of the function unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/loudnessProfileEvaluate.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/loudnessProfileEvaluate.js src/lib/loudnessProfileEvaluate.test.js
git commit -m "feat(loudness): stay silent on a rule with no numbers yet" -m "An unfilled rule has no opinion, so it cannot be failing, pending or inconclusive. The guard sits ahead of the readiness checks for that reason." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Empty rules demand nothing

**Files:**
- Modify: `src/lib/loudnessProfileMissing.js`
- Test: `src/lib/loudnessProfileMissing.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/loudnessProfileMissing.test.js`:

```js
describe("empty rules are not required", () => {
  it("does not demand a Stats row for a rule with no numbers", () => {
    const document = {
      id: "u1",
      name: "Mine",
      kind: "user",
      referenceLufs: null,
      metrics: {
        integrated: { role: "target", target: -23, tolerance: { minus: 1, plus: 1 } },
        correlation: { role: "limit", severity: "warn" },
      },
      preferredMetricIds: ["integrated", "correlation"],
    };

    // Show missing must not push a row on screen for a metric the profile is not yet judging.
    expect(listMissingPreferredMetrics(document, [])).toEqual(["integrated"]);
  });

  it("demands it once a bound is filled", () => {
    const document = {
      id: "u1",
      name: "Mine",
      kind: "user",
      referenceLufs: null,
      metrics: { correlation: { role: "limit", min: 0, severity: "warn" } },
      preferredMetricIds: ["correlation"],
    };
    expect(listMissingPreferredMetrics(document, [])).toEqual(["correlation"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/loudnessProfileMissing.test.js`
Expected: FAIL — first case returns `["integrated", "correlation"]`.

- [ ] **Step 3: Filter empty rules out of the missing list**

Replace `listMissingPreferredMetrics` in `src/lib/loudnessProfileMissing.js`:

```js
import { isRuleEmpty } from "./loudnessProfileCatalog.js";

/// Preferred metrics the profile watches that are not visible in Stats, in the profile's own
/// order. Metrics the profile only describes (n/a, descriptors) are not required, and neither
/// are rules the user has added but not yet filled in -- fulfilling those would push rows on
/// screen for a metric nothing is judging yet.
export function listMissingPreferredMetrics(document, statsVisibleIds) {
  if (!document) return [];
  const visible = new Set(statsVisibleIds ?? []);
  return (document.preferredMetricIds ?? [])
    .filter((id) => !isRuleEmpty(document.metrics?.[id]))
    .filter((id) => !visible.has(id));
}
```

Leave `planShowMissing` unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/loudnessProfileMissing.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/loudnessProfileMissing.js src/lib/loudnessProfileMissing.test.js
git commit -m "feat(loudness): do not demand a row for a rule with no numbers" -m "Third and last of the empty-rule guards: it survives normalization, judges nothing, and now asks for nothing. An empty rule is inert everywhere." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: The metric→shape table

The editor must never ask the user to pick a `role`. Each metric declares the shape it can wear.

**Files:**
- Modify: `src/lib/loudnessProfileCatalog.js`
- Test: `src/lib/loudnessProfileCatalog.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/loudnessProfileCatalog.test.js`:

```js
describe("METRIC_RULE_ROLE", () => {
  it("shapes every metric Stats can show", () => {
    // A metric the editor can add but cannot shape would be unreachable.
    for (const id of STATS_CANONICAL_ORDER) {
      expect(["target", "limit"], id).toContain(METRIC_RULE_ROLE[id]);
    }
  });

  it("shapes nothing Stats cannot show", () => {
    for (const id of Object.keys(METRIC_RULE_ROLE)) {
      expect(STATS_CANONICAL_ORDER, id).toContain(id);
    }
  });

  it("builds an empty rule in the metric's own shape", () => {
    expect(createEmptyRule("truePeak")).toEqual({ role: "limit", severity: "fail" });
    expect(createEmptyRule("integrated")).toEqual({ role: "target", severity: "fail" });
  });

  it("builds nothing for an unknown metric", () => {
    expect(createEmptyRule("nonsense")).toBe(null);
  });

  it("builds rules that read as empty", () => {
    for (const id of STATS_CANONICAL_ORDER) {
      expect(isRuleEmpty(createEmptyRule(id)), id).toBe(true);
    }
  });
});
```

Add `METRIC_RULE_ROLE` and `createEmptyRule` to the file's catalog import list, and `STATS_CANONICAL_ORDER` from `./statsCatalog.js`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/loudnessProfileCatalog.test.js`
Expected: FAIL — `METRIC_RULE_ROLE is not defined`.

- [ ] **Step 3: Add the table and the factory**

In `src/lib/loudnessProfileCatalog.js`, after `BUILTIN_LOUDNESS_PROFILES`:

```js
/// The rule shape each Stats metric can wear.
///
/// `role` is an implementation concept -- nobody thinks "I want a limit rule on True Peak", they
/// think "TP must not exceed -1" -- so the editor reads a metric's shape from here instead of
/// asking the user to choose one. `limit` carries both `min` and `max`, which makes ceiling,
/// floor and band the same shape with different fields left blank.
///
/// A flat metric-to-role map: a per-entry object earned nothing once `reading` had no reader.
///
/// Deliberately no default numbers. Inventing a threshold for Side/Mid or PSR would be exactly
/// the fabricated-standard behaviour this feature exists to avoid.
export const METRIC_RULE_ROLE = {
  momentary: "target",
  shortTerm: "target",
  integrated: "target",
  dialogueIntegrated: "target",
  momentaryMax: "limit",
  shortTermMax: "limit",
  truePeak: "limit",
  dialogueCoverage: "limit",
  correlation: "limit",
  psr: "limit",
  plr: "limit",
  lra: "limit",
  dialogueRange: "limit",
  dialogueOffset: "limit",
  sideToMid: "limit",
};

/// A rule in the metric's own shape with nothing filled in. Severity defaults to `fail`; the
/// editor exposes it, and a user who wants a softer breach says so.
export function createEmptyRule(metricId) {
  const role = METRIC_RULE_ROLE[metricId];
  if (!role) return null;
  return { role, severity: "fail" };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/loudnessProfileCatalog.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/loudnessProfileCatalog.js src/lib/loudnessProfileCatalog.test.js
git commit -m "feat(loudness): let each metric declare the rule shape it wears" -m "The editor reads a metric's shape from the catalog rather than asking the user to pick a role, so the UI can keep speaking in ceilings and targets. No default numbers: an invented threshold is the thing this feature avoids." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Duplicating a built-in drops its descriptor and n/a rules

**Files:**
- Modify: `src/lib/loudnessProfileCatalog.js` (`duplicateAsDraft`)
- Test: `src/lib/loudnessProfileCatalog.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/loudnessProfileCatalog.test.js`:

```js
describe("duplicateAsDraft drops annotations", () => {
  it("drops descriptor rules the editor cannot show", () => {
    const copy = duplicateAsDraft("ebu-r128", () => "copy");
    expect(copy.metrics.integrated).toBeTruthy();
    expect(copy.metrics.truePeak).toBeTruthy();
    // lra and shortTermMax are descriptors on this built-in: authoring notes saying "we do not
    // judge this", which a user profile says by not mentioning the metric at all.
    expect(copy.metrics.lra).toBeUndefined();
    expect(copy.metrics.shortTermMax).toBeUndefined();
  });

  it("drops na rules", () => {
    const copy = duplicateAsDraft("ebu-r128-s1", () => "copy");
    expect(copy.metrics.lra).toBeUndefined();
    expect(copy.metrics.shortTermMax).toBeTruthy();
  });

  it("keeps preferred ids in step with the rules that survived", () => {
    const copy = duplicateAsDraft("atsc-a85", () => "copy");
    // dialogueCoverage is preferred on ATSC but only a descriptor, so it goes with the rule.
    expect(copy.preferredMetricIds).toEqual(["dialogueIntegrated", "truePeak"]);
  });

  it("still records what it was copied from", () => {
    const copy = duplicateAsDraft("ebu-r128", () => "copy");
    expect(copy.basedOn).toBe("ebu-r128");
    expect(copy.kind).toBe("draft");
    expect(copy.name).toBe("EBU R128 (copy)");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/loudnessProfileCatalog.test.js`
Expected: FAIL — `copy.metrics.lra` is the descriptor object.

- [ ] **Step 3: Filter the annotations out**

Replace `duplicateAsDraft` in `src/lib/loudnessProfileCatalog.js`:

```js
/// Duplicating a built-in yields an unsaved draft, never a library entry: the design routes all
/// edits of a built-in through Duplicate -> Save.
///
/// `descriptor` and `na` rules do not come along. They are authoring annotations meaning "we
/// deliberately do not judge this", which a user profile already says by not mentioning the
/// metric -- and the editor has no way to show or remove a rule in either role, so carrying them
/// would leave rules the user cannot reach. Behaviourally lossless: `loudnessStatusValueClass`
/// maps `na` and an absent status to the same class.
export function duplicateAsDraft(builtinId, makeId = defaultMakeId) {
  const source = BUILTIN_BY_ID.get(builtinId);
  if (!source) return null;
  const clone = structuredClone(source);
  const metrics = Object.fromEntries(
    Object.entries(clone.metrics).filter(
      ([, rule]) => rule.role !== "descriptor" && rule.role !== "na"
    )
  );
  return {
    ...clone,
    metrics,
    preferredMetricIds: clone.preferredMetricIds.filter((id) => Object.hasOwn(metrics, id)),
    id: makeId(),
    name: `${source.name} (copy)`,
    kind: "draft",
    basedOn: source.id,
  };
}
```

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run src/lib src/hooks src/components`
Expected: PASS. The existing `withReferenceLufs` test that duplicates `atsc-a85` asserts `moved.metrics.integrated.target` is `undefined` — ATSC's `integrated` was a descriptor, so it is now absent entirely and `undefined` still holds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/loudnessProfileCatalog.js src/lib/loudnessProfileCatalog.test.js
git commit -m "feat(loudness): leave a built-in's annotations behind when duplicating it" -m "descriptor and na say \"we deliberately do not judge this\", which a user profile says by not mentioning the metric. Carried into a copy they would be rules the editor cannot show and the user cannot remove." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: One provider instead of four hook instances

`useLoudnessProfile()` is instantiated independently by `StatsPanel`, `DockStats`, `LevelMeterPanel` and `PanelSettingsContent`. A draft held in any one of them is invisible to the other three, so the preview overlay needs a single owner first.

This task moves the state and changes nothing else. The hook's call signature and return shape stay identical; only the import path moves.

**Files:**
- Create: `src/hooks/LoudnessProfileContext.jsx`
- Create: `src/hooks/LoudnessProfileContext.test.jsx` (move the existing tests)
- Delete: `src/hooks/useLoudnessProfile.js`, `src/hooks/useLoudnessProfile.test.jsx`
- Modify: `src/App.jsx` (provider placement), and the import line in `src/components/panels/StatsPanel.jsx`, `src/components/panels/LevelMeterPanel.jsx`, `src/components/PanelSettingsContent.jsx`, `src/dock/modules/DockStats.jsx`

- [ ] **Step 1: Create the context file**

Create `src/hooks/LoudnessProfileContext.jsx` with the whole body of the current `useLoudnessProfile.js`, wrapped in a provider:

```jsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { presetsStore, settingsStore } from "../persistence/index.js";
import {
  LOUDNESS_PROFILE_CUSTOM,
  LOUDNESS_PROFILE_OFF,
  createDefaultCustomDraft,
  duplicateAsDraft,
  parseSelection,
  resolveActiveDocument,
  userSelectionId,
} from "../lib/loudnessProfileCatalog.js";
import { normalizeLoudnessProfiles } from "../lib/loudnessProfileNormalize.js";

/// Session state for the active Loudness Profile plus the user library.
///
/// One instance, not one per consumer: Stats, Dock Stats, the Level Meter and the panel settings
/// all read the same document, and the preview draft added later has to be visible to every one
/// of them at once.

const LoudnessProfileContext = createContext(null);

function readState() {
  return normalizeLoudnessProfiles(settingsStore.read().loudnessProfiles);
}

function writeState(next) {
  settingsStore.patch({ loudnessProfiles: next });
}

export function LoudnessProfileProvider({ children }) {
  const [state, setState] = useState(readState);

  useEffect(() => settingsStore.subscribe(() => setState(readState())), []);

  /// The active profile is part of the layout preset snapshot, so editing it diverges from the
  /// preset exactly the way a workspace or dock edit does, and has to say so.
  ///
  /// `presetDirty: false` is for the one write that is not a divergence: restoring a snapshot.
  const commit = useCallback((updater, { presetDirty = true } = {}) => {
    setState((prev) => {
      const next = normalizeLoudnessProfiles(updater(prev));
      writeState(next);
      if (presetDirty) presetsStore.patch({ dirty: true });
      return next;
    });
  }, []);

  const document = useMemo(() => resolveActiveDocument(state), [state]);

  const select = useCallback(
    (selection) => commit((prev) => ({ ...prev, active: selection })),
    [commit]
  );

  const selectOff = useCallback(() => select(LOUDNESS_PROFILE_OFF), [select]);

  const selectUnsavedCustom = useCallback(
    () =>
      commit((prev) => ({
        ...prev,
        active: LOUDNESS_PROFILE_CUSTOM,
        customDraft: prev.customDraft ?? createDefaultCustomDraft(),
      })),
    [commit]
  );

  const duplicateBuiltin = useCallback(
    (builtinId) =>
      commit((prev) => {
        const draft = duplicateAsDraft(builtinId);
        if (!draft) return prev;
        return { ...prev, active: LOUDNESS_PROFILE_CUSTOM, customDraft: draft };
      }),
    [commit]
  );

  const updateCustomDraft = useCallback(
    (patch) =>
      commit((prev) => {
        const base = prev.customDraft ?? createDefaultCustomDraft();
        return { ...prev, customDraft: { ...base, ...patch } };
      }),
    [commit]
  );

  const saveCustomAs = useCallback(
    (name) =>
      commit((prev) => {
        if (!prev.customDraft) return prev;
        const id = crypto.randomUUID();
        const saved = { ...prev.customDraft, id, name, kind: "user" };
        return {
          ...prev,
          active: userSelectionId(id),
          userProfiles: [...prev.userProfiles, saved],
          customDraft: prev.customDraft,
        };
      }),
    [commit]
  );

  const updateUser = useCallback(
    (id, patch) =>
      commit((prev) => ({
        ...prev,
        userProfiles: prev.userProfiles.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      })),
    [commit]
  );

  const renameUser = useCallback((id, name) => updateUser(id, { name }), [updateUser]);

  const removeUser = useCallback(
    (id) =>
      commit((prev) => {
        const userProfiles = prev.userProfiles.filter((p) => p.id !== id);
        const active = prev.active === userSelectionId(id) ? LOUDNESS_PROFILE_OFF : prev.active;
        return { ...prev, userProfiles, active };
      }),
    [commit]
  );

  const snapshotForPreset = useCallback(
    () => ({
      loudnessProfileActive: state.active,
      loudnessProfileCustomDraft: state.customDraft,
    }),
    [state]
  );

  const applyPresetSnapshot = useCallback(
    (snapshot) =>
      commit(
        (prev) => {
          if (!snapshot) return prev;
          const { kind } = parseSelection(snapshot.loudnessProfileActive);
          return {
            ...prev,
            active: snapshot.loudnessProfileActive,
            customDraft:
              kind === "draft" ? snapshot.loudnessProfileCustomDraft : prev.customDraft,
          };
        },
        { presetDirty: false }
      ),
    [commit]
  );

  const value = useMemo(
    () => ({
      active: state.active,
      document,
      userProfiles: state.userProfiles,
      customDraft: state.customDraft,
      referenceLufs: document?.referenceLufs ?? null,
      select,
      selectOff,
      selectUnsavedCustom,
      duplicateBuiltin,
      updateCustomDraft,
      saveCustomAs,
      updateUser,
      renameUser,
      removeUser,
      snapshotForPreset,
      applyPresetSnapshot,
    }),
    [
      state,
      document,
      select,
      selectOff,
      selectUnsavedCustom,
      duplicateBuiltin,
      updateCustomDraft,
      saveCustomAs,
      updateUser,
      renameUser,
      removeUser,
      snapshotForPreset,
      applyPresetSnapshot,
    ]
  );

  return (
    <LoudnessProfileContext.Provider value={value}>{children}</LoudnessProfileContext.Provider>
  );
}

export function useLoudnessProfile() {
  const value = useContext(LoudnessProfileContext);
  if (!value) throw new Error("useLoudnessProfile must be used inside LoudnessProfileProvider");
  return value;
}
```

- [ ] **Step 2: Move the tests and give them a provider**

```bash
git mv src/hooks/useLoudnessProfile.test.jsx src/hooks/LoudnessProfileContext.test.jsx
```

In the moved file, change the import to `./LoudnessProfileContext.jsx` and wrap every `renderHook` in the provider by adding a wrapper option. Replace each bare `renderHook(() => useLoudnessProfile())` with `renderHook(() => useLoudnessProfile(), { wrapper })`, where at the top of the file:

```jsx
import { LoudnessProfileProvider, useLoudnessProfile } from "./LoudnessProfileContext.jsx";

const wrapper = ({ children }) => <LoudnessProfileProvider>{children}</LoudnessProfileProvider>;
```

Add one test that is the whole point of the task:

```jsx
describe("single instance", () => {
  it("shows one consumer's selection to another", () => {
    // Two consumers under one provider must agree; four independent hook instances could not
    // share a draft, which is what the preview overlay needs.
    const both = renderHook(
      () => ({ a: useLoudnessProfile(), b: useLoudnessProfile() }),
      { wrapper }
    );
    act(() => both.result.current.a.select(builtinSelectionId("ebu-r128")));
    expect(both.result.current.b.referenceLufs).toBe(-23);
  });
});
```

- [ ] **Step 3: Run the moved tests to verify they pass**

Run: `npx vitest run src/hooks/LoudnessProfileContext.test.jsx`
Expected: PASS.

- [ ] **Step 4: Delete the old hook and repoint its consumers**

```bash
git rm src/hooks/useLoudnessProfile.js
```

Change the import line in each of these four files from `useLoudnessProfile.js` to `LoudnessProfileContext.jsx`, keeping the relative depth each file already uses:

- `src/components/panels/StatsPanel.jsx`: `import { useLoudnessProfile } from "../../hooks/LoudnessProfileContext.jsx";`
- `src/components/panels/LevelMeterPanel.jsx`: same path
- `src/dock/modules/DockStats.jsx`: `import { useLoudnessProfile } from "../../hooks/LoudnessProfileContext.jsx";`
- `src/components/PanelSettingsContent.jsx`: `import { useLoudnessProfile } from "@/hooks/LoudnessProfileContext.jsx";`

In `src/App.jsx`, import the provider and place it inside `MeterRuntimeProvider`:

```jsx
import { LoudnessProfileProvider, useLoudnessProfile } from "./hooks/LoudnessProfileContext.jsx";
```

```jsx
export default function App() {
  return (
    <WorkspaceProvider>
      <MeterRuntimeProvider>
        {/* Inside MeterRuntime and outside AppContent: dockLayout is a hook in AppContent and
            DockStats is rendered by it, so one provider covers both windows' worth of Stats. */}
        <LoudnessProfileProvider>
          <AppContent />
        </LoudnessProfileProvider>
      </MeterRuntimeProvider>
    </WorkspaceProvider>
  );
}
```

- [ ] **Step 5: Give the component tests a provider**

Any test that renders `StatsPanel`, `DockStats`, `LevelMeterPanel`, `PanelSettingsContent` or the popover now needs the provider in its tree, or the hook throws. In each file below, add:

```jsx
import { LoudnessProfileProvider } from "@/hooks/LoudnessProfileContext.jsx";
```

and wrap the existing render subject:

```jsx
render(
  <LoudnessProfileProvider>
    {/* whatever the test already rendered */}
  </LoudnessProfileProvider>
);
```

Files: `src/components/panels/StatsPanel.test.jsx`, `src/components/panels/LevelMeterPanel.test.jsx`, `src/components/PanelSettingsContent.test.jsx`, `src/dock/modules/DockStats.test.jsx`, `src/components/LoudnessProfilePopover.test.jsx`.

`src/App.smoke.test.jsx` renders `<App />`, which now contains the provider itself — leave it alone.

For `LoudnessProfilePopover.test.jsx` specifically, `renderPopover` currently drives the hook through a bare `renderHook`; give both the hook and the render the same provider instance by rendering them inside one wrapper element, otherwise the popover and the hook under test are two separate trees and clicks will not be reflected.

The throw is deliberate — a component rendered outside the provider is a real bug, and a silent fallback would hide the dock/main split the spec warns about.

- [ ] **Step 6: Prove the dock and the main window cannot disagree**

This is the split-brain the parent spec warns about: `DockStats` is a second implementation with its own visible ids, and one provider is what keeps the two honest. Add to `src/dock/modules/DockStats.test.jsx`:

```jsx
it("colours a metric the same as the main window under one profile", () => {
  // Rendered together under one provider: the same metric under the same profile must not read
  // as a breach in one surface and neutral in the other.
  settingsStore.patch({
    loudnessProfiles: { active: builtinSelectionId("ebu-r128"), userProfiles: [] },
  });

  const { container } = render(
    <LoudnessProfileProvider>
      <MetricsFixture>
        <StatsPanel />
        <DockStats controls={{ statsVisibleIds: ["truePeak"], statsOrder: ["truePeak"] }} />
      </MetricsFixture>
    </LoudnessProfileProvider>
  );

  const classes = [...container.querySelectorAll("[data-stat-value]")].map((n) => n.className);
  expect(classes.length).toBe(2);
  expect(classes[0]).toContain("ui-signal-bad");
  expect(classes[1]).toContain("ui-signal-bad");
});
```

`MetricsFixture` is whatever provider pair this file already uses to feed `useMetricsData` and `useFrameData`; reuse it and feed a `tpMax` above `-1`. If the value spans are not addressable, add `data-stat-value` to the value `<span>` in both `StatsPanel.jsx` and `DockStats.jsx` — a test hook on the one thing that must agree is worth the attribute.

- [ ] **Step 7: Run the full gate**

Run: `npm run check`
Expected: EXIT 0.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(loudness): own the profile in one provider, not four hook copies" -m "Stats, Dock Stats, the Level Meter and the panel settings each held their own state and subscription, so a draft in any of them was invisible to the rest. The preview overlay needs one owner." -m "The hook keeps its name and its return shape; only where the state lives changes." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: The preview overlay

**Files:**
- Modify: `src/hooks/LoudnessProfileContext.jsx`
- Test: `src/hooks/LoudnessProfileContext.test.jsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/hooks/LoudnessProfileContext.test.jsx`:

```jsx
describe("preview draft", () => {
  it("outranks the persisted selection for every reader", () => {
    const both = renderHook(
      () => ({ a: useLoudnessProfile(), b: useLoudnessProfile() }),
      { wrapper }
    );
    act(() => both.result.current.a.select(builtinSelectionId("ebu-r128")));
    act(() => both.result.current.a.beginCreate());
    act(() => both.result.current.a.editDraft((d) => ({ ...d, referenceLufs: -16 })));

    expect(both.result.current.b.referenceLufs).toBe(-16);
  });

  it("never reaches the settings store", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, name: "Scratch" })));

    expect(settingsStore.read().loudnessProfiles?.userProfiles ?? []).toEqual([]);
  });

  it("cannot dirty a preset, because nothing is written", () => {
    presetsStore.reset();
    presetsStore.patch({ activeId: "p1", dirty: false });
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, referenceLufs: -16 })));

    expect(presetsStore.read().dirty).toBe(false);
  });

  it("cancel throws the draft away and restores what was showing", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.select(builtinSelectionId("ebu-r128")));
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, referenceLufs: -16 })));
    act(() => result.current.cancelDraft());

    expect(result.current.draft).toBe(null);
    expect(result.current.referenceLufs).toBe(-23);
    expect(result.current.userProfiles).toEqual([]);
  });

  it("saving a new draft inserts it and selects it", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, name: "My Show", referenceLufs: -20 })));
    act(() => result.current.saveDraft());

    expect(result.current.userProfiles.map((p) => p.name)).toEqual(["My Show"]);
    expect(result.current.document.name).toBe("My Show");
    expect(result.current.referenceLufs).toBe(-20);
    expect(result.current.draft).toBe(null);
  });

  it("saving an edited profile replaces it rather than adding a second", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, name: "Before" })));
    act(() => result.current.saveDraft());
    const { id } = result.current.userProfiles[0];

    act(() => result.current.beginEdit(id));
    act(() => result.current.editDraft((d) => ({ ...d, name: "After" })));
    act(() => result.current.saveDraft());

    expect(result.current.userProfiles.map((p) => p.name)).toEqual(["After"]);
  });

  it("tracks whether the draft has been touched", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    expect(result.current.draft.dirty).toBe(false);
    act(() => result.current.editDraft((d) => ({ ...d, referenceLufs: -16 })));
    expect(result.current.draft.dirty).toBe(true);
  });

  it("opens a duplicate of a built-in as an unsaved draft", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginDuplicate("ebu-r128-s1"));

    expect(result.current.draft.document.basedOn).toBe("ebu-r128-s1");
    expect(result.current.draft.editingId).toBe(null);
    expect(result.current.userProfiles).toEqual([]);
  });
});
```

Import `presetsStore` alongside `settingsStore` in that test file if it is not already imported.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/hooks/LoudnessProfileContext.test.jsx`
Expected: FAIL — `beginCreate is not a function`.

- [ ] **Step 3: Add the overlay to the provider**

In `src/hooks/LoudnessProfileContext.jsx`, add the draft state and its API. Import `createEmptyRule` is not needed here; `createDefaultCustomDraft` is the starter for now and gets renamed in Task 10.

```jsx
  /// The preview overlay: a draft that outranks the persisted selection for every reader without
  /// ever reaching disk.
  ///
  /// `{ editingId: string | null, document: RuleDocument, dirty: boolean }`; `editingId` is null
  /// for a profile that is not in the library yet.
  ///
  /// ThemeEditor previews by mutating the real selection and eagerly upserting new themes, so it
  /// needs `wasNewRef` / `prevRef` to unwind on cancel. An overlay has no side effects to unwind:
  /// cancel is throwing an object away.
  const [draft, setDraft] = useState(null);

  const beginCreate = useCallback(() => {
    setDraft({ editingId: null, document: createDefaultCustomDraft(), dirty: false });
  }, []);

  const beginDuplicate = useCallback((builtinId) => {
    const document = duplicateAsDraft(builtinId);
    if (!document) return;
    setDraft({ editingId: null, document, dirty: false });
  }, []);

  const beginEdit = useCallback(
    (id) => {
      const found = state.userProfiles.find((p) => p.id === id);
      if (!found) return;
      setDraft({ editingId: id, document: structuredClone(found), dirty: false });
    },
    [state.userProfiles]
  );

  const editDraft = useCallback((mutate) => {
    setDraft((prev) =>
      prev ? { ...prev, document: mutate(prev.document), dirty: true } : prev
    );
  }, []);

  const cancelDraft = useCallback(() => setDraft(null), []);

  const saveDraft = useCallback(() => {
    setDraft((prev) => {
      if (!prev) return prev;
      const id = prev.editingId ?? crypto.randomUUID();
      const saved = { ...prev.document, id, kind: "user" };
      commit((state) => ({
        ...state,
        active: userSelectionId(id),
        userProfiles: prev.editingId
          ? state.userProfiles.map((p) => (p.id === id ? saved : p))
          : [...state.userProfiles, saved],
      }));
      return null;
    });
  }, [commit]);
```

Change the resolved document so the draft wins:

```jsx
  // The draft outranks the selection: while one exists, Stats colours, the reference line, the
  // footer and the TP Max marker all follow what the user is typing.
  const document = useMemo(
    () => draft?.document ?? resolveActiveDocument(state),
    [draft, state]
  );
```

Add `draft`, `beginCreate`, `beginDuplicate`, `beginEdit`, `editDraft`, `cancelDraft`, `saveDraft` to the context `value` object and to its dependency array.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/hooks/LoudnessProfileContext.test.jsx`
Expected: PASS.

- [ ] **Step 5: Run the full gate**

Run: `npm run check`
Expected: EXIT 0.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(loudness): preview a profile draft without writing it anywhere" -m "The draft outranks the persisted selection for every reader, so Stats colours and the reference line follow what is being typed against real audio. Whether a threshold is sane is a question the meter answers, not a form." -m "Nothing reaches settingsStore until Save, so previewing cannot dirty a layout preset and cancel is throwing an object away." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: The editor panel

Presentational: it takes a draft and callbacks and owns no profile state.

A blank band field leaves the band unset, so the rule stays inert rather than acquiring a zero-width band the user never chose — `isUsableTolerance` rejects it either way, and the two layers agreeing is deliberate.

**Files:**
- Create: `src/components/LoudnessProfileEditor.jsx`
- Test: `src/components/LoudnessProfileEditor.test.jsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/LoudnessProfileEditor.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LoudnessProfileEditor } from "./LoudnessProfileEditor.jsx";
import { createDefaultCustomDraft } from "@/lib/loudnessProfileCatalog.js";

function renderEditor(overrides = {}) {
  const props = {
    draft: { editingId: null, document: createDefaultCustomDraft(), dirty: false },
    onEdit: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    pos: { x: 10, y: 10 },
    onMove: vi.fn(),
    ...overrides,
  };
  render(<LoudnessProfileEditor {...props} />);
  return props;
}

describe("LoudnessProfileEditor", () => {
  it("lists a row per rule, in the profile's own order", () => {
    renderEditor();
    expect(screen.getByText("Integrated")).toBeTruthy();
    expect(screen.getByText("True Peak Max")).toBeTruthy();
  });

  it("renders a target rule as target and band", () => {
    renderEditor();
    expect(screen.getByLabelText("Integrated target").value).toBe("-23");
    expect(screen.getByLabelText("Integrated tolerance minus").value).toBe("0.5");
    expect(screen.getByLabelText("Integrated tolerance plus").value).toBe("0.5");
  });

  it("renders a limit rule as two bounds, either blank", () => {
    renderEditor();
    expect(screen.getByLabelText("True Peak Max maximum").value).toBe("-1");
    expect(screen.getByLabelText("True Peak Max minimum").value).toBe("");
  });

  it("commits a number on blur, not per keystroke", () => {
    const props = renderEditor();
    const input = screen.getByLabelText("Integrated target");
    fireEvent.change(input, { target: { value: "-2" } });
    expect(props.onEdit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(props.onEdit).toHaveBeenCalledTimes(1);
  });

  it("offers only metrics not already in the profile", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add metric" }));
    expect(screen.getByRole("button", { name: "Add Correlation" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add Integrated" })).toBeNull();
  });

  it("removes a rule", () => {
    const props = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Remove True Peak Max" }));
    expect(props.onEdit).toHaveBeenCalledTimes(1);
  });

  it("exposes severity per rule", () => {
    renderEditor();
    expect(screen.getByLabelText("Integrated severity").value).toBe("fail");
  });

  it("refuses to save an unnamed profile", () => {
    renderEditor({
      draft: {
        editingId: null,
        document: { ...createDefaultCustomDraft(), name: "  " },
        dirty: true,
      },
    });
    expect(screen.getByRole("button", { name: "Save" }).disabled).toBe(true);
  });

  it("cancels straight away when nothing was touched", () => {
    const props = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("asks before discarding touched edits", () => {
    const props = renderEditor({
      draft: { editingId: null, document: createDefaultCustomDraft(), dirty: true },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard Changes" }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("carries the honesty note", () => {
    renderEditor();
    expect(screen.getByText(/not a certification/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/LoudnessProfileEditor.test.jsx`
Expected: FAIL — cannot resolve `./LoudnessProfileEditor.jsx`.

- [ ] **Step 3: Write the panel**

Create `src/components/LoudnessProfileEditor.jsx`:

```jsx
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clampPanelPos } from "@/lib/dragClamp.js";
import {
  METRIC_RULE_ROLE,
  createEmptyRule,
  withReferenceLufs,
} from "@/lib/loudnessProfileCatalog.js";
import { STATS_CANONICAL_ORDER, STATS_META } from "@/lib/statsCatalog.js";

const NUM_INPUT_CLASS =
  "h-6 w-14 rounded-md border border-transparent bg-transparent px-1 py-0 text-center font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-fs-control)] tabular-nums transition-colors hover:border-border hover:bg-secondary/85 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * One numeric field, committed on blur or Enter.
 *
 * Never per keystroke: clearing the box to retype lands an empty string, and typing `-14` passes
 * through `-1` on the way. Both would write a rule the user never asked for. Blank is a real
 * value here -- it means "not judged" -- so an empty commit clears the field rather than snapping
 * back.
 */
function RuleNumber({ ariaLabel, value, onCommit }) {
  const [text, setText] = useState(value == null ? "" : String(value));

  useEffect(() => {
    setText(value == null ? "" : String(value));
  }, [value]);

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === "") {
      onCommit(null);
      return;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) onCommit(parsed);
    else setText(value == null ? "" : String(value));
  };

  return (
    <input
      type="number"
      aria-label={ariaLabel}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className={NUM_INPUT_CLASS}
    />
  );
}

/// One rule. The shape comes from the metric, never from the user: nobody thinks "I want a limit
/// rule on True Peak", they think "TP must not exceed -1".
function RuleRow({ metricId, rule, onPatch, onRemove }) {
  const meta = STATS_META[metricId];
  const label = meta?.label ?? metricId;

  return (
    <div className="flex items-center gap-1.5 py-0.5 text-[length:var(--ui-fs-control)]">
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{label}</span>

      {rule.role === "target" ? (
        <>
          <RuleNumber
            ariaLabel={`${label} target`}
            value={rule.target ?? null}
            onCommit={(next) => onPatch({ target: next ?? undefined })}
          />
          <span className="text-muted-foreground">−</span>
          <RuleNumber
            ariaLabel={`${label} tolerance minus`}
            value={rule.tolerance?.minus ?? null}
            onCommit={(next) =>
              onPatch({ tolerance: { ...rule.tolerance, minus: next ?? undefined } })
            }
          />
          <span className="text-muted-foreground">+</span>
          <RuleNumber
            ariaLabel={`${label} tolerance plus`}
            value={rule.tolerance?.plus ?? null}
            onCommit={(next) =>
              onPatch({ tolerance: { ...rule.tolerance, plus: next ?? undefined } })
            }
          />
        </>
      ) : (
        <>
          <span className="text-muted-foreground">≥</span>
          <RuleNumber
            ariaLabel={`${label} minimum`}
            value={rule.min ?? null}
            onCommit={(next) => onPatch({ min: next ?? undefined })}
          />
          <span className="text-muted-foreground">≤</span>
          <RuleNumber
            ariaLabel={`${label} maximum`}
            value={rule.max ?? null}
            onCommit={(next) => onPatch({ max: next ?? undefined })}
          />
        </>
      )}

      <span className="w-8 shrink-0 text-right text-muted-foreground/60">{meta?.unit}</span>

      <select
        aria-label={`${label} severity`}
        value={rule.severity ?? "fail"}
        onChange={(event) => onPatch({ severity: event.target.value })}
        className="h-6 rounded-md border border-input bg-transparent px-1 text-[length:var(--ui-fs-control)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="fail">Fail</option>
        <option value="warn">Warn</option>
      </select>

      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <X className="size-[length:var(--ui-icon-management-action)]" />
      </button>
    </div>
  );
}

/**
 * Floating editor for one Loudness Profile draft.
 *
 * Presentational: it owns the drag position handling and the discard prompt, and nothing else.
 * Every change goes out through `onEdit`, which the provider applies to the preview draft, so the
 * meter repaints as the user types.
 */
export function LoudnessProfileEditor({ draft, onEdit, onSave, onCancel, pos, onMove }) {
  const [discardOpen, setDiscardOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const ref = useRef(null);
  const dragRef = useRef(null);

  const { document } = draft;
  const ruleIds = document.preferredMetricIds ?? [];
  const addable = STATS_CANONICAL_ORDER.filter(
    (id) => METRIC_RULE_ROLE[id] && !ruleIds.includes(id)
  );

  function patchRule(metricId, patch) {
    onEdit((d) => ({
      ...d,
      metrics: { ...d.metrics, [metricId]: { ...d.metrics[metricId], ...patch } },
    }));
  }

  function addMetric(metricId) {
    setAddOpen(false);
    onEdit((d) => ({
      ...d,
      metrics: { ...d.metrics, [metricId]: createEmptyRule(metricId) },
      preferredMetricIds: [...(d.preferredMetricIds ?? []), metricId],
    }));
  }

  function removeMetric(metricId) {
    onEdit((d) => {
      const metrics = { ...d.metrics };
      delete metrics[metricId];
      return {
        ...d,
        metrics,
        preferredMetricIds: (d.preferredMetricIds ?? []).filter((id) => id !== metricId),
      };
    });
  }

  function handleCancel() {
    if (draft.dirty) setDiscardOpen(true);
    else onCancel();
  }

  function onPointerDown(e) {
    const rect = ref.current.getBoundingClientRect();
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, w: rect.width, h: rect.height };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    onMove(
      clampPanelPos(
        { x: e.clientX - d.dx, y: e.clientY - d.dy },
        { w: d.w, h: d.h },
        { w: window.innerWidth, h: window.innerHeight }
      )
    );
  }
  function onPointerUp() {
    dragRef.current = null;
  }

  return (
    <>
      <div
        ref={ref}
        role="dialog"
        aria-label="Loudness Profile editor"
        className="fixed z-50 flex max-h-[80vh] w-[26rem] flex-col gap-2 overflow-hidden rounded-[var(--ui-radius-modal)] border border-border bg-card text-card-foreground shadow-lg"
        style={{ left: pos.x, top: pos.y }}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="flex cursor-move items-center border-b border-border px-3 py-2"
        >
          <input
            aria-label="Loudness Profile name"
            value={document.name ?? ""}
            onChange={(event) => {
              const { value } = event.target;
              onEdit((d) => ({ ...d, name: value }));
            }}
            className="w-full bg-transparent text-[length:var(--ui-fs-panel-title)] font-semibold focus-visible:outline-none"
          />
        </div>

        <div className="flex flex-col gap-2 overflow-y-auto px-3 py-1">
          <div className="flex items-center gap-2 text-[length:var(--ui-fs-control)]">
            <span className="shrink-0 text-muted-foreground">Reference</span>
            <RuleNumber
              ariaLabel="Loudness Profile reference"
              value={document.referenceLufs ?? null}
              onCommit={(next) =>
                onEdit((d) => withReferenceLufs(d, next))
              }
            />
            <span className="text-muted-foreground/60">LUFS</span>
          </div>

          <div className="border-t border-border/40 pt-1">
            {ruleIds.map((metricId) =>
              document.metrics?.[metricId] ? (
                <RuleRow
                  key={metricId}
                  metricId={metricId}
                  rule={document.metrics[metricId]}
                  onPatch={(patch) => patchRule(metricId, patch)}
                  onRemove={() => removeMetric(metricId)}
                />
              ) : null
            )}
          </div>

          <div className="border-t border-border/40 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Add metric"
              onClick={() => setAddOpen((open) => !open)}
              className="h-7 gap-1 px-2 text-[length:var(--ui-fs-control)]"
            >
              <Plus className="size-[length:var(--ui-icon-management-action)]" />
              Add metric
            </Button>
            {addOpen ? (
              <div className="mt-1 flex flex-col rounded border border-border/60 p-1">
                {addable.map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-label={`Add ${STATS_META[id]?.label ?? id}`}
                    onClick={() => addMetric(id)}
                    className="rounded px-1.5 py-1 text-left text-[length:var(--ui-fs-control)] hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {STATS_META[id]?.label ?? id}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <p className="text-[length:var(--ui-fs-caption)] leading-snug text-muted-foreground">
            Delivery reference, not a certification. Dialogue metrics use on-device detection.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
          <Button variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={!(document.name ?? "").trim()}>
            Save
          </Button>
        </div>
      </div>

      <Dialog.Root open={discardOpen} onOpenChange={setDiscardOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/60" />
          <Dialog.Content
            role="alertdialog"
            className="fixed left-1/2 top-1/2 z-[61] w-80 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-xl focus:outline-none"
          >
            <Dialog.Title className="mb-3 text-[length:var(--ui-fs-body)] font-semibold text-foreground">
              Discard profile changes?
            </Dialog.Title>
            <Dialog.Description className="mb-6 text-[length:var(--ui-fs-body)] text-muted-foreground">
              Unsaved rule edits will be discarded.
            </Dialog.Description>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDiscardOpen(false)}>
                Keep Editing
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setDiscardOpen(false);
                  onCancel();
                }}
              >
                Discard Changes
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
```

Note the import list above already carries `withReferenceLufs` and deliberately does not import `cn` — lint fails on an unused import, and nothing in this component needs conditional classes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/LoudnessProfileEditor.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/LoudnessProfileEditor.jsx src/components/LoudnessProfileEditor.test.jsx
git commit -m "feat(loudness): add the Loudness Profile editor panel" -m "Presentational: it owns drag and the discard prompt and nothing else. Rule shape comes from the metric, so the form speaks in targets and ceilings rather than asking the user what a role is." -m "Numbers commit on blur; blank is a real value here, meaning the rule is not judged yet." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Mount the editor and wire the entry points

**Files:**
- Modify: `src/components/AppSettingsOverlays.jsx`
- Modify: `src/components/LoudnessProfilePopover.jsx`
- Modify: `src/App.jsx` (pass the profile controller into overlays)
- Test: `src/components/LoudnessProfilePopover.test.jsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/components/LoudnessProfilePopover.test.jsx`:

```jsx
describe("editor entry points", () => {
  it("opens the editor on a user profile", () => {
    const { hook, rerender } = renderPopover();
    act(() => hook.result.current.beginCreate());
    act(() => hook.result.current.editDraft((d) => ({ ...d, name: "Mine" })));
    act(() => hook.result.current.saveDraft());
    rerender();

    fireEvent.click(screen.getByLabelText("Edit Mine"));
    expect(hook.result.current.draft.editingId).toBe(hook.result.current.userProfiles[0].id);
  });

  it("opens the editor on a duplicate of a built-in", () => {
    const { hook } = renderPopover();
    fireEvent.click(screen.getByLabelText("Duplicate EBU R128 S1"));

    expect(hook.result.current.draft.document.basedOn).toBe("ebu-r128-s1");
    expect(hook.result.current.draft.editingId).toBe(null);
  });

  it("opens the editor on a new profile", () => {
    const { hook } = renderPopover();
    fireEvent.click(screen.getByRole("button", { name: "New Loudness Profile" }));

    expect(hook.result.current.draft.editingId).toBe(null);
    expect(hook.result.current.draft.document.metrics.integrated).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/LoudnessProfilePopover.test.jsx`
Expected: FAIL — no `Edit Mine` / `New Loudness Profile` control.

- [ ] **Step 3: Add the popover entry points**

In `src/components/LoudnessProfilePopover.jsx`:

Change the built-in duplicate button's handler from `profile.duplicateBuiltin` to `profile.beginDuplicate`:

```jsx
              onClick={() => profile.beginDuplicate(builtin.id)}
```

Add a pencil to each user row, before the existing rename pencil — rename stays inline, edit opens the panel. Give the two distinct labels so they stay distinguishable:

```jsx
            <button
              type="button"
              aria-label={`Edit ${entry.name}`}
              title="Edit rules"
              onClick={() => profile.beginEdit(entry.id)}
              className={ICON_BUTTON_CLASS}
            >
              <SlidersHorizontal className="size-[length:var(--ui-icon-management-action)]" />
            </button>
```

Import `SlidersHorizontal` from `lucide-react` alongside the existing icons.

Add a New profile row after the user list:

```jsx
      <div className={ROW_CLASS}>
        <button
          type="button"
          aria-label="New Loudness Profile"
          onClick={profile.beginCreate}
          className={ROW_BUTTON_CLASS}
        >
          <Plus className="size-[length:var(--ui-icon-management-action)] text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">New profile</span>
        </button>
      </div>
```

Import `Plus` too.

- [ ] **Step 4: Mount the panel**

In `src/components/AppSettingsOverlays.jsx`, accept the controller and render the editor beside `ThemeEditor`:

```jsx
export function AppSettingsOverlays({
  settings,
  channelSettings,
  updateControls,
  appVersion,
  loudnessProfile,
}) {
```

```jsx
      {loudnessProfile?.draft ? (
        <LoudnessProfileEditor
          draft={loudnessProfile.draft}
          onEdit={loudnessProfile.editDraft}
          onSave={loudnessProfile.saveDraft}
          onCancel={loudnessProfile.cancelDraft}
          pos={loudnessProfilePos}
          onMove={setLoudnessProfilePos}
        />
      ) : null}
```

Import the component, and hold the position in this file the same way the theme editor's is held:

```jsx
  const [loudnessProfilePos, setLoudnessProfilePos] = useState({ x: 120, y: 120 });
```

In `src/App.jsx`, pass the controller at the existing `<AppSettingsOverlays` call site (around line 1396):

```jsx
        loudnessProfile={loudnessProfile}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/LoudnessProfilePopover.test.jsx && npm run check`
Expected: PASS, then EXIT 0.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(loudness): open the profile editor from the popover" -m "Duplicate, edit and new all land in the same panel. The popover stays a switcher, which is all the user who only wants a built-in ever has to see." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Delete the unsaved-custom slot

The scratch pad existed because there was nowhere to edit rules. Now there is, so the selection model narrows to `off` | `builtin:<id>` | `user:<id>`.

Do this after Task 9, not before: removing a capability before its replacement is mounted leaves a build with no way to create a profile at all.

**Files:**
- Modify: `src/lib/loudnessProfileCatalog.js`, `src/lib/loudnessProfileNormalize.js`, `src/hooks/LoudnessProfileContext.jsx`, `src/components/LoudnessProfilePopover.jsx`, `src/hooks/usePresets.js`
- Test: the matching `*.test.js(x)` for each

- [ ] **Step 1: Write the failing tests**

In `src/lib/loudnessProfileNormalize.test.js`:

```js
describe("the custom slot is gone", () => {
  it("reads a persisted unsaved-custom selection as Off", () => {
    const state = normalizeLoudnessProfiles({
      active: "unsaved-custom",
      customDraft: { id: "custom", name: "Custom", metrics: {}, preferredMetricIds: [] },
    });
    expect(state.active).toBe(LOUDNESS_PROFILE_OFF);
  });

  it("does not carry a customDraft forward", () => {
    const state = normalizeLoudnessProfiles({
      active: "off",
      customDraft: { id: "custom", name: "Custom", metrics: {}, preferredMetricIds: [] },
    });
    expect(state.customDraft).toBeUndefined();
  });
});
```

In `src/components/LoudnessProfilePopover.test.jsx`:

```jsx
it("no longer offers the Custom slot", () => {
  renderPopover();
  expect(screen.queryByLabelText("Use custom Loudness Profile")).toBeNull();
  expect(screen.queryByLabelText("Save custom profile as")).toBeNull();
  // The reference now lives in the editor, where it sits beside the rule it anchors.
  expect(screen.queryByLabelText("Loudness Profile reference")).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/loudnessProfileNormalize.test.js src/components/LoudnessProfilePopover.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Narrow the catalog**

In `src/lib/loudnessProfileCatalog.js`:

- Delete `export const LOUDNESS_PROFILE_CUSTOM`.
- Rename `createDefaultCustomDraft` to `createProfileDraft` and update its comment:

```js
/// The starter a New profile opens on. Integrated and True Peak are the two rules every delivery
/// reference in the catalog shares, and a blank editor with no rows is a dead end.
export function createProfileDraft() {
  return {
    id: "draft",
    name: "",
    kind: "draft",
    referenceLufs: -23,
    preferredMetricIds: ["integrated", "truePeak"],
    metrics: {
      integrated: target(-23, 0.5, 0.5),
      truePeak: limitMax(-1),
    },
  };
}
```

The name starts empty so Save stays disabled until the user names it.

- In `parseSelection`, delete the `LOUDNESS_PROFILE_CUSTOM` branch. Anything unrecognised already falls through to `{ kind: "off" }`, which is what a stored `"unsaved-custom"` now hits.
- In `resolveActiveDocument`, delete the `kind === "draft"` branch.

- [ ] **Step 4: Narrow normalization**

In `src/lib/loudnessProfileNormalize.js`:

- Delete the `LOUDNESS_PROFILE_CUSTOM` import and the `customDraft` field from `DEFAULT_LOUDNESS_PROFILES`.
- Delete the `const customDraft = normalizeRuleDocument(raw.customDraft, ...)` line and the `customDraft` key from the returned object.
- In `normalizeActive`, delete the `kind === "draft"` branch and drop `customDraft` from its parameter.

- [ ] **Step 5: Narrow the provider**

In `src/hooks/LoudnessProfileContext.jsx`, delete `selectUnsavedCustom`, `updateCustomDraft`, `saveCustomAs`, `duplicateBuiltin`, and the `customDraft` entries in the returned value and its dependency array. Point `beginCreate` at the renamed factory:

```jsx
  const beginCreate = useCallback(() => {
    setDraft({ editingId: null, document: createProfileDraft(), dirty: false });
  }, []);
```

`snapshotForPreset` drops its draft key:

```jsx
  const snapshotForPreset = useCallback(
    () => ({ loudnessProfileActive: state.active }),
    [state.active]
  );
```

`applyPresetSnapshot` no longer has a draft to restore:

```jsx
  const applyPresetSnapshot = useCallback(
    (snapshot) =>
      commit(
        (prev) => (snapshot ? { ...prev, active: snapshot.loudnessProfileActive } : prev),
        { presetDirty: false }
      ),
    [commit]
  );
```

Remove the now-unused `parseSelection` import.

- [ ] **Step 6: Narrow the popover**

In `src/components/LoudnessProfilePopover.jsx`, delete: the Custom row, the `isCustomActive` constant, the Save-as input block, and the whole Reference block plus the `ReferenceInput` component and its `withReferenceLufs` import — the editor owns that field now. `selectionLabel` simplifies:

```jsx
  const selectionLabel = document?.name ?? "Off";
```

Delete the `useEffect` import if nothing else in the file uses it.

- [ ] **Step 7: Drop the draft from preset snapshots**

In `src/hooks/usePresets.js`, nothing references `loudnessProfileCustomDraft` directly — the key stops appearing on its own because `snapshotLoudnessProfile()` no longer returns it. `src/hooks/usePresets.test.jsx` contains no reference to it either (verified at `a146aebf`), so there is nothing to change in this step. It is listed only so you do not go looking.

- [ ] **Step 8: Run the full gate**

Run: `npm run check`
Expected: EXIT 0. Several existing popover and provider tests reference the deleted API and must be deleted or rewritten against the editor — that is the intended churn, not a signal to keep the slot.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(loudness): retire the unsaved-custom scratch pad" -m "It existed because there was nowhere to edit rules. The editor's own draft replaces it, so the selection model narrows to Off, built-in and user, and presets snapshot a selection id alone." -m "No migration: a stored unsaved-custom already falls through parseSelection to Off." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Narrow preset divergence to selection changes

With `customDraft` gone the preset snapshot is a single id, so editing a profile's rules no longer diverges from the preset.

**Files:**
- Modify: `src/hooks/LoudnessProfileContext.jsx`
- Test: `src/hooks/LoudnessProfileContext.test.jsx`

- [ ] **Step 1: Write the failing tests**

Replace the `preset divergence` block in `src/hooks/LoudnessProfileContext.test.jsx` with:

```jsx
describe("preset divergence", () => {
  beforeEach(() => {
    presetsStore.reset();
    presetsStore.patch({ activeId: "p1", dirty: false });
  });

  const clean = () => presetsStore.patch({ dirty: false });

  it("marks the preset dirty when the selection changes", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.select(builtinSelectionId("ebu-r128")));
    expect(presetsStore.read().dirty).toBe(true);
  });

  it("marks it dirty when saving a draft selects what it saved", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, name: "Mine" })));
    clean();
    act(() => result.current.saveDraft());
    expect(presetsStore.read().dirty).toBe(true);
  });

  it("marks it dirty when deleting the active profile falls back to Off", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, name: "Doomed" })));
    act(() => result.current.saveDraft());
    const { id } = result.current.userProfiles[0];
    clean();

    act(() => result.current.removeUser(id));
    expect(presetsStore.read().dirty).toBe(true);
  });

  it("leaves it clean when a rename does not move the selection", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, name: "Before" })));
    act(() => result.current.saveDraft());
    const { id } = result.current.userProfiles[0];
    clean();

    act(() => result.current.renameUser(id, "After"));
    // The preset snapshots an id, not the rules behind it, so this is not a divergence.
    expect(presetsStore.read().dirty).toBe(false);
  });

  it("leaves it clean when deleting a profile that was not active", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, name: "Keep" })));
    act(() => result.current.saveDraft());
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, name: "Spare" })));
    act(() => result.current.saveDraft());
    const spare = result.current.userProfiles.find((p) => p.name === "Keep");
    act(() => result.current.select(builtinSelectionId("ebu-r128")));
    clean();

    act(() => result.current.removeUser(spare.id));
    expect(presetsStore.read().dirty).toBe(false);
  });

  it("does not dirty the preset it is restoring", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() =>
      result.current.applyPresetSnapshot({
        loudnessProfileActive: builtinSelectionId("ebu-r128"),
      })
    );
    expect(presetsStore.read().dirty).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/hooks/LoudnessProfileContext.test.jsx`
Expected: FAIL — the rename and non-active-delete cases report `true`.

- [ ] **Step 3: Compare the selection instead of flagging call sites**

In `src/hooks/LoudnessProfileContext.jsx`, replace `commit`:

```jsx
  /// Layout presets snapshot which profile is active and nothing else, so only a change of
  /// selection diverges from the preset -- editing a profile's rules does not.
  ///
  /// Comparing `active` before and after is what makes that correct: two library operations move
  /// the selection as a side effect, and a per-call-site flag gets both wrong. Saving a draft
  /// selects what it saved; deleting the active profile falls back to Off.
  ///
  /// `presetDirty: false` is for the one selection change that is not a divergence: restoring a
  /// snapshot.
  const commit = useCallback((updater, { presetDirty = true } = {}) => {
    setState((prev) => {
      const next = normalizeLoudnessProfiles(updater(prev));
      writeState(next);
      if (presetDirty && next.active !== prev.active) presetsStore.patch({ dirty: true });
      return next;
    });
  }, []);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/hooks/LoudnessProfileContext.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix(loudness): diverge a preset only when the selection moves" -m "Presets snapshot which profile is active, not the rules behind it, so editing a profile is not a divergence. Comparing active before and after also catches the two library operations that move the selection as a side effect." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: The footer names the profile

**Files:**
- Modify: `src/components/AppShell.jsx:99-110`
- Modify: `src/App.jsx` (footer prop)
- Test: `src/App.smoke.test.jsx`

There is no `AppShell` unit test and no `renderShell` helper: the footer is covered by
`App.smoke.test.jsx`, which renders the whole `<App />`. Work in that file.

- [ ] **Step 1: Write the failing test**

`src/App.smoke.test.jsx` already has `renders the footer status hierarchy`, which asserts
`queryByText("Ref")` is null because the profile defaults to Off. Update its comment and add the
new cases beside it:

```jsx
  it("renders the footer status hierarchy", async () => {
    render(<App />);
    await screen.findByRole("button", { name: /^start$/i });

    expect(screen.getByText("Device")).toBeTruthy();
    expect(screen.getByText("Not connected")).toBeTruthy();
    expect(screen.getByText("Preset")).toBeTruthy();
    // Off by default, so there is no profile to name and the whole item is absent.
    expect(screen.queryByText("Loudness")).toBeNull();
  });

  it("names the active Loudness Profile in the footer", async () => {
    settingsStore.patch({
      loudnessProfiles: { active: "builtin:ebu-r128", userProfiles: [] },
    });
    render(<App />);
    await screen.findByRole("button", { name: /^start$/i });

    expect(screen.getByText("Loudness")).toBeTruthy();
    expect(screen.getByText("EBU R128")).toBeTruthy();
  });

  it("does not label the footer item Profile", async () => {
    // Configuration Profile owns that word, and this item sits directly beside Preset, where two
    // spellings of one idea read as the same control.
    settingsStore.patch({
      loudnessProfiles: { active: "builtin:ebu-r128", userProfiles: [] },
    });
    render(<App />);
    await screen.findByRole("button", { name: /^start$/i });

    expect(screen.queryByText("Profile")).toBeNull();
  });
```

Import `settingsStore` from `./persistence/index.js` in that file if it is not already imported,
and make sure the suite's existing reset hook clears it between cases.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/App.smoke.test.jsx`
Expected: FAIL — the footer still renders `Ref`, and `Loudness` is nowhere.

- [ ] **Step 3: Rewrite the footer item**

In `src/components/AppShell.jsx`, replace the reference block:

```jsx
                  {/* Which regime you are monitoring under is the fact worth a permanent slot;
                      the reference value is already drawn on the chart as the line it describes.
                      Labelled Loudness, not Profile: that word belongs to Configuration Profile,
                      and this item sits directly beside Preset. */}
                  {footer.loudnessProfileName ? (
                    <>
                      <div className={FOOTER_DIVIDER} />
                      <span className={FOOTER_LABEL}>Loudness</span>
                      <span className={FOOTER_VALUE}>{footer.loudnessProfileName}</span>
                    </>
                  ) : null}
```

`FOOTER_VALUE` already carries `min-w-0 truncate`, so a long user-authored name needs no new handling.

- [ ] **Step 4: Supply the name**

In `src/App.jsx`, where the footer object is assembled, replace `referenceLufs` with:

```jsx
    // The draft outranks the selection, so a profile being edited names the footer too. An
    // unnamed new profile reads Untitled, matching normalizeRuleDocument's fallback.
    loudnessProfileName: loudnessProfile.document
      ? (loudnessProfile.document.name || "Untitled")
      : null,
```

Leave the separate `referenceLufs` binding that feeds the loudness history data alone — that is its only remaining consumer.

- [ ] **Step 5: Run the test and the gate**

Run: `npx vitest run src/App.smoke.test.jsx && npm run check`
Expected: PASS, then EXIT 0.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(loudness): report the active profile in the footer, not its number" -m "The regime you are monitoring under earns the permanent slot; the reference value is already drawn on the chart as the line it describes." -m "Labelled Loudness rather than Profile: Configuration Profile owns that word, and this item sits next to Preset." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 13: Applying a preset cancels an open draft

A preset changes the selection underneath a draft that outranks it, so the user would apply a preset and see no change.

**Files:**
- Modify: `src/hooks/LoudnessProfileContext.jsx`
- Test: `src/hooks/LoudnessProfileContext.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
describe("a preset arriving mid-edit", () => {
  it("cancels the draft so the preset is what you see", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, referenceLufs: -16 })));

    act(() =>
      result.current.applyPresetSnapshot({
        loudnessProfileActive: builtinSelectionId("ebu-r128"),
      })
    );

    // Without this the draft keeps outranking the selection and applying the preset looks like
    // it did nothing.
    expect(result.current.draft).toBe(null);
    expect(result.current.referenceLufs).toBe(-23);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/hooks/LoudnessProfileContext.test.jsx`
Expected: FAIL — `referenceLufs` is still `-16`.

- [ ] **Step 3: Drop the draft on apply**

```jsx
  /// A preset changes the selection underneath the draft, and the draft outranks the selection.
  /// Keeping it would make applying a preset look like it did nothing, so the draft goes.
  const applyPresetSnapshot = useCallback(
    (snapshot) => {
      setDraft(null);
      commit(
        (prev) => (snapshot ? { ...prev, active: snapshot.loudnessProfileActive } : prev),
        { presetDirty: false }
      );
    },
    [commit]
  );
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/hooks/LoudnessProfileContext.test.jsx`
Expected: PASS.

- [ ] **Step 5: Run the full gate**

Run: `npm run check`
Expected: EXIT 0.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix(loudness): drop an open draft when a preset is applied" -m "The draft outranks the selection, so a preset arriving mid-edit would change what is stored and nothing on screen." -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## After the plan

`npm run check` is not the whole story here. Nothing in this feature is covered by the capture layer, so `smoke:capture` and `soak:capture` are not required — but every task above is a UI interaction path, and the tests only reach the store and the DOM.

Ask the user to run `npm run desktop` and walk:

1. Off on a cold profile — no reference line, no footer Loudness item, `ref` absent from Layers and the count matching the list.
2. Pick a built-in — line appears, footer names it, Stats colours by status.
3. New profile → add Correlation → type a floor → the Stats row changes colour **while typing**, against playing audio.
4. Cancel → everything returns to what it was, library unchanged.
5. Save → the profile appears under Yours and is selected.
6. With a preset active, switch profile → footer shows `*`; edit a saved profile's rules → footer does **not**.
7. Dock the window — Stats colours there must match the main window under the same profile.

Step 7 is the one an automated test is weakest at and the one the parent spec warns about most.
