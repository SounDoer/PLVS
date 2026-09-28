# Level Meter Bar Colors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Bar Colors** control to the Level Meter (panel and Dock): **Gradient** (default,
a fixed ramp over the visible bar, appearance only) or **Level Zones** (hard-cut zones from
Warning / Critical for Peak/RMS and from Loudness Profile ceilings for Momentary/Short-term).

**Architecture:** `src/lib/levelMeterColors.js` stays the single place that turns a mode, the
controls and the Profile into a CSS `background-image`. It learns the two options: Gradient returns
a fixed ramp; Level Zones returns hard-cut zones instead of the blended level stops it returns
today. The option is one new enum row, `levelMeterBarColors`, in the panel control table, so
persistence, presets, the Dock and Agent Control inherit it like every other control. The panel and
the Dock components already pass their controls to `levelMeterBackground`, so neither component
changes.

**Tech Stack:** React 19, Vitest (jsdom), plain CSS custom properties.

**Spec:** `docs/history/specs/2026-09-28-level-meter-bar-colors-design.md` (supersedes the visual
model of `2026-09-26-level-meter-color-thresholds-design.md`).

**Conventions for every task**

- Tests run with `npx vitest run <file>`; React test files already carry
  `/** @vitest-environment jsdom */`.
- Commit with Conventional Commits and scope, ending with
  `-m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`. Never `--no-verify`; never start a
  subject with `@`.
- Work lands on `main`.
- When a pre-existing test fails **only** because a literal of controls or public controls now lacks
  `levelMeterBarColors` / `barColors`, add the key with its default and say so in the report. Any
  other unexpected failure: stop and report.

---

## File map

| File                                                                                                             | Change                                           |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `src/lib/panelControls.js`                                                                                       | `levelMeterBarColors` row; thresholds `showWhen` |
| `src/lib/panelControls.test.js`                                                                                  | Row tests                                        |
| `src/components/PanelSettingsContent.test.jsx`                                                                   | Threshold tests set Level Zones; Bar Colors row  |
| `src/lib/levelMeterColors.js`                                                                                    | Gradient + hard-cut zones                        |
| `src/lib/levelMeterColors.test.js`                                                                               | Rewritten                                        |
| `src/components/panels/LevelMeterPanel.test.jsx`                                                                 | Colour tests updated and added                   |
| `src/dock/modules/DockLevel.test.jsx`                                                                            | Colour tests updated and added                   |
| `src/dock/dockModuleControls.js`                                                                                 | Carry `levelMeterBarColors`                      |
| `src/dock/editors/DockModuleSettings.jsx` (+ test)                                                               | Bar Colors row                                   |
| `src/index.css`                                                                                                  | Swatch stop 46 % → 40 %                          |
| `src/agentControl/panelControls.js`, `panelControlSchema.js`, `panelControlPatch.js`, `dockControl.js` (+ tests) | `barColors`; threshold activity                  |
| `docs/agent-control/generated/`                                                                                  | Regenerated                                      |
| `docs/user/panels.md`, `docs/user/loudness-profiles.md`                                                          | User guide                                       |

---

### Task 1: The `levelMeterBarColors` control

**Files:**

- Modify: `src/lib/panelControls.js` (options export near `LEVEL_METER_MODE_OPTIONS`; tooltip
  constant and `levelMeterThresholdRow` near line 101-140; `CONTROLS` after the
  `levelMeterTpMaxMarker` row)
- Test: `src/lib/panelControls.test.js`, `src/components/PanelSettingsContent.test.jsx`

- [ ] **Step 1: Write the failing tests**

In `src/lib/panelControls.test.js`, replace the existing test
`shows each pair in the Level Meter tab only for its own mode` (in the "Level Meter thresholds"
describe) with:

```js
it("shows each pair only under Level Zones and for its own mode", () => {
  const row = (minKey) =>
    panelControlUiRows("levelMeter").find((candidate) => candidate.minKey === minKey);
  const peak = row("levelMeterPeakWarningDb");
  const rms = row("levelMeterRmsWarningDb");
  const zones = { levelMeterBarColors: "levelZones" };
  expect(peak.ui.showWhen({ ...zones, levelMeterMode: "peak" })).toBe(true);
  expect(peak.ui.showWhen({ ...zones, levelMeterMode: "rms" })).toBe(false);
  expect(peak.ui.showWhen({ levelMeterBarColors: "gradient", levelMeterMode: "peak" })).toBe(false);
  expect(rms.ui.showWhen({ ...zones, levelMeterMode: "rms" })).toBe(true);
  expect(rms.ui.showWhen({ ...zones, levelMeterMode: "momentary" })).toBe(false);
});
```

and add a new describe at the end of the file:

```js
describe("Level Meter bar colors", () => {
  it("defaults to Gradient and repairs unknown values", () => {
    expect(DEFAULT_PANEL_CONTROLS.levelMeterBarColors).toBe("gradient");
    expect(normalizePanelControls({ levelMeterBarColors: "levelZones" }).levelMeterBarColors).toBe(
      "levelZones"
    );
    expect(normalizePanelControls({ levelMeterBarColors: "rainbow" }).levelMeterBarColors).toBe(
      "gradient"
    );
  });

  it("is a Bar Colors select in the Level Meter tab, before the thresholds", () => {
    const rows = panelControlUiRows("levelMeter");
    const barColors = rows.find((row) => row.key === "levelMeterBarColors");
    expect(barColors.ui).toMatchObject({
      label: "Bar Colors",
      widget: "select",
      options: [
        { id: "gradient", label: "Gradient" },
        { id: "levelZones", label: "Level Zones" },
      ],
    });
    expect(rows.indexOf(barColors)).toBeLessThan(
      rows.findIndex((row) => row.minKey === "levelMeterPeakWarningDb")
    );
  });
});
```

Two pre-existing tests in this file compare whole default / normalised records with `toEqual`
("uses the agreed defaults" and "normalizes invalid input without preserving unknown ids"); add
`levelMeterBarColors: "gradient"` to both expected literals, directly after
`levelMeterTpMaxMarker`.

In `src/components/PanelSettingsContent.test.jsx`, the five threshold tests render with
`DEFAULT_PANEL_CONTROLS` (now Gradient, so the row is hidden). In each of them —
`edits the Peak thresholds as one ordered pair`, `refuses a warning threshold above critical`,
`refuses a critical threshold below warning`, `accepts equal warning and critical`,
`shows the RMS thresholds in RMS mode and none in loudness modes` — change every
`panelControls={DEFAULT_PANEL_CONTROLS}` to
`panelControls={{ ...DEFAULT_PANEL_CONTROLS, levelMeterBarColors: "levelZones" }}` and every
`panelControls={{ ...DEFAULT_PANEL_CONTROLS, levelMeterMode: … }}` to also include
`levelMeterBarColors: "levelZones"`. Then add:

```jsx
it("hides Warning / Critical under Gradient and switches Bar Colors", () => {
  const onPanelControlsChange = vi.fn();
  render(
    <PanelSettingsContent
      activeTab="levelMeter"
      panelControls={DEFAULT_PANEL_CONTROLS}
      onPanelControlsChange={onPanelControlsChange}
    />
  );

  expect(screen.queryByText("Warning / Critical")).toBeNull();
  fireEvent.click(screen.getByLabelText("level meter bar colors"));
  fireEvent.click(screen.getByRole("option", { name: "Level Zones" }));
  expect(onPanelControlsChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ levelMeterBarColors: "levelZones" })
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/panelControls.test.js src/components/PanelSettingsContent.test.jsx`
Expected: FAIL (`levelMeterBarColors` undefined; label `level meter bar colors` not found).

- [ ] **Step 3: Implement**

In `src/lib/panelControls.js`, after `LEVEL_METER_MODE_OPTIONS`:

```js
export const LEVEL_METER_BAR_COLOR_OPTIONS = [
  { id: "gradient", label: "Gradient" },
  { id: "levelZones", label: "Level Zones" },
];
```

Replace the threshold tooltip (the blend it describes no longer exists):

```js
/// Shared by the Peak and RMS rows. The Dock's settings row reads it from the row's ui.tooltip.
const LEVEL_METER_THRESHOLD_TOOLTIP = "Levels where the bar turns warning and critical color.";
```

In `levelMeterThresholdRow`, replace the `showWhen` line with:

```js
      showWhen: (controls) =>
        controls.levelMeterBarColors === "levelZones" && controls.levelMeterMode === mode,
```

In `CONTROLS`, directly after the `levelMeterTpMaxMarker` row, add:

```js
  {
    key: "levelMeterBarColors",
    kind: "enum",
    options: ids(LEVEL_METER_BAR_COLOR_OPTIONS),
    default: "gradient",
    ui: {
      tab: "levelMeter",
      label: "Bar Colors",
      widget: "select",
      ariaLabel: "level meter bar colors",
      order: 75,
      options: LEVEL_METER_BAR_COLOR_OPTIONS,
      tooltip:
        "Gradient is appearance only. Level Zones color the bar by level: Warning / Critical for " +
        "Peak and RMS, the Loudness Profile's rules for Momentary and Short-term.",
    },
  },
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/panelControls.test.js src/components/PanelSettingsContent.test.jsx`
Expected: PASS.

Run: `npx vitest run`
Expected: `src/agentControl/panelControlCoverage.test.js` fails naming `levelMeterBarColors`
(Task 5 exposes it), and `src/dock/editors/DockModuleSettings.test.jsx` threshold tests fail because
the Dock threshold row is now hidden under the default Gradient (Task 3 fixes them). Nothing else
may fail except literals covered by the conventions note.

- [ ] **Step 5: Commit**

```bash
git add src/lib/panelControls.js src/lib/panelControls.test.js src/components/PanelSettingsContent.test.jsx
git commit -m "feat(level-meter): add Bar Colors control" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Gradient and hard-cut zones

**Files:**

- Modify: `src/lib/levelMeterColors.js` (whole file below)
- Test: `src/lib/levelMeterColors.test.js` (whole file below),
  `src/components/panels/LevelMeterPanel.test.jsx`, `src/dock/modules/DockLevel.test.jsx`

- [ ] **Step 1: Write the failing tests**

Replace `src/lib/levelMeterColors.test.js` entirely with:

```js
import { describe, expect, it } from "vitest";
import {
  LEVEL_METER_COLORS,
  levelMeterBackground,
  levelMeterMarkerStatus,
  profileZones,
  thresholdZones,
  zonesToGradient,
} from "./levelMeterColors.js";

const { safe, warning, critical } = LEVEL_METER_COLORS;
const GRADIENT_UP = `linear-gradient(to top, ${safe} 0%, ${warning} 60%, ${critical} 100%)`;

function profile(rules) {
  return { id: "p", name: "P", referenceLufs: null, rules };
}

describe("thresholdZones", () => {
  it("starts safe, then warning, then critical", () => {
    expect(thresholdZones(-6, -1)).toEqual([
      { db: -Infinity, color: safe },
      { db: -6, color: warning },
      { db: -1, color: critical },
    ]);
  });

  it("has no warning zone when both thresholds are equal", () => {
    expect(thresholdZones(-3, -3)).toEqual([
      { db: -Infinity, color: safe },
      { db: -3, color: critical },
    ]);
  });
});

describe("profileZones", () => {
  it("returns null when no rule applies, so the caller shows the neutral colour", () => {
    expect(profileZones(null, "momentary")).toBeNull();
    expect(
      profileZones(
        profile([{ metricId: "integrated", op: ">", value: -22.5, severity: "fail" }]),
        "momentary"
      )
    ).toBeNull();
  });

  it("reads ceilings on the metric and on its Max", () => {
    const doc = profile([
      { metricId: "momentary", op: ">", value: -20, severity: "warn" },
      { metricId: "momentaryMax", op: ">", value: -16, severity: "fail" },
      { metricId: "shortTermMax", op: ">", value: -30, severity: "fail" },
    ]);
    expect(profileZones(doc, "momentary")).toEqual([
      { db: -Infinity, color: safe },
      { db: -20, color: warning },
      { db: -16, color: critical },
    ]);
  });

  it("ignores floors and blank rules", () => {
    const doc = profile([
      { metricId: "momentary", op: "<", value: -40, severity: "fail" },
      { metricId: "momentary", op: ">", value: undefined, severity: "fail" },
    ]);
    expect(profileZones(doc, "momentary")).toBeNull();
  });

  it("keeps a zone only when it is more severe than every lower one", () => {
    const doc = profile([
      { metricId: "shortTerm", op: ">", value: -20, severity: "fail" },
      { metricId: "shortTerm", op: ">", value: -18, severity: "warn" },
      { metricId: "shortTermMax", op: ">", value: -20, severity: "warn" },
    ]);
    expect(profileZones(doc, "shortTerm")).toEqual([
      { db: -Infinity, color: safe },
      { db: -20, color: critical },
    ]);
  });

  it("does not synthesise a warning zone for a single fail rule", () => {
    const doc = profile([{ metricId: "momentaryMax", op: ">", value: -18, severity: "fail" }]);
    expect(profileZones(doc, "momentary")).toEqual([
      { db: -Infinity, color: safe },
      { db: -18, color: critical },
    ]);
  });
});

describe("zonesToGradient", () => {
  it("cuts hard at each threshold within the visible range", () => {
    expect(zonesToGradient(thresholdZones(-6, -1), -60, 3, "to top")).toBe(
      `linear-gradient(to top, ${safe} 0%, ${safe} 85.714%, ${warning} 85.714%, ` +
        `${warning} 93.651%, ${critical} 93.651%, ${critical} 100%)`
    );
  });

  it("keeps each cut on its level when the range is zoomed", () => {
    expect(zonesToGradient(thresholdZones(-12, -3), -30, 0, "to top")).toBe(
      `linear-gradient(to top, ${safe} 0%, ${safe} 60%, ${warning} 60%, ` +
        `${warning} 90%, ${critical} 90%, ${critical} 100%)`
    );
  });

  it("clamps cuts outside the visible range to its edges", () => {
    const zones = [
      { db: -Infinity, color: safe },
      { db: -70, color: critical },
    ];
    expect(zonesToGradient(zones, -64, 0, "to right")).toBe(
      `linear-gradient(to right, ${safe} 0%, ${safe} 0%, ${critical} 0%, ${critical} 100%)`
    );
  });

  it("renders a single zone as a solid image", () => {
    expect(zonesToGradient([{ db: -Infinity, color: critical }], -64, 0, "to right")).toBe(
      `linear-gradient(to right, ${critical}, ${critical})`
    );
  });
});

describe("levelMeterBackground", () => {
  const judging = profile([{ metricId: "momentaryMax", op: ">", value: -18, severity: "fail" }]);

  it("draws the same Gradient in every mode by default, whatever the thresholds or Profile", () => {
    for (const mode of ["peak", "rms", "momentary", "shortTerm"]) {
      expect(
        levelMeterBackground({
          mode,
          controls: { levelMeterPeakWarningDb: -30 },
          profileDocument: judging,
          viewMin: -30,
          viewMax: 0,
        })
      ).toBe(GRADIENT_UP);
    }
  });

  it("puts the Gradient along the direction it is given", () => {
    expect(
      levelMeterBackground({
        mode: "peak",
        controls: {},
        viewMin: -60,
        viewMax: 3,
        direction: "to right",
      })
    ).toBe(`linear-gradient(to right, ${safe} 0%, ${warning} 60%, ${critical} 100%)`);
  });

  it("uses each mode's thresholds under Level Zones", () => {
    const controls = {
      levelMeterBarColors: "levelZones",
      levelMeterPeakWarningDb: -12,
      levelMeterPeakCriticalDb: -3,
      levelMeterRmsWarningDb: -20,
      levelMeterRmsCriticalDb: -10,
    };
    const view = { viewMin: -60, viewMax: 3 };
    expect(levelMeterBackground({ mode: "peak", controls, ...view })).toBe(
      zonesToGradient(thresholdZones(-12, -3), -60, 3, "to top")
    );
    expect(levelMeterBackground({ mode: "rms", controls, ...view })).toBe(
      zonesToGradient(thresholdZones(-20, -10), -60, 3, "to top")
    );
  });

  it("falls back to the default thresholds for missing controls", () => {
    expect(
      levelMeterBackground({
        mode: "peak",
        controls: { levelMeterBarColors: "levelZones" },
        viewMin: -60,
        viewMax: 3,
      })
    ).toBe(zonesToGradient(thresholdZones(-6, -1), -60, 3, "to top"));
  });

  it("shows the trace colour for unwatched loudness modes under Level Zones", () => {
    const view = {
      controls: { levelMeterBarColors: "levelZones" },
      profileDocument: null,
      viewMin: -64,
      viewMax: 0,
    };
    expect(levelMeterBackground({ mode: "momentary", ...view })).toBe(
      "linear-gradient(to top, var(--ui-loudness-momentary), var(--ui-loudness-momentary))"
    );
    expect(levelMeterBackground({ mode: "shortTerm", ...view })).toBe(
      "linear-gradient(to top, var(--ui-loudness-shortterm), var(--ui-loudness-shortterm))"
    );
  });

  it("follows Profile ceilings for loudness modes under Level Zones", () => {
    expect(
      levelMeterBackground({
        mode: "momentary",
        controls: { levelMeterBarColors: "levelZones" },
        profileDocument: judging,
        viewMin: -64,
        viewMax: 0,
      })
    ).toBe(zonesToGradient(profileZones(judging, "momentary"), -64, 0, "to top"));
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

In `src/components/panels/LevelMeterPanel.test.jsx`:

- Change the import `{ profileStops, stopsToGradient, thresholdStops }` to
  `{ profileZones, thresholdZones, zonesToGradient }`.
- `anchors the Peak colours to the Peak thresholds in the visible range`: add
  `levelMeterBarColors: "levelZones",` to its `panelControls`, and expect
  `zonesToGradient(thresholdZones(-12, -3), -30, 0, "to top")`.
- `uses the RMS thresholds in RMS mode`: `panelControls: { levelMeterMode: "rms",
levelMeterBarColors: "levelZones" }`, expect
  `zonesToGradient(thresholdZones(-18, -9), -60, 3, "to top")`.
- Both "shows the Momentary trace colour …" tests and
  `follows a Momentary Max ceiling from the active Profile`: add `levelMeterBarColors: "levelZones"`
  to `panelControls`; the ceiling test expects
  `zonesToGradient(profileZones(profileWithCeiling, "momentary"), -64, 0, "to top")`.
- Add after them:

```jsx
it("draws the Gradient by default and ignores the Profile there", () => {
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
  const gradient =
    "linear-gradient(to top, var(--ui-level-safe) 0%, var(--ui-level-warning) 60%, " +
    "var(--ui-level-critical) 100%)";
  for (const levelMeterMode of ["peak", "momentary"]) {
    const { container, unmount } = renderPanel({ panelControls: { levelMeterMode } });
    expect(container.querySelector("[data-level-meter-gradient]").dataset.levelMeterGradient).toBe(
      gradient
    );
    unmount();
  }
});
```

In `src/dock/modules/DockLevel.test.jsx`:

- Change the import `{ stopsToGradient, thresholdStops }` to `{ thresholdZones, zonesToGradient }`.
- `anchors the Peak colours to the Dock's own thresholds over the whole track`: add
  `levelMeterBarColors: "levelZones",` to its controls, expect
  `zonesToGradient(thresholdZones(-10, -2), -60, 3, "to right")`.
- `no longer floods the whole bar critical at clip`: expect the Gradient
  `"linear-gradient(to right, var(--ui-level-safe) 0%, var(--ui-level-warning) 60%, var(--ui-level-critical) 100%)"`
  (keep the `backgroundColor` assertion).
- `shows the Short-term trace colour when no Profile judges Short-term` and
  `follows a Short-term Max ceiling from the active Profile`: add
  `levelMeterBarColors: "levelZones"` to their controls; the ceiling test now expects
  `"linear-gradient(to right, var(--ui-level-safe) 0%, var(--ui-level-safe) 71.875%, var(--ui-level-critical) 71.875%, var(--ui-level-critical) 100%)"`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/levelMeterColors.test.js src/components/panels/LevelMeterPanel.test.jsx src/dock/modules/DockLevel.test.jsx`
Expected: FAIL (`thresholdZones` is not exported).

- [ ] **Step 3: Implement**

Replace `src/lib/levelMeterColors.js` entirely with:

```js
/// Level Meter bar colours, in one of the two ways the `levelMeterBarColors` control offers.
///
/// Gradient is appearance only: one ramp over the visible bar, the same in every mode, judging
/// nothing and ignoring the Loudness Profile. Level Zones colour by level with hard cuts, so the
/// bar agrees with the readouts at every level: Peak and RMS from the user's Warning / Critical,
/// Momentary and Short-term from the Loudness Profile's ceilings. PLVS does not invent LUFS
/// thresholds, so an unjudged Momentary or Short-term bar shows its Loudness trace colour instead
/// of a green that would itself be a verdict.
///
/// A zone is `{ db, color }`: `color` from `db` up to the next zone's `db`. The first zone starts at
/// `-Infinity`.

import { isRuleEmpty } from "./loudnessProfileCatalog.js";
import { loudnessProfileEvaluate } from "./loudnessProfileEvaluate.js";
import { DEFAULT_PANEL_CONTROLS } from "./panelControls.js";

export const LEVEL_METER_COLORS = Object.freeze({
  safe: "var(--ui-level-safe)",
  warning: "var(--ui-level-warning)",
  critical: "var(--ui-level-critical)",
});

/// Gradient's pure warning, measured from the top of the bar. Chosen by eye, not a level; the
/// Theme Preview swatch (`.meter-gradient` in src/index.css) uses the same stop.
const GRADIENT_WARNING_FROM_TOP_PERCENT = 40;

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

function gradient(direction) {
  const { safe, warning, critical } = LEVEL_METER_COLORS;
  return `linear-gradient(${direction}, ${safe} 0%, ${warning} ${
    100 - GRADIENT_WARNING_FROM_TOP_PERCENT
  }%, ${critical} 100%)`;
}

export function thresholdZones(warningDb, criticalDb) {
  return [
    { db: -Infinity, color: LEVEL_METER_COLORS.safe },
    ...(warningDb < criticalDb ? [{ db: warningDb, color: LEVEL_METER_COLORS.warning }] : []),
    { db: criticalDb, color: LEVEL_METER_COLORS.critical },
  ];
}

/// Only ceilings colour the bar. Live loudness drops to silence between phrases, so a floor would
/// hold the bottom of the bar red. Floors stay judged in Stats.
export function profileZones(document, metricId) {
  const metricIds = new Set([metricId, MAX_METRIC[metricId]]);
  const ceilings = (document?.rules ?? [])
    .filter((rule) => !isRuleEmpty(rule) && rule.op === ">" && metricIds.has(rule.metricId))
    .sort((a, b) => a.value - b.value || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  if (ceilings.length === 0) return null;

  const zones = [{ db: -Infinity, color: LEVEL_METER_COLORS.safe }];
  let rank = 0;
  for (const rule of ceilings) {
    if (SEVERITY_RANK[rule.severity] <= rank) continue;
    rank = SEVERITY_RANK[rule.severity];
    zones.push({ db: rule.value, color: SEVERITY_COLOR[rule.severity] });
  }
  return zones;
}

/// Hard cuts: each zone is painted from its own level to the next zone's, clamped to the visible
/// range. Always a `background-image`, even for one colour, so a caller can size or clip it without
/// switching between `background-color` and `background-image`.
export function zonesToGradient(zones, viewMin, viewMax, direction) {
  if (zones.length === 1) {
    return `linear-gradient(${direction}, ${zones[0].color}, ${zones[0].color})`;
  }
  const percent = (db) => {
    const value = Math.min(100, Math.max(0, ((db - viewMin) / (viewMax - viewMin)) * 100));
    return `${Number(value.toFixed(3))}%`;
  };
  const stops = zones.flatMap(({ db, color }, index) => {
    const end = index + 1 < zones.length ? percent(zones[index + 1].db) : "100%";
    return [`${color} ${percent(db)}`, `${color} ${end}`];
  });
  return `linear-gradient(${direction}, ${stops.join(", ")})`;
}

export function levelMeterBackground({
  mode,
  controls,
  profileDocument = null,
  viewMin,
  viewMax,
  direction = "to top",
}) {
  const barColors = controls?.levelMeterBarColors ?? DEFAULT_PANEL_CONTROLS.levelMeterBarColors;
  if (barColors !== "levelZones") return gradient(direction);

  const keys = THRESHOLD_KEYS[mode];
  if (keys) {
    const [warningDb, criticalDb] = keys.map(
      (key) => controls?.[key] ?? DEFAULT_PANEL_CONTROLS[key]
    );
    return zonesToGradient(thresholdZones(warningDb, criticalDb), viewMin, viewMax, direction);
  }
  const zones = profileZones(profileDocument, mode) ?? [
    { db: -Infinity, color: NEUTRAL_COLORS[mode] },
  ];
  return zonesToGradient(zones, viewMin, viewMax, direction);
}

/// The Floating Value marker's status: the metric's own rules, as its Stats row judges them, and
/// the Max metric's ceilings, as the bar colour at the marker's position does under Level Zones.
/// The worse wins; `undefined` means nothing judges the metric.
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

`LevelMeterPanel.jsx` and `DockLevel.jsx` need no change: both already pass their controls to
`levelMeterBackground`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/levelMeterColors.test.js src/components/panels src/dock/modules`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/levelMeterColors.js src/lib/levelMeterColors.test.js src/components/panels/LevelMeterPanel.test.jsx src/dock/modules/DockLevel.test.jsx
git commit -m "feat(level-meter): draw Gradient or hard-cut Level Zones" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Dock Bar Colors

**Files:**

- Modify: `src/dock/dockModuleControls.js:30` (`DOCK_MODULE_CONTROL_KEYS.level`)
- Modify: `src/dock/editors/DockModuleSettings.jsx` (level branch of `SettingsBody`)
- Test: `src/dock/dockModuleControls.test.js`, `src/dock/editors/DockModuleSettings.test.jsx`,
  `src/dock/modules/DockLevel.test.jsx`

- [ ] **Step 1: Write the failing tests**

In `src/dock/dockModuleControls.test.js`, in `carries the Level Meter thresholds on the Dock level
module`, add `levelMeterBarColors: "gradient"` to the `toMatchObject` default expectation; also add
it to the strict default literal in `defaults Level to live Peak and migrates legacy readouts`.

In `src/dock/editors/DockModuleSettings.test.jsx`:

- The three threshold tests (`edits the thresholds of the current level mode`,
  `edits the RMS thresholds without touching Peak`, `has no thresholds in loudness modes`) must run
  under Level Zones. In each, build controls as
  `{ ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.level, levelMeterBarColors: "levelZones", … }` and pass
  them with `renderSettings("level", { controls })`; expected `onChange` payloads spread that same
  `controls` object instead of the bare defaults.
- Add:

```jsx
it("switches Bar Colors and hides thresholds under Gradient", () => {
  const onChange = renderSettings("level");
  expect(screen.queryByText("Warning / Critical")).toBeNull();
  fireEvent.click(screen.getByLabelText("level meter bar colors"));
  fireEvent.click(screen.getByRole("option", { name: "Level Zones" }));
  expect(onChange).toHaveBeenCalledWith({
    ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.level,
    levelMeterBarColors: "levelZones",
  });
});
```

In `src/dock/modules/DockLevel.test.jsx`, add:

```jsx
it("draws the Gradient over the whole track by default", () => {
  renderWith({ displayAudio: { peakDb: [-12, -30] } });
  for (const bar of screen.getAllByTestId("dock-level-bar")) {
    expect(bar.firstChild.dataset.levelMeterGradient).toBe(
      "linear-gradient(to right, var(--ui-level-safe) 0%, var(--ui-level-warning) 60%, " +
        "var(--ui-level-critical) 100%)"
    );
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/dock`
Expected: FAIL (`levelMeterBarColors` missing from Dock defaults; label
`level meter bar colors` not found).

- [ ] **Step 3: Implement**

`src/dock/dockModuleControls.js`, `DOCK_MODULE_CONTROL_KEYS.level`:

```js
  level: [
    "levelMeterMode",
    "levelMeterBarColors",
    "levelMeterPeakWarningDb",
    "levelMeterPeakCriticalDb",
    "levelMeterRmsWarningDb",
    "levelMeterRmsCriticalDb",
  ],
```

`src/dock/editors/DockModuleSettings.jsx`, level branch: next to the existing `thresholdRow` lookup
add

```jsx
const barColorsRow = panelControlUiRows("levelMeter").find(
  (row) => row.key === "levelMeterBarColors"
);
```

and render, directly before the `{thresholdRow ? (` block:

```jsx
<SettingsRow label={barColorsRow.ui.label} tooltip={barColorsRow.ui.tooltip}>
  <SelectField
    label={barColorsRow.ui.ariaLabel}
    value={controls.levelMeterBarColors}
    options={barColorsRow.ui.options.map(({ id, label }) => ({ value: id, label }))}
    onChange={(levelMeterBarColors) => onChange({ ...controls, levelMeterBarColors })}
  />
</SettingsRow>
```

Check `SelectField`'s props in the same file (it is already used for "Level mode" with `label`,
`value`, `options`, `onChange`); if `SettingsRow` there takes no `tooltip`, drop that prop and report
it.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/dock`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dock
git commit -m "feat(dock): add Bar Colors to the level strip" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Theme Preview swatch

**Files:**

- Modify: `src/index.css` (`.meter-gradient`)

- [ ] **Step 1: Edit**

Replace the rule and its comment with:

```css
/* Theme Preview swatch only. It shows the Level Meter's Gradient option, whose warning stop sits
   40% from the top (GRADIENT_WARNING_FROM_TOP_PERCENT in src/lib/levelMeterColors.js). */
.meter-gradient {
  background: linear-gradient(
    180deg,
    var(--ui-meter-gradient-top) 0%,
    var(--ui-meter-gradient-mid) 40%,
    var(--ui-meter-gradient-bottom) 100%
  );
}
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/theme src/components/theme-editor`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "style(theme): match the meter swatch to the Gradient stop" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Agent Control

Public field `barColors`, enum `"gradient" | "levelZones"`, default `"gradient"`, always effective,
in Panel Control and Dock Control. `peakThresholdsDbfs` is effective when mode is `peak` **and**
`barColors` is `levelZones`; its inactive reason is `nonPeakMode` when the mode differs, otherwise
`gradientBarColors`. Same for `rmsThresholdsDbfs` with `rms` / `nonRmsMode`.

**Files:**

- Modify: `src/agentControl/panelControls.js`, `panelControlSchema.js`, `panelControlPatch.js`,
  `dockControl.js`
- Test: `src/agentControl/panelControls.test.js`, `panelControlSchema.test.js`,
  `panelControlPatch.test.js`, `dockControl.test.js`
- Regenerate: `docs/agent-control/generated/`

- [ ] **Step 1: Write the failing tests**

`src/agentControl/panelControlPatch.test.js`:

```js
it("patches Bar Colors and rejects unknown values", () => {
  const ok = planPublicPanelControlPatch("levelMeter", DEFAULT_PANEL_CONTROLS, {
    barColors: "levelZones",
  });
  expect(ok).toMatchObject({ issues: [], changed: ["controls.barColors"], warnings: [] });
  expect(ok.panelControls.levelMeterBarColors).toBe("levelZones");

  const bad = planPublicPanelControlPatch("levelMeter", DEFAULT_PANEL_CONTROLS, {
    barColors: "rainbow",
  });
  expect(bad.issues).toEqual([
    expect.objectContaining({ code: "invalidEnum", path: "$.barColors" }),
  ]);
});

it("warns that thresholds are inactive under Gradient, judged on the final state", () => {
  const gradient = planPublicPanelControlPatch("levelMeter", DEFAULT_PANEL_CONTROLS, {
    peakThresholdsDbfs: { warning: -12, critical: -3 },
  });
  expect(gradient.warnings).toEqual([
    {
      code: "currentlyInactive",
      path: "controls.peakThresholdsDbfs",
      inactiveReason: "gradientBarColors",
    },
  ]);

  const zones = planPublicPanelControlPatch("levelMeter", DEFAULT_PANEL_CONTROLS, {
    barColors: "levelZones",
    peakThresholdsDbfs: { warning: -12, critical: -3 },
  });
  expect(zones.warnings).toEqual([]);
});
```

The existing tests `patches Level Meter thresholds as ordered pairs` and
`accepts equal warning and critical thresholds` expect no warnings; add `barColors: "levelZones"` to
their patches and `"controls.barColors"` as the first entry of any exact `changed` expectation.
`warns when thresholds for another mode are patched` keeps `nonRmsMode` (mode is checked first).

`src/agentControl/panelControlSchema.test.js` — replace
`describes the Level Meter thresholds and marks the other mode's pair inactive` with:

```js
it("describes Bar Colors and when each threshold pair is effective", () => {
  const byDefault = buildPublicPanelControlSchema("levelMeter", DEFAULT_PANEL_CONTROLS);
  expect(byDefault.properties.barColors).toMatchObject({
    effective: true,
    default: "gradient",
    options: ["gradient", "levelZones"],
  });
  expect(byDefault.properties.peakThresholdsDbfs).toMatchObject({
    effective: false,
    inactiveReason: "gradientBarColors",
    default: { warning: -6, critical: -1 },
    constraints: [{ kind: "ordered", lower: "warning", upper: "critical", inclusive: true }],
  });

  const zones = buildPublicPanelControlSchema("levelMeter", {
    ...DEFAULT_PANEL_CONTROLS,
    levelMeterBarColors: "levelZones",
  });
  expect(zones.properties.peakThresholdsDbfs.effective).toBe(true);
  expect(zones.properties.rmsThresholdsDbfs).toMatchObject({
    effective: false,
    inactiveReason: "nonRmsMode",
  });
});
```

`src/agentControl/panelControls.test.js` — in `returns the complete Level Meter control document`,
add `levelMeterBarColors: "levelZones"` to the input and `barColors: "levelZones"` to the expected
object, directly after `tpMaxMarker`.

`src/agentControl/dockControl.test.js` — every expected Dock level `controls` object gains
`barColors: "gradient"` after `showLabels`; add:

```js
it("plans Dock Bar Colors through the panel's own rules", () => {
  const planned = planDockPanelPatch(dock, "level", { barColors: "levelZones" }, {});
  expect(planned.issues).toEqual([]);
  expect(buildDockSnapshot(planned.dock).panels[1].controls.barColors).toBe("levelZones");
});
```

`src/transfer/portablePreset.test.js` — extend the existing test
`round-trips Level Meter thresholds for both a Workspace panel and a Dock module`: set
`levelMeterBarColors: "levelZones"` on the Workspace panel's controls (leave the Dock module on the
default), and assert after import that the panel's stored controls have
`levelMeterBarColors: "levelZones"` and the Dock module's have `levelMeterBarColors: "gradient"`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/agentControl src/transfer`
Expected: the new and changed cases fail (the preset one because `barColors` is not yet a public
field, so export drops it); `panelControlCoverage.test.js` still names `levelMeterBarColors`.

- [ ] **Step 3: Implement**

`src/agentControl/panelControls.js`, Level Meter branch, directly after `tpMaxMarker`:

```js
      barColors: controls.levelMeterBarColors,
```

`src/agentControl/panelControlSchema.js`, Level Meter branch. Before `return root({`, add:

```js
const levelZones = controls.levelMeterBarColors === "levelZones";
const thresholdsReason = (mode, modeReason) =>
  controls.levelMeterMode !== mode ? modeReason : "gradientBarColors";
```

After `tpMaxMarker`, add:

```js
      barColors: field(
        "string",
        "Bar Colors",
        "Gradient is appearance only; Level Zones color the bar by thresholds or Profile rules.",
        { default: defaults.barColors, options: ["gradient", "levelZones"], effective: true }
      ),
```

and replace the two threshold entries with:

```js
      peakThresholdsDbfs: active(
        thresholds("Peak Thresholds", defaults.peakThresholdsDbfs),
        controls.levelMeterMode === "peak" && levelZones,
        thresholdsReason("peak", "nonPeakMode")
      ),
      rmsThresholdsDbfs: active(
        thresholds("RMS Thresholds", defaults.rmsThresholdsDbfs),
        controls.levelMeterMode === "rms" && levelZones,
        thresholdsReason("rms", "nonRmsMode")
      ),
```

`src/agentControl/panelControlPatch.js`:

- Add `"barColors"` to `LEVEL_METER_FIELDS`, and below `LEVEL_METER_MODES`:

  ```js
  const LEVEL_METER_BAR_COLORS = new Set(["gradient", "levelZones"]);
  ```

- With the other validations in the Level Meter branch:

  ```js
  if (hasOwn(patch, "barColors") && !LEVEL_METER_BAR_COLORS.has(patch.barColors)) {
    issues.push(
      issue("invalidEnum", "$.barColors", "barColors is not a supported Bar Colors option.")
    );
  }
  ```

- Directly after the `mode` mapping:

  ```js
  if (hasOwn(patch, "barColors") && patch.barColors !== current.levelMeterBarColors) {
    panelControls.levelMeterBarColors = patch.barColors;
    changed.push("controls.barColors");
  }
  ```

- Replace the two threshold `warn(...)` lines with:

  ```js
  const levelZones = panelControls.levelMeterBarColors === "levelZones";
  if (finalMode !== "peak") warn("peakThresholdsDbfs", "nonPeakMode");
  else if (!levelZones) warn("peakThresholdsDbfs", "gradientBarColors");
  if (finalMode !== "rms") warn("rmsThresholdsDbfs", "nonRmsMode");
  else if (!levelZones) warn("rmsThresholdsDbfs", "gradientBarColors");
  ```

`src/agentControl/dockControl.js`:

- `PUBLIC_DOCK_CONTROLS.levelMeter`: add `"barColors"`.
- `publicControls`, Level Meter branch: add `barColors: all.barColors,` after `showLabels`.

- [ ] **Step 4: Regenerate and run**

Run: `npm run docs:agent-control`
Run: `npx vitest run src/agentControl src/transfer`
Expected: PASS. Pre-existing snapshot literals that now lack `barColors` (e.g. in
`appSnapshot.test.js`, `presetSnapshot.test.js`, `src/transfer/portablePreset.test.js`) get
`barColors: "gradient"` added per the conventions note — but Portable Preset exports omit default
controls since `44cd5c51`, so check before adding it there.

If `docs/agent-control/panels.md` lists when Level Meter fields are effective (it has a bullet for
`tpMaxMarker` and the threshold pairs), extend that bullet: the threshold pairs are effective only
under `barColors: "levelZones"`, otherwise `gradientBarColors`.

- [ ] **Step 5: Commit**

```bash
git add src/agentControl src/transfer docs/agent-control
git commit -m "feat(cli): expose Level Meter Bar Colors" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: User guide

**Files:**

- Modify: `docs/user/panels.md` (`## Level Meter`)
- Modify: `docs/user/loudness-profiles.md`

- [ ] **Step 1: Edit `docs/user/panels.md`**

Replace the Level Meter colour paragraph (from "The bar colours belong to levels…" to "…with its own
Warning / Critical in its settings.") with:

```markdown
**Bar Colors** chooses what the colours mean. **Gradient** (the default) is appearance only: one
green-to-red ramp over the visible bar, in every mode, that zooms with the scale and ignores the
Loudness Profile. **Level Zones** colour by level, with a hard change at each threshold, so a level
keeps its colour at any zoom. In Peak and RMS, **Warning / Critical** sets the zones (defaults: Peak
−6 / −1 dBFS, RMS −18 / −9 dBFS); they are a reading aid for headroom, not a compliance check,
because the Peak bars show sample peak while delivery limits are judged on true peak by the True
Peak Max marker and Stats. In Momentary and Short-term the zones come from the active Loudness
Profile's upper limits on that metric or its Max; with no such rule the bar shows the metric's
Loudness curve colour, because nothing is judging it. The readout markers follow the Profile under
either option. The Dock's level strip has the same Bar Colors and its own Warning / Critical in its
settings.
```

- [ ] **Step 2: Edit `docs/user/loudness-profiles.md`**

In the paragraph that begins "The Level Meter colours its Momentary and Short-term bars", insert
after its first sentence: "This applies when the Level Meter's **Bar Colors** is **Level Zones**;
the default Gradient does not follow the Profile." In `## Where profiles apply`, change the bullet
"The Level Meter's Momentary and Short-term bar colours and Floating Value" to "The Level Meter's
Floating Value, and its Momentary and Short-term bar colours under Level Zones".

- [ ] **Step 3: Check**

Run: `npx vitest run scripts/documentationStructure.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/user/panels.md docs/user/loudness-profiles.md
git commit -m "docs(level-meter): document Bar Colors" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Verification

- [ ] **Step 1:** Run `npm run check`. Expected: exit 0.
- [ ] **Step 2:** Hand the manual check to the user (do not start a preview unprompted). With
      `npm run desktop`:
  1. A new Level Meter shows the Gradient in all four modes; zooming rescales it.
  2. Bar Colors → Level Zones: Peak/RMS show hard zones at Warning / Critical; zooming keeps them on
     their levels; Warning / Critical appears only now.
  3. Momentary under Level Zones: solid Momentary colour without a rule; with a Profile carrying a
     `Momentary Max >` rule, a hard cut to red at that level. Under Gradient the same Profile leaves
     the bar unchanged while the Floating Value still turns critical.
  4. The Dock strip mirrors 1–3 with its own settings.
  5. Restart the app (not a Vite reload): Bar Colors and thresholds persist for panel and Dock.
