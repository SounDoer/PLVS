# Level Meter Colour Thresholds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anchor the Level Meter's colours to levels: user thresholds for Peak/RMS, Loudness
Profile ceilings (or a neutral colour) for Momentary/Short-term, in both the Workspace panel and the
Dock strip.

**Architecture:** One pure module, `src/lib/levelMeterColors.js`, turns a mode, the panel controls
and the active Loudness Profile into dB colour stops, and the stops plus a visible range into a CSS
`background-image`. The panel and the Dock only call it. Thresholds are two new pair rows in the
panel control table, so persistence, presets, the Dock and Agent Control inherit them the way they
inherit every other control.

**Tech Stack:** React 19, framer-motion, Vitest (jsdom), plain CSS custom properties.

**Spec:** `docs/history/specs/2026-09-26-level-meter-color-thresholds-design.md`

**Conventions for every task**

- Tests run with `npx vitest run <file>`; React tests need `/** @vitest-environment jsdom */` (already
  present in every test file touched here).
- Commit with Conventional Commits and scope, ending with the attribution line
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not start a subject with `@`.
- Work lands on `main`.

---

## File map

| File                                                                                                   | Change                                          |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| `src/lib/levelMeterColors.js`                                                                          | Create: stops, gradient, marker status          |
| `src/lib/levelMeterColors.test.js`                                                                     | Create                                          |
| `src/lib/panelControls.js`                                                                             | Two threshold pair rows                         |
| `src/lib/panelControls.test.js`                                                                        | Threshold normalisation tests                   |
| `src/components/PanelSettingsContent.jsx`                                                              | `SettingsThresholdInputs` + `thresholds` widget |
| `src/components/PanelSettingsContent.test.jsx`                                                         | Threshold row tests                             |
| `src/components/panels/LevelMeterPanel.jsx`                                                            | Use computed background; marker status          |
| `src/components/panels/LevelMeterPanel.test.jsx`                                                       | Colour and marker tests                         |
| `src/dock/dockModuleControls.js`                                                                       | Carry threshold keys on `level`                 |
| `src/dock/modules/DockLevel.jsx`                                                                       | Use computed background; drop clip flash        |
| `src/dock/modules/DockLevel.test.jsx`                                                                  | Provider wrapper, colour tests                  |
| `src/dock/editors/DockModuleSettings.jsx`                                                              | Threshold row                                   |
| `src/dock/editors/DockModuleSettings.test.jsx`                                                         | Threshold row test, updated defaults            |
| `src/index.css`, `src/preferences/data.js`, `applyDocumentTheme.js`                                    | Remove the stop position                        |
| `docs/design-tokens.md`                                                                                | Remove `--ui-meter-gradient-mid-stop`           |
| `src/agentControl/panelControls.js`, `panelControlSchema.js`, `panelControlPatch.js`, `dockControl.js` | Public threshold fields                         |
| `src/agentControl/*.test.js`                                                                           | Contract tests                                  |
| `docs/agent-control/generated/`                                                                        | Regenerated, never hand-edited                  |
| `docs/user/panels.md`, `docs/user/loudness-profiles.md`                                                | User guide                                      |

---

### Task 1: Pure colour module

**Files:**

- Create: `src/lib/levelMeterColors.js`
- Test: `src/lib/levelMeterColors.test.js`

- [ ] **Step 1: Write the failing tests**

```js
import { describe, expect, it } from "vitest";
import {
  LEVEL_METER_COLORS,
  levelMeterBackground,
  levelMeterMarkerStatus,
  profileStops,
  stopsToGradient,
  thresholdStops,
} from "./levelMeterColors.js";

const { safe, warning, critical } = LEVEL_METER_COLORS;

function profile(rules) {
  return { id: "p", name: "P", referenceLufs: null, rules };
}

describe("thresholdStops", () => {
  it("places safe at the scale minimum and each threshold at its level", () => {
    expect(thresholdStops(-60, -6, -1)).toEqual([
      { db: -60, color: safe },
      { db: -6, color: warning },
      { db: -1, color: critical },
    ]);
  });

  it("drops the warning stop when both thresholds are equal", () => {
    expect(thresholdStops(-60, -3, -3)).toEqual([
      { db: -60, color: safe },
      { db: -3, color: critical },
    ]);
  });
});

describe("profileStops", () => {
  it("returns null when no rule applies, so the caller shows the neutral colour", () => {
    expect(profileStops(null, "momentary", -64)).toBeNull();
    expect(
      profileStops(
        profile([{ metricId: "integrated", op: ">", value: -22.5, severity: "fail" }]),
        "momentary",
        -64
      )
    ).toBeNull();
  });

  it("reads ceilings on the metric and on its Max", () => {
    const doc = profile([
      { metricId: "momentary", op: ">", value: -20, severity: "warn" },
      { metricId: "momentaryMax", op: ">", value: -16, severity: "fail" },
      { metricId: "shortTermMax", op: ">", value: -30, severity: "fail" },
    ]);
    expect(profileStops(doc, "momentary", -64)).toEqual([
      { db: -64, color: safe },
      { db: -20, color: warning },
      { db: -16, color: critical },
    ]);
  });

  it("ignores floors and blank rules", () => {
    const doc = profile([
      { metricId: "momentary", op: "<", value: -40, severity: "fail" },
      { metricId: "momentary", op: ">", value: undefined, severity: "fail" },
    ]);
    expect(profileStops(doc, "momentary", -64)).toBeNull();
  });

  it("keeps a stop only when it is more severe than every lower one", () => {
    const doc = profile([
      { metricId: "shortTerm", op: ">", value: -20, severity: "fail" },
      { metricId: "shortTerm", op: ">", value: -18, severity: "warn" },
      { metricId: "shortTermMax", op: ">", value: -20, severity: "warn" },
    ]);
    expect(profileStops(doc, "shortTerm", -64)).toEqual([
      { db: -64, color: safe },
      { db: -20, color: critical },
    ]);
  });

  it("does not synthesise a warning stop for a single fail rule", () => {
    const doc = profile([{ metricId: "momentaryMax", op: ">", value: -18, severity: "fail" }]);
    expect(profileStops(doc, "momentary", -64)).toEqual([
      { db: -64, color: safe },
      { db: -18, color: critical },
    ]);
  });

  it("drops the safe stop when the lowest threshold is at or below the scale minimum", () => {
    const doc = profile([{ metricId: "momentary", op: ">", value: -70, severity: "fail" }]);
    expect(profileStops(doc, "momentary", -64)).toEqual([{ db: -70, color: critical }]);
  });
});

describe("stopsToGradient", () => {
  it("converts levels to percentages of the visible range", () => {
    expect(stopsToGradient(thresholdStops(-60, -6, -1), -60, 3, "to top")).toBe(
      `linear-gradient(to top, ${safe} 0%, ${warning} 85.714%, ${critical} 93.651%)`
    );
  });

  it("keeps each stop on its level when the range is zoomed", () => {
    expect(stopsToGradient(thresholdStops(-60, -6, -1), -30, 0, "to top")).toBe(
      `linear-gradient(to top, ${safe} -100%, ${warning} 80%, ${critical} 96.667%)`
    );
  });

  it("renders a single stop as a solid image", () => {
    expect(stopsToGradient([{ db: -70, color: critical }], -64, 0, "to right")).toBe(
      `linear-gradient(to right, ${critical}, ${critical})`
    );
  });
});

describe("levelMeterBackground", () => {
  it("uses the mode's own thresholds for Peak and RMS", () => {
    const controls = {
      levelMeterPeakWarningDb: -12,
      levelMeterPeakCriticalDb: -3,
      levelMeterRmsWarningDb: -20,
      levelMeterRmsCriticalDb: -10,
    };
    const view = { viewMin: -60, viewMax: 3 };
    expect(levelMeterBackground({ mode: "peak", controls, ...view })).toBe(
      stopsToGradient(thresholdStops(-60, -12, -3), -60, 3, "to top")
    );
    expect(levelMeterBackground({ mode: "rms", controls, ...view })).toBe(
      stopsToGradient(thresholdStops(-60, -20, -10), -60, 3, "to top")
    );
  });

  it("falls back to the default thresholds for missing controls", () => {
    expect(levelMeterBackground({ mode: "peak", controls: {}, viewMin: -60, viewMax: 3 })).toBe(
      stopsToGradient(thresholdStops(-60, -6, -1), -60, 3, "to top")
    );
  });

  it("shows the trace colour for unwatched loudness modes", () => {
    const view = { controls: {}, profileDocument: null, viewMin: -64, viewMax: 0 };
    expect(levelMeterBackground({ mode: "momentary", ...view })).toBe(
      "linear-gradient(to top, var(--ui-loudness-momentary), var(--ui-loudness-momentary))"
    );
    expect(levelMeterBackground({ mode: "shortTerm", ...view })).toBe(
      "linear-gradient(to top, var(--ui-loudness-shortterm), var(--ui-loudness-shortterm))"
    );
  });

  it("follows Profile ceilings for loudness modes", () => {
    const profileDocument = profile([
      { metricId: "momentaryMax", op: ">", value: -18, severity: "fail" },
    ]);
    expect(
      levelMeterBackground({
        mode: "momentary",
        controls: {},
        profileDocument,
        viewMin: -64,
        viewMax: 0,
      })
    ).toBe(stopsToGradient(profileStops(profileDocument, "momentary", -64), -64, 0, "to top"));
  });
});

describe("levelMeterMarkerStatus", () => {
  it("is undefined when nothing judges the metric", () => {
    expect(levelMeterMarkerStatus(null, "momentary", -10)).toBeUndefined();
    expect(levelMeterMarkerStatus(profile([]), "momentary", -10)).toBeUndefined();
  });

  it("keeps the metric's own rules, floors included", () => {
    const doc = profile([{ metricId: "momentary", op: "<", value: -40, severity: "warn" }]);
    expect(levelMeterMarkerStatus(doc, "momentary", -50)).toBe("warn");
    expect(levelMeterMarkerStatus(doc, "momentary", -30)).toBe("ok");
  });

  it("adds the Max metric's ceilings and reports the worse status", () => {
    const doc = profile([
      { metricId: "shortTerm", op: ">", value: -20, severity: "warn" },
      { metricId: "shortTermMax", op: ">", value: -16, severity: "fail" },
      { metricId: "shortTermMax", op: "<", value: -40, severity: "fail" },
    ]);
    expect(levelMeterMarkerStatus(doc, "shortTerm", -18)).toBe("warn");
    expect(levelMeterMarkerStatus(doc, "shortTerm", -15)).toBe("fail");
    expect(levelMeterMarkerStatus(doc, "shortTerm", -50)).toBe("ok");
  });

  it("judges a metric watched only through its Max", () => {
    const doc = profile([{ metricId: "momentaryMax", op: ">", value: -18, severity: "fail" }]);
    expect(levelMeterMarkerStatus(doc, "momentary", -20)).toBe("ok");
    expect(levelMeterMarkerStatus(doc, "momentary", -17)).toBe("fail");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/levelMeterColors.test.js`
Expected: FAIL, `Failed to resolve import "./levelMeterColors.js"`.

- [ ] **Step 3: Implement**

```js
/// Level Meter colours, anchored to levels rather than to the bar's height.
///
/// A stop is `{ db, color }`: the level where `color` becomes pure. The gradient between stops
/// blends; above the highest stop the colour stays pure. Pure safe sits at the absolute minimum of
/// the mode's scale -- the axis's zoom limit, not the visible minimum -- so the gradient is defined
/// over the whole scale and zooming only crops it: a level has one colour at every zoom.
///
/// Peak and RMS read the user's thresholds. Momentary and Short-term read only the Loudness
/// Profile: PLVS does not invent LUFS thresholds, and a bar nothing judges shows its Loudness
/// trace colour instead of a green that would itself be a verdict.

import { LOUDNESS_DB_MIN, PEAK_DB_MIN } from "../config/scales.js";
import { isRuleEmpty } from "./loudnessProfileCatalog.js";
import { loudnessProfileEvaluate } from "./loudnessProfileEvaluate.js";
import { DEFAULT_PANEL_CONTROLS } from "./panelControls.js";

export const LEVEL_METER_COLORS = Object.freeze({
  safe: "var(--ui-level-safe)",
  warning: "var(--ui-level-warning)",
  critical: "var(--ui-level-critical)",
});

const NEUTRAL_COLORS = Object.freeze({
  momentary: "var(--ui-loudness-momentary)",
  shortTerm: "var(--ui-loudness-shortterm)",
});

const THRESHOLD_KEYS = Object.freeze({
  peak: ["levelMeterPeakWarningDb", "levelMeterPeakCriticalDb"],
  rms: ["levelMeterRmsWarningDb", "levelMeterRmsCriticalDb"],
});

/// The Max metric whose ceilings also bound the live value: the moment the bar crosses a Max
/// ceiling, the Max breaches.
const MAX_METRIC = Object.freeze({ momentary: "momentaryMax", shortTerm: "shortTermMax" });

const SEVERITY_COLOR = Object.freeze({
  warn: LEVEL_METER_COLORS.warning,
  fail: LEVEL_METER_COLORS.critical,
});
const SEVERITY_RANK = Object.freeze({ warn: 1, fail: 2 });
const STATUS_RANK = Object.freeze({ ok: 1, pending: 1, warn: 2, fail: 3 });

export function thresholdStops(scaleMin, warningDb, criticalDb) {
  return [
    { db: scaleMin, color: LEVEL_METER_COLORS.safe },
    ...(warningDb < criticalDb ? [{ db: warningDb, color: LEVEL_METER_COLORS.warning }] : []),
    { db: criticalDb, color: LEVEL_METER_COLORS.critical },
  ];
}

/// Only ceilings colour the bar. Live loudness drops to silence between phrases, so a floor would
/// hold the bottom of the bar red, and pure safe between a floor and a ceiling would need an
/// invented midpoint. Floors stay judged in Stats.
export function profileStops(document, metricId, scaleMin) {
  const metricIds = new Set([metricId, MAX_METRIC[metricId]]);
  const ceilings = (document?.rules ?? [])
    .filter((rule) => !isRuleEmpty(rule) && rule.op === ">" && metricIds.has(rule.metricId))
    .sort((a, b) => a.value - b.value || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  if (ceilings.length === 0) return null;

  const kept = [];
  let rank = 0;
  for (const rule of ceilings) {
    if (SEVERITY_RANK[rule.severity] <= rank) continue;
    rank = SEVERITY_RANK[rule.severity];
    kept.push({ db: rule.value, color: SEVERITY_COLOR[rule.severity] });
  }
  return kept[0].db <= scaleMin
    ? kept
    : [{ db: scaleMin, color: LEVEL_METER_COLORS.safe }, ...kept];
}

/// Always a `background-image`, even for one colour, so a caller can size or clip it without
/// switching between `background-color` and `background-image`.
export function stopsToGradient(stops, viewMin, viewMax, direction) {
  if (stops.length === 1) {
    return `linear-gradient(${direction}, ${stops[0].color}, ${stops[0].color})`;
  }
  const percent = (db) => `${Number((((db - viewMin) / (viewMax - viewMin)) * 100).toFixed(3))}%`;
  return `linear-gradient(${direction}, ${stops
    .map(({ db, color }) => `${color} ${percent(db)}`)
    .join(", ")})`;
}

export function levelMeterBackground({
  mode,
  controls,
  profileDocument = null,
  viewMin,
  viewMax,
  direction = "to top",
}) {
  const keys = THRESHOLD_KEYS[mode];
  if (keys) {
    const [warningDb, criticalDb] = keys.map(
      (key) => controls?.[key] ?? DEFAULT_PANEL_CONTROLS[key]
    );
    return stopsToGradient(
      thresholdStops(PEAK_DB_MIN, warningDb, criticalDb),
      viewMin,
      viewMax,
      direction
    );
  }
  const stops = profileStops(profileDocument, mode, LOUDNESS_DB_MIN) ?? [
    { db: LOUDNESS_DB_MIN, color: NEUTRAL_COLORS[mode] },
  ];
  return stopsToGradient(stops, viewMin, viewMax, direction);
}

/// The Floating Value marker's status: the metric's own rules, as its Stats row judges them, and
/// the Max metric's ceilings, as the bar colour at the marker's position does. The worse wins;
/// `undefined` means nothing judges the metric.
export function levelMeterMarkerStatus(document, metricId, value) {
  if (!document) return undefined;
  const own = loudnessProfileEvaluate(document, { values: { [metricId]: value } })[metricId];
  const maxId = MAX_METRIC[metricId];
  const maxCeilings = {
    ...document,
    rules: (document.rules ?? []).filter((rule) => rule.metricId === maxId && rule.op === ">"),
  };
  const max = loudnessProfileEvaluate(maxCeilings, { values: { [maxId]: value } })[maxId];
  return (STATUS_RANK[max] ?? 0) > (STATUS_RANK[own] ?? 0) ? max : own;
}
```

Note: `DEFAULT_PANEL_CONTROLS` gains the threshold keys in Task 2. Until then the fallback test
("falls back to the default thresholds") fails with `undefined` thresholds; that is expected and it
turns green in Task 2 Step 4.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/levelMeterColors.test.js`
Expected: every test passes except `falls back to the default thresholds for missing controls`.

- [ ] **Step 5: Commit** (after Task 2, when the suite is green; see Task 2 Step 6)

---

### Task 2: Threshold controls in the control table

**Files:**

- Modify: `src/lib/panelControls.js` (imports; `CONTROLS`, before the `levelMeterYMinDb` range row)
- Test: `src/lib/panelControls.test.js`

- [ ] **Step 1: Write the failing tests** (append inside the file's top-level `describe`, or as a new
      `describe` at the end)

```js
describe("Level Meter thresholds", () => {
  it("defaults Peak to -6/-1 and RMS to -18/-9", () => {
    expect(DEFAULT_PANEL_CONTROLS).toMatchObject({
      levelMeterPeakWarningDb: -6,
      levelMeterPeakCriticalDb: -1,
      levelMeterRmsWarningDb: -18,
      levelMeterRmsCriticalDb: -9,
    });
  });

  it("keeps a valid pair, rounded, and allows equal values", () => {
    expect(
      normalizePanelControls({ levelMeterPeakWarningDb: -12.4, levelMeterPeakCriticalDb: -3 })
    ).toMatchObject({ levelMeterPeakWarningDb: -12, levelMeterPeakCriticalDb: -3 });
    expect(
      normalizePanelControls({ levelMeterRmsWarningDb: -10, levelMeterRmsCriticalDb: -10 })
    ).toMatchObject({ levelMeterRmsWarningDb: -10, levelMeterRmsCriticalDb: -10 });
  });

  it("clamps to the Peak scale", () => {
    expect(
      normalizePanelControls({ levelMeterPeakWarningDb: -90, levelMeterPeakCriticalDb: 9 })
    ).toMatchObject({ levelMeterPeakWarningDb: -60, levelMeterPeakCriticalDb: 3 });
  });

  it("falls back to the defaults when warning is above critical", () => {
    expect(
      normalizePanelControls({ levelMeterPeakWarningDb: -1, levelMeterPeakCriticalDb: -6 })
    ).toMatchObject({ levelMeterPeakWarningDb: -6, levelMeterPeakCriticalDb: -1 });
  });

  it("shows each pair in the Level Meter tab only for its own mode", () => {
    const row = (minKey) =>
      panelControlUiRows("levelMeter").find((candidate) => candidate.minKey === minKey);
    const peak = row("levelMeterPeakWarningDb");
    const rms = row("levelMeterRmsWarningDb");
    expect(peak.ui.showWhen({ levelMeterMode: "peak" })).toBe(true);
    expect(peak.ui.showWhen({ levelMeterMode: "rms" })).toBe(false);
    expect(rms.ui.showWhen({ levelMeterMode: "rms" })).toBe(true);
    expect(rms.ui.showWhen({ levelMeterMode: "momentary" })).toBe(false);
  });
});
```

Add `panelControlUiRows` to the file's import from `./panelControls.js` if it is not already imported.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/panelControls.test.js`
Expected: FAIL, defaults lack `levelMeterPeakWarningDb`.

- [ ] **Step 3: Implement**

In `src/lib/panelControls.js`, extend the scales import:

```js
import { PEAK_DB_MAX, PEAK_DB_MIN, SPECTROGRAM_DB_MIN } from "../config/scales.js";
```

Above `const KINDS = {`, add:

```js
/// Shared by the Peak and RMS rows and by the Dock's settings row.
export const LEVEL_METER_THRESHOLD_TOOLTIP =
  "Levels where the bar turns fully warning and fully critical colour; it blends below each.";

/// Warning and critical are repaired as a unit: each clamps to the scale and rounds, and a pair
/// out of order falls back to the defaults. Equal values are allowed and mean "no warning band".
function normalizeThresholdPair(row, raw) {
  const warning = Math.round(
    clampNumber(raw?.[row.minKey], row.absMin, row.absMax, row.defaultMin)
  );
  const critical = Math.round(
    clampNumber(raw?.[row.maxKey], row.absMin, row.absMax, row.defaultMax)
  );
  return warning <= critical
    ? { [row.minKey]: warning, [row.maxKey]: critical }
    : { [row.minKey]: row.defaultMin, [row.maxKey]: row.defaultMax };
}

function levelMeterThresholdRow(mode, minKey, maxKey, defaultMin, defaultMax) {
  return {
    minKey,
    maxKey,
    defaultMin,
    defaultMax,
    absMin: PEAK_DB_MIN,
    absMax: PEAK_DB_MAX,
    normalize: normalizeThresholdPair,
    ui: {
      tab: "levelMeter",
      label: "Warning / Critical",
      widget: "thresholds",
      ariaLabel: `level meter ${mode} thresholds`,
      order: 80,
      tooltip: LEVEL_METER_THRESHOLD_TOOLTIP,
      showWhen: (controls) => controls.levelMeterMode === mode,
    },
  };
}
```

In `CONTROLS`, directly before the `levelMeterYMinDb` `linearRange` row, add:

```js
  levelMeterThresholdRow("peak", "levelMeterPeakWarningDb", "levelMeterPeakCriticalDb", -6, -1),
  levelMeterThresholdRow("rms", "levelMeterRmsWarningDb", "levelMeterRmsCriticalDb", -18, -9),
```

`normalizeRow` already runs a row's own `normalize` before the range repair, `buildDefaults` already
writes `defaultMin`/`defaultMax` for a `minKey` row, and `axisKindForRangeRow` returns `null` for
these keys, so no other table code changes.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/panelControls.test.js src/lib/levelMeterColors.test.js`
Expected: PASS (including Task 1's fallback test).

- [ ] **Step 5: Run the dependent suites**

Run: `npx vitest run src/agentControl src/dock src/components/PanelSettingsContent.test.jsx`
Expected: `src/agentControl/panelControlCoverage.test.js` fails, naming the four new keys as neither
exposed nor internal; `DockModuleSettings.test.jsx` is unaffected until Task 6. Leave the coverage
failure for Task 8; nothing else should fail. If something else fails, stop and investigate.

- [ ] **Step 6: Commit**

```bash
git add src/lib/levelMeterColors.js src/lib/levelMeterColors.test.js src/lib/panelControls.js src/lib/panelControls.test.js
git commit -m "feat(level-meter): add dB-anchored colour stops and threshold controls" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

The pre-commit hook runs Prettier only, so the known coverage failure does not block this commit;
Task 8 closes it before anything merges.

---

### Task 3: Threshold settings widget

**Files:**

- Modify: `src/components/PanelSettingsContent.jsx` (new export after `SettingsNumberInput`; new
  branch in `renderPanelControlWidget`)
- Test: `src/components/PanelSettingsContent.test.jsx`

- [ ] **Step 1: Write the failing tests** (next to `renders Level Meter mode as a labeled settings
row and updates mode`)

```jsx
it("edits the Peak thresholds as one ordered pair", () => {
  const onPanelControlsChange = vi.fn();
  render(
    <PanelSettingsContent
      activeTab="levelMeter"
      panelControls={DEFAULT_PANEL_CONTROLS}
      onPanelControlsChange={onPanelControlsChange}
    />
  );

  expect(screen.getByText("Warning / Critical")).toBeTruthy();
  expect(screen.queryByLabelText("level meter rms thresholds warning")).toBeNull();
  const warning = screen.getByLabelText("level meter peak thresholds warning");
  expect(warning.value).toBe("-6");
  expect(screen.getByLabelText("level meter peak thresholds critical").value).toBe("-1");

  fireEvent.change(warning, { target: { value: "-12" } });
  fireEvent.keyDown(warning, { key: "Enter" });
  expect(onPanelControlsChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ levelMeterPeakWarningDb: -12, levelMeterPeakCriticalDb: -1 })
  );
});

it("refuses a warning threshold above critical", () => {
  const onPanelControlsChange = vi.fn();
  render(
    <PanelSettingsContent
      activeTab="levelMeter"
      panelControls={DEFAULT_PANEL_CONTROLS}
      onPanelControlsChange={onPanelControlsChange}
    />
  );

  const warning = screen.getByLabelText("level meter peak thresholds warning");
  fireEvent.change(warning, { target: { value: "0" } });
  fireEvent.keyDown(warning, { key: "Enter" });
  expect(onPanelControlsChange).not.toHaveBeenCalled();
  expect(warning.value).toBe("-6");
});

it("shows the RMS thresholds in RMS mode and none in loudness modes", () => {
  const { rerender } = render(
    <PanelSettingsContent
      activeTab="levelMeter"
      panelControls={{ ...DEFAULT_PANEL_CONTROLS, levelMeterMode: "rms" }}
      onPanelControlsChange={vi.fn()}
    />
  );
  expect(screen.getByLabelText("level meter rms thresholds warning").value).toBe("-18");

  rerender(
    <PanelSettingsContent
      activeTab="levelMeter"
      panelControls={{ ...DEFAULT_PANEL_CONTROLS, levelMeterMode: "momentary" }}
      onPanelControlsChange={vi.fn()}
    />
  );
  expect(screen.queryByText("Warning / Critical")).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/PanelSettingsContent.test.jsx -t "threshold"`
Expected: FAIL. The row renders through the generic range fallback, so the `warning` label is not
found.

- [ ] **Step 3: Implement**

After `SettingsNumberInput` in `src/components/PanelSettingsContent.jsx`:

```jsx
/// Warning and critical for one mode. Each bound is limited by the other, so an out-of-order entry
/// is refused and restored by SettingsNumberInput instead of being silently repaired.
export function SettingsThresholdInputs({ ariaLabel, warning, critical, min, max, onCommit }) {
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <SettingsNumberInput
        ariaLabel={`${ariaLabel} warning`}
        value={warning}
        min={min}
        max={critical}
        onCommit={(nextWarning) => onCommit(nextWarning, critical)}
      />
      <span className="text-muted-foreground/60">/</span>
      <SettingsNumberInput
        ariaLabel={`${ariaLabel} critical`}
        value={critical}
        min={warning}
        max={max}
        suffix="dB"
        onCommit={(nextCritical) => onCommit(warning, nextCritical)}
      />
    </div>
  );
}
```

In `renderPanelControlWidget`, before the `if (axisKindForRangeRow(tab, row.minKey))` branch:

```jsx
if (ui.widget === "thresholds") {
  return (
    <SettingsThresholdInputs
      ariaLabel={ui.ariaLabel}
      warning={controls[row.minKey]}
      critical={controls[row.maxKey]}
      min={row.absMin}
      max={row.absMax}
      onCommit={(warning, critical) => commit({ [row.minKey]: warning, [row.maxKey]: critical })}
    />
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components/PanelSettingsContent.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/PanelSettingsContent.jsx src/components/PanelSettingsContent.test.jsx
git commit -m "feat(level-meter): add Warning / Critical settings row" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Level Meter panel colours

**Files:**

- Modify: `src/components/panels/LevelMeterPanel.jsx`
- Test: `src/components/panels/LevelMeterPanel.test.jsx`

- [ ] **Step 1: Update the existing gradient test and add colour tests**

Replace the test `reveals a gradient fixed to the full bar instead of squashing it into the fill`
(added in `646be22d`) with:

```jsx
it("reveals a gradient fixed to the full bar instead of squashing it into the fill", () => {
  const { container } = renderPanel({ displayAudio: { peakDb: [-9.9, -9.9] } });

  const gradient = container.querySelector("[data-level-meter-gradient]");
  expect(gradient.style.transform).not.toMatch(/scale/);
  const topInsetPct = parseFloat(gradient.style.clipPath.match(/inset\(([-\d.]+)%/)[1]);
  expect(topInsetPct).toBeCloseTo(((3 - -9.9) / 63) * 100, 3);
});

it("anchors the Peak colours to the Peak thresholds in the visible range", () => {
  const { container } = renderPanel({
    panelControls: {
      levelMeterMode: "peak",
      levelMeterPeakWarningDb: -12,
      levelMeterPeakCriticalDb: -3,
      levelMeterYMinDb: -30,
      levelMeterYMaxDb: 0,
    },
  });

  const gradient = container.querySelector("[data-level-meter-gradient]");
  expect(gradient.dataset.levelMeterGradient).toBe(
    stopsToGradient(thresholdStops(-60, -12, -3), -30, 0, "to top")
  );
});

it("uses the RMS thresholds in RMS mode", () => {
  const { container } = renderPanel({ panelControls: { levelMeterMode: "rms" } });
  expect(container.querySelector("[data-level-meter-gradient]").dataset.levelMeterGradient).toBe(
    stopsToGradient(thresholdStops(-60, -18, -9), -60, 3, "to top")
  );
});

it("shows the Momentary trace colour when no Profile judges Momentary", () => {
  const { container } = renderPanel({ panelControls: { levelMeterMode: "momentary" } });
  expect(container.querySelector("[data-level-meter-gradient]").dataset.levelMeterGradient).toBe(
    "linear-gradient(to top, var(--ui-loudness-momentary), var(--ui-loudness-momentary))"
  );
});

it("follows a Momentary Max ceiling from the active Profile", () => {
  const profileWithCeiling = {
    ...TEST_PROFILE,
    rules: [{ metricId: "momentaryMax", op: ">", value: -18, severity: "fail" }],
  };
  settingsStore.patch({
    loudnessProfiles: {
      active: profileSelectionId(profileWithCeiling.id),
      profiles: [profileWithCeiling],
    },
  });
  const { container } = renderPanel({ panelControls: { levelMeterMode: "momentary" } });

  expect(container.querySelector("[data-level-meter-gradient]").dataset.levelMeterGradient).toBe(
    stopsToGradient(profileStops(profileWithCeiling, "momentary", -64), -64, 0, "to top")
  );
});

it("colours the Floating Value by a Momentary Max ceiling", () => {
  const profileWithCeiling = {
    ...TEST_PROFILE,
    rules: [{ metricId: "momentaryMax", op: ">", value: -18, severity: "fail" }],
  };
  settingsStore.patch({
    loudnessProfiles: {
      active: profileSelectionId(profileWithCeiling.id),
      profiles: [profileWithCeiling],
    },
  });
  const { container } = renderPanel({
    displayAudio: { peakDb: [-9, -9], momentary: -12 },
    panelControls: { levelMeterMode: "momentary", levelMeterValueMarker: true },
  });

  const marker = container.querySelector("[data-level-value-marker]");
  expect(marker.className).toContain("text-[color:var(--ui-level-critical)]");
});
```

Add to the imports:

```jsx
import { profileStops, stopsToGradient, thresholdStops } from "../../lib/levelMeterColors.js";
```

`TEST_PROFILE`, `settingsStore` and `profileSelectionId` are already imported or defined in this file.
`renderPanel` wraps in `LoudnessProfileProvider`, which reads the `settingsStore` patch.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/panels/LevelMeterPanel.test.jsx`
Expected: FAIL, `[data-level-meter-gradient]` not found.

- [ ] **Step 3: Implement**

In `src/components/panels/LevelMeterPanel.jsx`:

1. Imports: replace
   `import { loudnessProfileEvaluate } from "../../lib/loudnessProfileEvaluate.js";` with

   ```jsx
   import { loudnessProfileEvaluate } from "../../lib/loudnessProfileEvaluate.js";
   import { levelMeterBackground, levelMeterMarkerStatus } from "../../lib/levelMeterColors.js";
   ```

   (`loudnessProfileEvaluate` stays: the TP Max marker still uses it.)

2. `AnimatedLevelFill` takes a `background` prop and renders it:

   ```jsx
   function AnimatedLevelFill({ value, min, max, fromTopFrac, background }) {
   ```

   and its returned element becomes

   ```jsx
   <div className="absolute inset-0 overflow-hidden">
     {/* The gradient spans the whole bar and is clipped from the top, so each colour stays on
             its own level; scaling it would squeeze the full ramp into every fill. */}
     <motion.div
       data-level-meter-gradient={background}
       className="absolute inset-0"
       style={{ clipPath, backgroundImage: background }}
     />
   </div>
   ```

3. `AnimatedPeakFill` passes it through:

   ```jsx
   function AnimatedPeakFill({ dbValue, yRange, background }) {
     return (
       <AnimatedLevelFill
         value={dbValue}
         min={yRange.min}
         max={yRange.max}
         fromTopFrac={(v) => rangedFromTopFrac(v, yRange.min, yRange.max)}
         background={background}
       />
     );
   }
   ```

4. In `LevelMeterPanel`, after `levelMeterYRange` is computed:

   ```jsx
   const fillBackground = levelMeterBackground({
     mode: levelMeterMode,
     controls: normalizedPanelControls,
     profileDocument: loudnessProfileDocument,
     viewMin: levelMeterYRange.min,
     viewMax: levelMeterYRange.max,
   });
   ```

5. Loudness branch: replace

   ```jsx
   const markerStatus = loudnessProfileEvaluate(loudnessProfileDocument, {
     values: { [levelMeterMode]: readoutValue },
   })[levelMeterMode];
   ```

   with

   ```jsx
   const markerStatus = levelMeterMarkerStatus(
     loudnessProfileDocument,
     levelMeterMode,
     readoutValue
   );
   ```

   and update the comment above it to: `// The metric's own rules as its Stats row judges them, plus
// its Max ceilings as the bar colour at the marker does -- see levelMeterMarkerStatus.`

6. Pass `background={fillBackground}` to the loudness-branch `<AnimatedLevelFill … />` and to
   `<AnimatedPeakFill dbValue={c.valueDb} yRange={levelMeterYRange} />`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components/panels/LevelMeterPanel.test.jsx src/components/PanelSettingsContent.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/panels/LevelMeterPanel.jsx src/components/panels/LevelMeterPanel.test.jsx
git commit -m "feat(level-meter): colour bars by level thresholds and Profile ceilings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Dock level strip colours

**Files:**

- Modify: `src/dock/dockModuleControls.js:30`
- Modify: `src/dock/modules/DockLevel.jsx`
- Test: `src/dock/modules/DockLevel.test.jsx`, `src/dock/dockModuleControls.test.js`

- [ ] **Step 1: Write the failing tests**

In `src/dock/modules/DockLevel.test.jsx`, wrap `renderWith` in the Profile provider and add tests:

```jsx
import { LoudnessProfileProvider } from "../../hooks/LoudnessProfileContext.jsx";
import { settingsStore } from "../../persistence/index.js";
import { profileSelectionId } from "../../lib/loudnessProfileCatalog.js";
import { stopsToGradient, thresholdStops } from "../../lib/levelMeterColors.js";
```

```jsx
function renderWith(
  frameData,
  controls = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.level,
  heightMode = "standard"
) {
  return render(
    <LoudnessProfileProvider>
      <FrameDataProvider value={frameData}>
        <DockLevel controls={controls} heightMode={heightMode} />
      </FrameDataProvider>
    </LoudnessProfileProvider>
  );
}
```

Add `afterEach(() => settingsStore.reset());` (import `afterEach` from `vitest`) and:

```jsx
it("anchors the Peak colours to the Dock's own thresholds over the whole track", () => {
  renderWith(
    { displayAudio: { peakDb: [-12, -30] } },
    {
      ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.level,
      levelMeterPeakWarningDb: -10,
      levelMeterPeakCriticalDb: -2,
    }
  );
  const fill = screen.getAllByTestId("dock-level-bar")[0].firstChild;
  expect(fill.dataset.levelMeterGradient).toBe(
    stopsToGradient(thresholdStops(-60, -10, -2), -60, 3, "to right")
  );
});

it("no longer floods the whole bar critical at clip", () => {
  renderWith({ displayAudio: { peakDb: [0, 0] } });
  const fill = screen.getAllByTestId("dock-level-bar")[0].firstChild;
  expect(fill.dataset.levelMeterGradient).toBe(
    stopsToGradient(thresholdStops(-60, -6, -1), -60, 3, "to right")
  );
});

it("shows the Short-term trace colour when no Profile judges Short-term", () => {
  renderWith(
    { displayAudio: { shortTerm: -20 } },
    { ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.level, levelMeterMode: "shortTerm" }
  );
  expect(screen.getByTestId("dock-level-bar").firstChild.dataset.levelMeterGradient).toBe(
    "linear-gradient(to right, var(--ui-loudness-shortterm), var(--ui-loudness-shortterm))"
  );
});

it("follows a Short-term Max ceiling from the active Profile", () => {
  const profile = {
    id: "dock-profile",
    name: "Dock profile",
    referenceLufs: null,
    rules: [{ metricId: "shortTermMax", op: ">", value: -18, severity: "fail" }],
  };
  settingsStore.patch({
    loudnessProfiles: { active: profileSelectionId(profile.id), profiles: [profile] },
  });
  renderWith(
    { displayAudio: { shortTerm: -20 } },
    { ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.level, levelMeterMode: "shortTerm" }
  );
  expect(screen.getByTestId("dock-level-bar").firstChild.dataset.levelMeterGradient).toBe(
    `linear-gradient(to right, var(--ui-level-safe) 0%, var(--ui-level-critical) 71.875%)`
  );
});
```

(`(-18 - -64) / 64 = 71.875 %`.)

In `src/dock/dockModuleControls.test.js`, add:

```js
it("carries the Level Meter thresholds on the Dock level module", () => {
  expect(DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.level).toMatchObject({
    levelMeterPeakWarningDb: -6,
    levelMeterPeakCriticalDb: -1,
    levelMeterRmsWarningDb: -18,
    levelMeterRmsCriticalDb: -9,
  });
  expect(
    normalizeDockModuleControls("level", {
      levelMeterPeakWarningDb: -1,
      levelMeterPeakCriticalDb: -6,
    })
  ).toMatchObject({ levelMeterPeakWarningDb: -6, levelMeterPeakCriticalDb: -1 });
});
```

(import `normalizeDockModuleControls` / `DEFAULT_DOCK_CONTROLS_BY_MODULE_ID` if the file does not
already.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/dock/modules/DockLevel.test.jsx src/dock/dockModuleControls.test.js`
Expected: FAIL (missing keys, missing `data-level-meter-gradient`).

- [ ] **Step 3: Implement**

`src/dock/dockModuleControls.js`:

```js
  level: [
    "levelMeterMode",
    "levelMeterPeakWarningDb",
    "levelMeterPeakCriticalDb",
    "levelMeterRmsWarningDb",
    "levelMeterRmsCriticalDb",
  ],
```

`src/dock/modules/DockLevel.jsx`:

- Remove `const CLIP_DB = -0.1;`.
- Add imports:

  ```jsx
  import { useLoudnessProfile } from "../../hooks/LoudnessProfileContext.jsx";
  import { levelMeterBackground } from "../../lib/levelMeterColors.js";
  ```

- Replace `MeterFill` with:

  ```jsx
  function MeterFill({ value, min, max, background, style }) {
    const width = widthPct(value, min, max);
    return (
      <div
        data-testid="dock-level-bar"
        className="h-full min-h-[var(--ui-dock-bar-min-h)] w-full overflow-hidden rounded-xs bg-muted/40"
        style={style}
      >
        <div
          data-level-meter-gradient={background}
          className="h-full rounded-xs"
          style={{
            width: `${width}%`,
            backgroundImage: background,
            // Sized to the whole track, so each colour stays on its own level instead of the
            // ramp stretching over however much of the track the fill covers.
            backgroundSize: width > 0 ? `${10000 / width}% 100%` : undefined,
          }}
        />
      </div>
    );
  }
  ```

- In `DockLevel`, after `const meta = MODE_META[mode];`:

  ```jsx
  const { document: loudnessProfileDocument } = useLoudnessProfile();
  const fillBackground = levelMeterBackground({
    mode,
    controls,
    profileDocument: loudnessProfileDocument,
    viewMin: meta.min,
    viewMax: meta.max,
    direction: "to right",
  });
  ```

- Every `<MeterFill … peakFamily={…} />` call: remove the `peakFamily` prop and add
  `background={fillBackground}`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/dock src/components/AppShell.test.jsx`
Expected: PASS. If `DockStrip.test.jsx`, `DockStereoMap.test.jsx` or `AppShell.test.jsx` fail with
`useLoudnessProfile must be used inside LoudnessProfileProvider`, wrap that file's render root in
`<LoudnessProfileProvider>…</LoudnessProfileProvider>` exactly as `renderWith` above, and re-run.
`DockModuleSettings.test.jsx`'s `emits a complete updated controls object` fails here because the
level defaults gained keys; Task 6 Step 1 updates it.

- [ ] **Step 5: Commit**

```bash
git add src/dock
git commit -m "feat(dock): colour the level strip by level thresholds and Profile ceilings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Add `src/components/AppShell.test.jsx` to the `git add` if Step 4 required wrapping it.)

---

### Task 6: Dock threshold settings

**Files:**

- Modify: `src/dock/editors/DockModuleSettings.jsx` (level branch of `SettingsBody`)
- Test: `src/dock/editors/DockModuleSettings.test.jsx`

- [ ] **Step 1: Write the failing test and update the defaults test**

Replace the expectation in `emits a complete updated controls object` with:

```jsx
expect(onChange).toHaveBeenCalledWith({
  ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.level,
  levelMeterMode: "rms",
  readout: "live",
});
```

Add:

```jsx
it("edits the thresholds of the current level mode", () => {
  const onChange = renderSettings("level");
  const critical = screen.getByLabelText("level meter peak thresholds critical");
  expect(critical.value).toBe("-1");
  fireEvent.change(critical, { target: { value: "0" } });
  fireEvent.keyDown(critical, { key: "Enter" });
  expect(onChange).toHaveBeenCalledWith({
    ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.level,
    levelMeterPeakCriticalDb: 0,
  });
});

it("has no thresholds in loudness modes", () => {
  renderSettings("level", {
    controls: { ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.level, levelMeterMode: "momentary" },
  });
  expect(screen.queryByText("Warning / Critical")).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/dock/editors/DockModuleSettings.test.jsx`
Expected: FAIL, label `level meter peak thresholds critical` not found.

- [ ] **Step 3: Implement**

Add `SettingsThresholdInputs` to the `PanelSettingsContent.jsx` import list, and extend the
`panelControls.js` import with `LEVEL_METER_THRESHOLD_TOOLTIP` and `normalizePanelControlRange`.
Also import the scale bounds:

```jsx
import { PEAK_DB_MAX, PEAK_DB_MIN } from "../../config/scales.js";
```

In the `level` branch, after `const isPeak = …`:

```jsx
const thresholdKeys = {
  peak: ["levelMeterPeakWarningDb", "levelMeterPeakCriticalDb"],
  rms: ["levelMeterRmsWarningDb", "levelMeterRmsCriticalDb"],
}[controls.levelMeterMode];
```

and after the `Readout` row:

```jsx
{
  thresholdKeys ? (
    <SettingsRow label="Warning / Critical" tooltip={LEVEL_METER_THRESHOLD_TOOLTIP}>
      <SettingsThresholdInputs
        ariaLabel={`level meter ${controls.levelMeterMode} thresholds`}
        warning={controls[thresholdKeys[0]]}
        critical={controls[thresholdKeys[1]]}
        min={PEAK_DB_MIN}
        max={PEAK_DB_MAX}
        onCommit={(warning, critical) =>
          onChange({
            ...controls,
            ...normalizePanelControlRange(thresholdKeys[0], warning, critical),
          })
        }
      />
    </SettingsRow>
  ) : null;
}
```

`normalizePanelControlRange` is the table's own repair for a pair row, so the Dock cannot store a pair
the panel would reject.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/dock`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dock/editors/DockModuleSettings.jsx src/dock/editors/DockModuleSettings.test.jsx
git commit -m "feat(dock): add Warning / Critical to Dock level settings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Remove the theme stop position

**Files:**

- Modify: `src/index.css:137-144`
- Modify: `src/preferences/data.js:135-139`
- Modify: `src/preferences/applyDocumentTheme.js:99-100`
- Modify: `docs/design-tokens.md:197`

- [ ] **Step 1: Confirm nothing else reads it**

Run: `git grep -n "meterGradient\|meter-gradient-mid-stop\|midStopPercent" -- . ':!docs/history'`
Expected: exactly the four locations above.

- [ ] **Step 2: Edit**

`src/index.css` — `.meter-gradient` now only paints the Theme Preview swatch, so it takes a fixed
representative stop:

```css
/* Theme Preview swatch only. The Level Meter computes its gradient from levels
   (src/lib/levelMeterColors.js); this just shows the three colours together. */
.meter-gradient {
  background: linear-gradient(
    180deg,
    var(--ui-meter-gradient-top) 0%,
    var(--ui-meter-gradient-mid) 46%,
    var(--ui-meter-gradient-bottom) 100%
  );
}
```

`src/preferences/data.js` — delete the whole `peak: { meterGradient: { midStopPercent: 46 } },`
entry under `modules`.

`src/preferences/applyDocumentTheme.js` — delete:

```js
const peak = prefs.modules.peak.meterGradient;
setCssVar("--ui-meter-gradient-mid-stop", `${peak.midStopPercent}%`);
```

`docs/design-tokens.md` — delete the `--ui-meter-gradient-mid-stop` table row.

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/preferences src/theme src/components/theme-editor`
Expected: PASS. If a test asserts `modules.peak`, delete that assertion only.

- [ ] **Step 4: Commit**

```bash
git add src/index.css src/preferences docs/design-tokens.md
git commit -m "refactor(theme): drop the level meter gradient stop position" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Agent Control

Public fields, identical in Panel Control and Dock Control:

- `peakThresholdsDbfs: { warning, critical }`, effective in Peak mode, else `inactiveReason: "nonPeakMode"`
- `rmsThresholdsDbfs: { warning, critical }`, effective in RMS mode, else `inactiveReason: "nonRmsMode"`

Integers in −60..3, `warning <= critical`.

**Files:**

- Modify: `src/agentControl/panelControls.js`, `panelControlSchema.js`, `panelControlPatch.js`, `dockControl.js`
- Test: `src/agentControl/panelControls.test.js`, `panelControlPatch.test.js`, `panelControlSchema.test.js`, `dockControl.test.js`
- Regenerate: `docs/agent-control/generated/`

- [ ] **Step 1: Write the failing tests**

`src/agentControl/panelControls.test.js` — in the existing `returns the complete Level Meter control
document` case, add `levelMeterPeakWarningDb: -12, levelMeterRmsCriticalDb: -6` to the input and
these to the expected object:

```js
      peakThresholdsDbfs: { warning: -12, critical: -1 },
      rmsThresholdsDbfs: { warning: -18, critical: -6 },
```

`src/agentControl/panelControlPatch.test.js`:

```js
it("patches Level Meter thresholds as ordered pairs", () => {
  const result = planPublicPanelControlPatch("levelMeter", DEFAULT_PANEL_CONTROLS, {
    peakThresholdsDbfs: { warning: -12, critical: -3 },
  });
  expect(result).toMatchObject({
    issues: [],
    changed: ["controls.peakThresholdsDbfs.warning", "controls.peakThresholdsDbfs.critical"],
    warnings: [],
  });
  expect(result.panelControls).toMatchObject({
    levelMeterPeakWarningDb: -12,
    levelMeterPeakCriticalDb: -3,
  });
});

it("rejects out-of-order or non-integer thresholds", () => {
  const result = planPublicPanelControlPatch("levelMeter", DEFAULT_PANEL_CONTROLS, {
    peakThresholdsDbfs: { warning: -1, critical: -6 },
    rmsThresholdsDbfs: { warning: -18.5, critical: -9 },
  });
  expect(result.issues).toEqual([
    expect.objectContaining({ code: "outOfRange", path: "$.peakThresholdsDbfs" }),
    expect.objectContaining({ code: "invalidType", path: "$.rmsThresholdsDbfs" }),
  ]);
  expect(result.changed).toEqual([]);
});

it("warns when thresholds for another mode are patched", () => {
  const result = planPublicPanelControlPatch("levelMeter", DEFAULT_PANEL_CONTROLS, {
    rmsThresholdsDbfs: { warning: -20, critical: -10 },
  });
  expect(result.warnings).toEqual([
    {
      code: "currentlyInactive",
      path: "controls.rmsThresholdsDbfs",
      inactiveReason: "nonRmsMode",
    },
  ]);
});
```

`src/agentControl/panelControlSchema.test.js`:

```js
it("describes the Level Meter thresholds and marks the other mode's pair inactive", () => {
  const schema = buildPublicPanelControlSchema("levelMeter", DEFAULT_PANEL_CONTROLS);
  expect(schema.properties.peakThresholdsDbfs).toMatchObject({
    effective: true,
    default: { warning: -6, critical: -1 },
    constraints: [{ kind: "ordered", lower: "warning", upper: "critical" }],
  });
  expect(schema.properties.rmsThresholdsDbfs).toMatchObject({
    effective: false,
    inactiveReason: "nonRmsMode",
    default: { warning: -18, critical: -9 },
  });
});
```

(Use the file's existing import of `buildPublicPanelControlSchema` / `DEFAULT_PANEL_CONTROLS`; add
them if absent.)

`src/agentControl/dockControl.test.js` — two existing expectations read a Dock level panel's
public controls as `{ mode, readout, showLabels }`: in `serializes the form and ordered public
panels` (`controls: { mode: "peak", readout: "truePeakMax", showLabels: false }`) and at the end of
`strictly plans Dock-only panel controls` (`{ mode: "rms", readout: "playbackMax", showLabels: true
}`). Add to both expected objects:

```js
          peakThresholdsDbfs: { warning: -6, critical: -1 },
          rmsThresholdsDbfs: { warning: -18, critical: -9 },
```

and add a case:

```js
it("plans Dock level thresholds through the panel's own rules", () => {
  const planned = planDockPanelPatch(
    dock,
    "level",
    { peakThresholdsDbfs: { warning: -10, critical: -2 } },
    {}
  );
  expect(planned.issues).toEqual([]);
  expect(buildDockSnapshot(planned.dock).panels[1].controls.peakThresholdsDbfs).toEqual({
    warning: -10,
    critical: -2,
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/agentControl`
Expected: the new cases fail, and `panelControlCoverage.test.js` still reports the four keys.

- [ ] **Step 3: Implement**

`src/agentControl/panelControls.js`, Level Meter branch, add after `tpMaxMarker`:

```js
      peakThresholdsDbfs: {
        warning: controls.levelMeterPeakWarningDb,
        critical: controls.levelMeterPeakCriticalDb,
      },
      rmsThresholdsDbfs: {
        warning: controls.levelMeterRmsWarningDb,
        critical: controls.levelMeterRmsCriticalDb,
      },
```

`src/agentControl/panelControlSchema.js` — add below `range(...)`:

```js
function thresholds(title, defaultValue) {
  const bound = (name, description) =>
    field("integer", name, description, { minimum: -60, maximum: 3 });
  return field("object", title, `Levels where the bar turns fully warning and fully critical.`, {
    unit: "dBFS",
    default: defaultValue,
    patchMode: "replace",
    required: ["warning", "critical"],
    properties: {
      warning: bound("Warning", "Level of pure warning colour."),
      critical: bound("Critical", "Level of pure critical colour."),
    },
    constraints: [{ kind: "ordered", lower: "warning", upper: "critical" }],
  });
}
```

and in the Level Meter `root({...})`, after `tpMaxMarker`:

```js
      peakThresholdsDbfs: active(
        thresholds("Peak Thresholds", defaults.peakThresholdsDbfs),
        controls.levelMeterMode === "peak",
        "nonPeakMode"
      ),
      rmsThresholdsDbfs: active(
        thresholds("RMS Thresholds", defaults.rmsThresholdsDbfs),
        controls.levelMeterMode === "rms",
        "nonRmsMode"
      ),
```

`src/agentControl/panelControlPatch.js`:

- Add `"peakThresholdsDbfs", "rmsThresholdsDbfs"` to `LEVEL_METER_FIELDS`.
- Below `validateRange`:

  ```js
  function validateThresholds(value, path, issues) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      issues.push(issue("invalidType", path, `${path} must be a thresholds object.`));
      return;
    }
    for (const key of Object.keys(value)) {
      if (key !== "warning" && key !== "critical") {
        issues.push(issue("unknownControl", `${path}.${key}`, `Unknown thresholds field: ${key}.`));
      }
    }
    if (!Number.isInteger(value.warning) || !Number.isInteger(value.critical)) {
      issues.push(
        issue("invalidType", path, `${path} must contain integer warning and critical values.`)
      );
      return;
    }
    if (value.warning < -60 || value.critical > 3 || value.warning > value.critical) {
      issues.push(
        issue("outOfRange", path, `${path} must satisfy -60 <= warning <= critical <= 3.`)
      );
    }
  }

  const LEVEL_METER_THRESHOLD_FIELDS = [
    ["peakThresholdsDbfs", "levelMeterPeakWarningDb", "levelMeterPeakCriticalDb"],
    ["rmsThresholdsDbfs", "levelMeterRmsWarningDb", "levelMeterRmsCriticalDb"],
  ];
  ```

- In the Level Meter branch, with the other validations:

  ```js
  for (const [publicKey] of LEVEL_METER_THRESHOLD_FIELDS) {
    if (hasOwn(patch, publicKey)) validateThresholds(patch[publicKey], `$.${publicKey}`, issues);
  }
  ```

- After the boolean mapping loop:

  ```js
  for (const [publicKey, warningKey, criticalKey] of LEVEL_METER_THRESHOLD_FIELDS) {
    if (!hasOwn(patch, publicKey)) continue;
    if (patch[publicKey].warning !== current[warningKey]) {
      panelControls[warningKey] = patch[publicKey].warning;
      changed.push(`controls.${publicKey}.warning`);
    }
    if (patch[publicKey].critical !== current[criticalKey]) {
      panelControls[criticalKey] = patch[publicKey].critical;
      changed.push(`controls.${publicKey}.critical`);
    }
  }
  ```

- With the other `warn(...)` calls:

  ```js
  if (finalMode !== "peak") warn("peakThresholdsDbfs", "nonPeakMode");
  if (finalMode !== "rms") warn("rmsThresholdsDbfs", "nonRmsMode");
  ```

- `planPublicPanelReset` needs no change: it builds its patch from
  `readPublicPanelControls(moduleId, DEFAULT_PANEL_CONTROLS)`, which now includes both pairs.

`src/agentControl/dockControl.js`:

- `PUBLIC_DOCK_CONTROLS.levelMeter`:
  `new Set(["mode", "readout", "showLabels", "peakThresholdsDbfs", "rmsThresholdsDbfs"])`
- In `publicControls`, Level Meter branch:

  ```js
  return {
    mode: all.mode,
    readout: normalized.readout,
    showLabels: normalized.showLabels,
    peakThresholdsDbfs: all.peakThresholdsDbfs,
    rmsThresholdsDbfs: all.rmsThresholdsDbfs,
  };
  ```

- [ ] **Step 4: Run tests and regenerate the reference**

Run: `npx vitest run src/agentControl`
Expected: all pass except `publicSurfaceDocs.test.js` (snapshot mismatch).

Run: `npm run docs:agent-control`
Then: `npx vitest run src/agentControl`
Expected: PASS.

`docs/user/cli.md` lists no individual panel controls (it defers to `generated/`), so it needs no
edit.

- [ ] **Step 5: Commit**

```bash
git add src/agentControl docs/agent-control/generated
git commit -m "feat(cli): expose Level Meter colour thresholds" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: User guide

**Files:**

- Modify: `docs/user/panels.md` (`## Level Meter`)
- Modify: `docs/user/loudness-profiles.md`

- [ ] **Step 1: Edit `docs/user/panels.md`**

Replace the Level Meter paragraph with:

```markdown
## Level Meter

Shows every channel individually, as **Peak**, **RMS**, **Momentary**, or **Short-term**. It can show
a True Peak Max marker driven by the active [Loudness Profile](loudness-profiles.md); click the
readout to reset the maximum.

The bar colours belong to levels, not to the bar's height, so zooming the scale never changes the
colour of a level. In Peak and RMS, **Warning / Critical** sets where the bar turns fully warning and
fully critical colour, blending below each (defaults: Peak −6 / −1 dBFS, RMS −18 / −9 dBFS). In
Momentary and Short-term the colours come from the active Loudness Profile's upper limits on that
metric or its Max; with no such rule the bar shows the metric's Loudness curve colour, because
nothing is judging it.
```

- [ ] **Step 2: Edit `docs/user/loudness-profiles.md`**

In `## Where profiles apply`, replace the bullet `- The True Peak Max marker on the Level Meter`
with:

```markdown
- The True Peak Max marker on the Level Meter
- The Level Meter's Momentary and Short-term bar colours and Floating Value
```

and add this paragraph directly after the list:

```markdown
The Level Meter colours its Momentary and Short-term bars from rules on that metric and on its Max
(Momentary Max, Short-term Max) that set an upper limit ("above"). A lower limit ("below") is not
drawn on the bar — live loudness falls between phrases, so the bar would sit red — but Stats still
judges it.
```

- [ ] **Step 3: Check the documentation guards and preview**

Run: `npx vitest run scripts/documentationStructure.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/user/panels.md docs/user/loudness-profiles.md
git commit -m "docs(level-meter): document colour thresholds" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Verification

- [ ] **Step 1: Merge gate**

Run: `npm run check`
Expected: exit 0.

- [ ] **Step 2: Manual check in the real app** (hand to the user; do not start a preview
      unprompted)

With `npm run desktop`:

1. Peak mode, default range: a quiet signal is green; approaching −6 turns yellow, −1 red.
2. Zoom the Y axis (drag / wheel on the axis): a given level keeps its colour.
3. Change Warning / Critical in Panel Settings; entering Warning above Critical is refused.
4. RMS mode uses its own pair.
5. Momentary with no Profile: solid Momentary curve colour. Select a Profile with a Momentary Max
   `>` rule: the bar blends to red at that level; the Floating Value turns critical above it.
6. Dock level strip mirrors 1–5 with its own thresholds, and no longer floods red at clip.
7. Restart the app (not a Vite reload) and confirm thresholds persisted for both the panel and the
   Dock.

```

```
