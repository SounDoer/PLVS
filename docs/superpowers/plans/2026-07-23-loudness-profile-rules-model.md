# Loudness Profile rules-model rewrite — Implementation Plan

> **For agentic workers:** implement task-by-task; every task ends on a green `npm run check`.
> Commit messages are English, subjects never start with `@`.

**Goal:** Replace the per-metric rule *shapes* (`target` / `limit` / `descriptor` / `na`) with one
uniform model: a profile is a flat **list of atomic rules**, each `metric + operator + value +
severity`, plus a standalone `reference` value that only draws a guide line. This removes the
"is the number inside or outside the band?" ambiguity — every rule reads as a breach sentence
("Integrated above −14 → Fail") — and gives users full freedom (any metric can carry a ceiling, a
floor, a band, or several escalating thresholds).

**Supersedes:** the rule-shape parts of `2026-07-20-loudness-profile-editor.md` /
`-editor-design.md` (roles, tolerance, min/max, N/A, the near-boundary auto-warn). The provider,
draft-preview, popover-entry and persistence-domain decisions from that work still stand.

**Status:** Draft — pending review before execution. Design settled in the 2026-07-23 discussion.

---

## The model

### Rule

```
{ metricId: string, op: ">" | "<", value: number, severity: "warn" | "fail" }
```

A profile document becomes:

```
{ id, name, kind, referenceLufs: number|null, rules: Rule[] }
```

- **Only two operators**, `>` and `<`. For continuous LUFS/dBTP values the `≥` / `≤` / `=`
  distinction is meaningless; someone who wants "−1 itself fails" sets `> -1.1`.
- **One metric may carry several rules** — that is how escalation (a warn band inside a fail band)
  and two-sided bands (fail above AND below) are expressed.
- `preferredMetricIds`, `role`, `tolerance`, `min`/`max`, `target`, `provisional`,
  `requiresDialogueCoverage`, `NEAR_BOUNDARY_MARGIN`, the `descriptor` and `na` concepts, and the
  `METRIC_RULE_ROLE` shape table are **all removed**.

### Evaluation

Per metric shown in Stats:

1. Gather that metric's rules. **No rules → `unwatched`.**
2. A rule *fires* when its comparison is true (`value > rule.value` for `>`, `value < rule.value`
   for `<`).
3. Status = the most severe fired rule (`fail` > `warn`); nothing fired → `ok`.
4. **Automatic, metric-level gates (not user-configured):**
   - `integrated` (and dialogue-integrated) return `pending` until the engine reports the value
     ready — unchanged from today.
   - Dialogue-family metrics (`dialogueIntegrated`, …) return `inconclusive` when
     `dialogueCoverage < MIN_DIALOGUE_COVERAGE_PERCENT`. The gate is intrinsic to the metric; the
     user never sees or sets it.
5. **"Only warn, never fail" (the old `provisional` cap for realtime Integrated) is expressed by
   authoring the rule with `severity: "warn"`.** No separate flag survives.

"Watched" (for the label-highlight from problem 1) = the metric has ≥1 rule.

### Reference

- `referenceLufs` is an **independent numeric field** on the profile. It does **not** judge.
- Its only job: draw a horizontal dashed guide line in the Loudness history chart (panel **and**
  dock). It no longer tints any trace.
- Left blank → no guide line. **No auto-derivation** from integrated rules (chosen option A).
- The Level Meter does **not** use `referenceLufs` (confirmed — earlier "level meter anchor" was a
  mistake).

### Loudness chart (`LoudnessHistoryChart` + `DockLoudness`)

- The `ref` layer flips from "over/under trace coloring" to **"show/hide the guide line"**.
- Retire `--ui-loudness-momentary-over` and `--ui-loudness-shortterm-over` (source
  `buildThemeTokens.js`, its test, `design-tokens.md`).
- M/ST traces are colored **only** by their own rules, band-aware: tint the segments that violate,
  both sides, in the rule's warn/fail status colour. No M/ST rules → plain trace.
- Profile off → no `ref` layer option, no line, no trace coloring.

### Allowed edge cases

- A profile with **zero rules** is valid and savable (it just draws a reference line, or nothing).
- Integrated with no rule → simply not judged; reference line is independent of it.

---

## Migration (built-ins + persisted customs)

Rewrite every built-in in `loudnessProfileCatalog.js` as `{ referenceLufs, rules[] }`. Mapping from
the old shapes:

| Old | New rules |
| --- | --- |
| `target(t, minus, plus)` sev `S` | `{metric, ">", t+plus, S}`, `{metric, "<", t−minus, S}` |
| `limitMax(m)` sev `S` | `{metric, ">", m, S}` |
| `limit` with `min` only | `{metric, "<", min, S}` |
| `limit` band (min+max) | both of the above |
| `descriptor` / `na` | dropped (no rule) |
| `provisional: true` | severity becomes `warn` |
| `requiresDialogueCoverage` | dropped from the rule; handled by the metric-level gate |

Worked example — **EBU R128** (`reference −23`):
```
integrated > -22.5  fail
integrated < -23.5  fail
truePeak   > -1      fail
```
**R128 Live** = same but the two integrated rules are `warn`. **R128 S1** adds
`shortTermMax > -18 fail` and drops LRA entirely (was N/A). **ATSC A/85** uses `dialogueIntegrated`
rules (coverage gate intrinsic) + `truePeak > -2`. **Streaming −14** = integrated `±1 warn`,
`truePeak > -1 warn`.

Persisted custom profiles: a one-time `migrate` in `loudnessProfileNormalize.js` converts the old
`metrics{}`-with-roles blob to `rules[]` using the table above. This is a persistence-domain change
— read `src/persistence/index.js` first and keep it inside the loudness-profile domain.

---

## File map

| File | Change | Phase |
| --- | --- | --- |
| `src/lib/loudnessProfileCatalog.js` | Built-ins → rule lists; drop roles/shape table; new rule + empty-profile factories; `preferredMetricIds` derived from rules | A |
| `src/lib/loudnessProfileEvaluate.js` | Rewrite: fire-rules → worst severity; metric-level pending/inconclusive gates | A |
| `src/lib/loudnessProfileNormalize.js` | New rule shape; **migrate** old blobs | A |
| `src/lib/loudnessProfileMissing.js` | "Missing" keyed off "has rules", not roles | A |
| `src/persistence/profileShape.js` | Persisted shape = `{reference, rules[]}` | A |
| `src/hooks/LoudnessProfileContext.jsx` | Draft edit API works on `rules[]` + `reference` | A/B |
| `src/components/LoudnessProfileEditor.jsx` | Flat rule list (`metric ▼ op ▼ value sev ▼ ×`) + Add rule + standalone Reference input; allow all-empty save | B |
| `src/components/LoudnessProfilePopover.jsx` | Reflect new shape/labels | B |
| `src/components/panels/LoudnessHistoryChart.jsx` | `ref` layer = guide line; drop over/under; band-aware M/ST from rules | C |
| `src/dock/modules/DockLoudness.jsx` | Same as the chart | C |
| `src/theme/buildThemeTokens.js` (+ test, `design-tokens.md`) | Retire `--ui-loudness-*-over` | C |
| `src/hooks/useMeterSettings.js`, `useLoudnessHistory.js` | `referenceLufs` plumbing unchanged in shape, sourced from the field | C |

Problem-1 files (`loudnessProfileStatusClasses.js`, `StatsPanel`, `DockStats`, `LevelMeterPanel`)
already emit/consume the `ok/warn/pending/inconclusive/fail/unwatched` status vocabulary, which the
new evaluator keeps — so they need **no** further change beyond confirming green.

---

## Phases

Each phase ends green; land as its own commit(s).

### Phase A — Core model (pure logic, no UI)
1. New rule shape + factories + built-ins rewritten in the catalog. Tests: every built-in evaluates
   as before on representative samples.
2. Rewrite `loudnessProfileEvaluate` (fire → worst severity; gates). Tests: multi-rule escalation,
   two-sided band, empty profile, dialogue gate, integrated pending, warn-only.
3. `normalize` + `migrate`: old blob → new `rules[]`; empty profile survives. Tests: migrate each
   old shape; round-trip.
4. `loudnessProfileMissing` off "has rules". Tests updated.
**Verify:** `npm run check` green; Stats/Dock/LevelMeter suites still pass unchanged.

### Phase B — Editor UI
5. `LoudnessProfileEditor` becomes a flat rule list + Add rule + standalone Reference input; Save
   allowed with zero rules. Tests: add/remove/edit a rule; two rules on one metric; save empty.
6. `LoudnessProfilePopover` copy/shape follow-through.
**Verify:** editor drives the live preview; `npm run check` green.

### Phase C — Reference + Loudness chart
7. `LoudnessHistoryChart`: `ref` layer draws the dashed guide line; remove the over/under gradient;
   colour M/ST segments from their rules (band-aware). 
8. `DockLoudness`: mirror task 7.
9. Retire `--ui-loudness-*-over` tokens (source + test + docs); regenerate theme.
**Verify:** off → no line/colour; a profile with M/ST rules tints only violating segments; both
surfaces agree; `npm run check` green.

### Phase D — Sweep
10. Grep for dead references to removed concepts (`role`, `tolerance`, `preferredMetricIds`,
    `descriptor`, `na`, `provisional`, `requiresDialogueCoverage`, `NEAR_BOUNDARY_MARGIN`). Delete
    orphans this rewrite created.
11. Update `docs/prd.md` / any loudness docs that describe the old shapes.
**Verify:** full `npm run check`; manual `npm run desktop` smoke of R128 + a custom two-sided rule.

---

## Open risks

- **Migration correctness** is the sharp edge: a wrong conversion silently reshapes a saved profile.
  Phase A task 3 must test each old shape explicitly, and the migrate must be conservative (unknown
  → drop the rule, never invent a threshold).
- **Band-aware M/ST coloring** (task 7) is the only genuinely new rendering; the over/under gradient
  is a starting point but now needs two edges per rule and status colours.
- Capture layer is untouched — no soak/smoke implications.
