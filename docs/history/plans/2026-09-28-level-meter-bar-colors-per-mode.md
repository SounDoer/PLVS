# Level Meter Bar Colors Per Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single shared `levelMeterBarColors` control with one value per measurement
mode (Peak, RMS, Momentary, Short-term), in the panel, the Dock and Agent Control.

**Architecture:** The control table gains four enum rows built by one helper and an exported
mode → key map, `LEVEL_METER_BAR_COLORS_KEYS`. Everything that read the single key reads
`controls[LEVEL_METER_BAR_COLORS_KEYS[mode]]` instead: the colour builder, the threshold rows'
visibility, the Dock settings row and Agent Control. Each Bar Colors row is shown only in its own
mode, so the settings still show one "Bar Colors" row.

**Tech Stack:** React 19, Vitest (jsdom).

**Spec:** `docs/history/specs/2026-09-28-level-meter-bar-colors-design.md` (revised: "Each
measurement mode keeps its own value").

**Conventions for every task**

- Tests run with `npx vitest run <file>`.
- Commit with Conventional Commits and scope, ending with
  `-m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"` — use exactly this trailer, even if
  your environment suggests another. Never `--no-verify`.
- Work lands on `main`. The single key `levelMeterBarColors` never shipped in a release, so it is
  removed outright; no migration.

---

### Task 1: Per-mode controls, colours, panel and Dock

**Files:**

- Modify: `src/lib/panelControls.js`, `src/lib/levelMeterColors.js`,
  `src/dock/dockModuleControls.js`, `src/dock/editors/DockModuleSettings.jsx`
- Test: `src/lib/panelControls.test.js`, `src/lib/levelMeterColors.test.js`,
  `src/components/PanelSettingsContent.test.jsx`, `src/components/panels/LevelMeterPanel.test.jsx`,
  `src/dock/modules/DockLevel.test.jsx`, `src/dock/dockModuleControls.test.js`,
  `src/dock/editors/DockModuleSettings.test.jsx`

- [ ] **Step 1: Update existing tests to per-mode keys**

Run `git grep -n "levelMeterBarColors" -- src`. Outside `src/agentControl` (Task 2), change every
occurrence in the test files listed above:

- In a test's controls, replace `levelMeterBarColors: X` with the key for the mode that test uses:
  `peak` → `levelMeterPeakBarColors`, `rms` → `levelMeterRmsBarColors`, `momentary` →
  `levelMeterMomentaryBarColors`, `shortTerm` → `levelMeterShortTermBarColors`. A test with no
  explicit mode is in Peak (the default). A test that switches or covers two modes (e.g. Peak and RMS
  in `levelMeterColors.test.js` "uses each mode's thresholds under Level Zones", or the RMS case of
  `shows the RMS thresholds in RMS mode and none in loudness modes`) sets both keys.
- Strict literals of defaults (`panelControls.test.js` "uses the agreed defaults" and "normalizes
  invalid input…", `dockModuleControls.test.js` defaults) replace `levelMeterBarColors: "gradient"`
  with all four keys set to `"gradient"`, in the order Peak, RMS, Momentary, Short-term.
- `panelControls.test.js` "Level Meter bar colors" describe and the threshold visibility test:
  rewrite with the per-mode keys (see Step 2 for the new cases).
- UI tests that open the Bar Colors select by the label `level meter bar colors` keep that label:
  every per-mode row uses the same aria label, and only one is visible at a time.

- [ ] **Step 2: Add the per-mode tests**

`src/lib/panelControls.test.js`, replace the "Level Meter bar colors" describe with:

```js
describe("Level Meter bar colors", () => {
  const KEYS = [
    "levelMeterPeakBarColors",
    "levelMeterRmsBarColors",
    "levelMeterMomentaryBarColors",
    "levelMeterShortTermBarColors",
  ];

  it("keeps one value per mode, each defaulting to Gradient", () => {
    expect(Object.values(LEVEL_METER_BAR_COLORS_KEYS)).toEqual(KEYS);
    for (const key of KEYS) expect(DEFAULT_PANEL_CONTROLS[key]).toBe("gradient");
    expect(DEFAULT_PANEL_CONTROLS).not.toHaveProperty("levelMeterBarColors");
  });

  it("repairs each value on its own", () => {
    const normalized = normalizePanelControls({
      levelMeterPeakBarColors: "levelZones",
      levelMeterRmsBarColors: "rainbow",
    });
    expect(normalized).toMatchObject({
      levelMeterPeakBarColors: "levelZones",
      levelMeterRmsBarColors: "gradient",
      levelMeterMomentaryBarColors: "gradient",
      levelMeterShortTermBarColors: "gradient",
    });
  });

  it("shows exactly one Bar Colors row, for the current mode, before the thresholds", () => {
    const rows = panelControlUiRows("levelMeter");
    for (const [mode, key] of Object.entries(LEVEL_METER_BAR_COLORS_KEYS)) {
      const visible = rows.filter(
        (row) => row.ui.label === "Bar Colors" && row.ui.showWhen({ levelMeterMode: mode })
      );
      expect(visible.map((row) => row.key)).toEqual([key]);
      expect(visible[0].ui).toMatchObject({
        widget: "select",
        ariaLabel: "level meter bar colors",
        options: [
          { id: "gradient", label: "Gradient" },
          { id: "levelZones", label: "Level Zones" },
        ],
      });
    }
    const firstBarColors = rows.findIndex((row) => row.ui.label === "Bar Colors");
    expect(firstBarColors).toBeLessThan(
      rows.findIndex((row) => row.minKey === "levelMeterPeakWarningDb")
    );
  });
});
```

and the threshold visibility test (`shows each pair only under Level Zones and for its own mode`)
becomes:

```js
it("shows each pair only under its own mode's Level Zones", () => {
  const row = (minKey) =>
    panelControlUiRows("levelMeter").find((candidate) => candidate.minKey === minKey);
  const peak = row("levelMeterPeakWarningDb");
  const rms = row("levelMeterRmsWarningDb");
  expect(peak.ui.showWhen({ levelMeterMode: "peak", levelMeterPeakBarColors: "levelZones" })).toBe(
    true
  );
  expect(peak.ui.showWhen({ levelMeterMode: "peak", levelMeterRmsBarColors: "levelZones" })).toBe(
    false
  );
  expect(peak.ui.showWhen({ levelMeterMode: "rms", levelMeterPeakBarColors: "levelZones" })).toBe(
    false
  );
  expect(rms.ui.showWhen({ levelMeterMode: "rms", levelMeterRmsBarColors: "levelZones" })).toBe(
    true
  );
});
```

Import `LEVEL_METER_BAR_COLORS_KEYS` from `./panelControls.js` in that file.

`src/lib/levelMeterColors.test.js`, in the `levelMeterBackground` describe, add:

```js
it("reads only the current mode's Bar Colors", () => {
  const controls = { levelMeterPeakBarColors: "levelZones" };
  const view = { controls, viewMin: -60, viewMax: 3 };
  expect(levelMeterBackground({ mode: "peak", ...view })).toBe(
    zonesToGradient(thresholdZones(-6, -1), -60, 3, "to top")
  );
  expect(levelMeterBackground({ mode: "rms", ...view })).toBe(GRADIENT_UP);
});
```

`src/components/PanelSettingsContent.test.jsx`, add:

```jsx
it("changes only the current mode's Bar Colors", () => {
  const onPanelControlsChange = vi.fn();
  render(
    <PanelSettingsContent
      activeTab="levelMeter"
      panelControls={{ ...DEFAULT_PANEL_CONTROLS, levelMeterMode: "rms" }}
      onPanelControlsChange={onPanelControlsChange}
    />
  );

  fireEvent.click(screen.getByLabelText("level meter bar colors"));
  fireEvent.click(screen.getByRole("option", { name: "Level Zones" }));
  const next = onPanelControlsChange.mock.lastCall[0];
  expect(next).toMatchObject({
    levelMeterRmsBarColors: "levelZones",
    levelMeterPeakBarColors: "gradient",
    levelMeterMomentaryBarColors: "gradient",
    levelMeterShortTermBarColors: "gradient",
  });
});
```

`src/components/panels/LevelMeterPanel.test.jsx`, add:

```jsx
it("follows the current mode's own Bar Colors", () => {
  const gradient =
    "linear-gradient(to top, var(--ui-level-safe) 0%, var(--ui-level-warning) 60%, " +
    "var(--ui-level-critical) 100%)";
  const panelControls = { levelMeterPeakBarColors: "levelZones" };
  const peak = renderPanel({ panelControls: { ...panelControls, levelMeterMode: "peak" } });
  expect(
    peak.container.querySelector("[data-level-meter-gradient]").dataset.levelMeterGradient
  ).toBe(zonesToGradient(thresholdZones(-6, -1), -60, 3, "to top"));
  peak.unmount();

  const momentary = renderPanel({
    panelControls: { ...panelControls, levelMeterMode: "momentary" },
  });
  expect(
    momentary.container.querySelector("[data-level-meter-gradient]").dataset.levelMeterGradient
  ).toBe(gradient);
});
```

`src/dock/editors/DockModuleSettings.test.jsx`, replace `switches Bar Colors and hides thresholds
under Gradient` with:

```jsx
it("switches the current mode's Bar Colors and hides thresholds under Gradient", () => {
  const onChange = renderSettings("level");
  expect(screen.queryByText("Warning / Critical")).toBeNull();
  fireEvent.click(screen.getByLabelText("level meter bar colors"));
  fireEvent.click(screen.getByRole("option", { name: "Level Zones" }));
  expect(onChange).toHaveBeenCalledWith({
    ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.level,
    levelMeterPeakBarColors: "levelZones",
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/lib src/components src/dock`
Expected: FAIL (`LEVEL_METER_BAR_COLORS_KEYS` not exported; per-mode keys absent).

- [ ] **Step 4: Implement**

`src/lib/panelControls.js`:

1. After `LEVEL_METER_BAR_COLOR_OPTIONS`, add:

   ```js
   /// Each measurement mode keeps its own Bar Colors, so switching Mode brings back that mode's
   /// choice: Level Zones for reading headroom in Peak can sit beside a Gradient in Momentary.
   export const LEVEL_METER_BAR_COLORS_KEYS = Object.freeze({
     peak: "levelMeterPeakBarColors",
     rms: "levelMeterRmsBarColors",
     momentary: "levelMeterMomentaryBarColors",
     shortTerm: "levelMeterShortTermBarColors",
   });
   ```

2. In `levelMeterThresholdRow`, change `showWhen` to:

   ```js
      showWhen: (controls) =>
        controls.levelMeterMode === mode &&
        controls[LEVEL_METER_BAR_COLORS_KEYS[mode]] === "levelZones",
   ```

3. After `levelMeterThresholdRow`, add:

   ```js
   const LEVEL_METER_BAR_COLORS_TOOLTIP =
     "Gradient is appearance only. Level Zones color the bar by level: Warning / Critical for " +
     "Peak and RMS, the Loudness Profile's rules for Momentary and Short-term.";

   /// One row per mode, all labelled Bar Colors; `showWhen` leaves exactly one visible.
   function levelMeterBarColorsRow(mode, key) {
     return {
       key,
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
         tooltip: LEVEL_METER_BAR_COLORS_TOOLTIP,
         showWhen: (controls) => controls.levelMeterMode === mode,
       },
     };
   }
   ```

4. In `CONTROLS`, replace the whole `levelMeterBarColors` row with:

   ```js
     ...Object.entries(LEVEL_METER_BAR_COLORS_KEYS).map(([mode, key]) =>
       levelMeterBarColorsRow(mode, key)
     ),
   ```

`src/lib/levelMeterColors.js`:

- Import `LEVEL_METER_BAR_COLORS_KEYS` alongside `DEFAULT_PANEL_CONTROLS`.
- First line of the header comment becomes: `/// Level Meter bar colours, in one of the two ways each
mode's Bar Colors control offers.`
- In `levelMeterBackground`, replace the `barColors` line with:

  ```js
  const barColorsKey = LEVEL_METER_BAR_COLORS_KEYS[mode];
  const barColors = controls?.[barColorsKey] ?? DEFAULT_PANEL_CONTROLS[barColorsKey];
  ```

`src/dock/dockModuleControls.js`, in `DOCK_MODULE_CONTROL_KEYS.level`, replace
`"levelMeterBarColors"` with the four keys, in the order Peak, RMS, Momentary, Short-term.

`src/dock/editors/DockModuleSettings.jsx`:

- Import `LEVEL_METER_BAR_COLORS_KEYS` from `../../lib/panelControls.js`.
- Replace the `barColorsRow` lookup with:

  ```jsx
  const barColorsRow = panelControlUiRows("levelMeter").find(
    (row) => row.key === LEVEL_METER_BAR_COLORS_KEYS[controls.levelMeterMode]
  );
  ```

- In the Bar Colors `SelectField`, use `value={controls[barColorsRow.key]}` and
  `onChange={(value) => onChange({ ...controls, [barColorsRow.key]: value })}`.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/lib src/components src/dock`
Expected: PASS.

Run: `npx vitest run`
Expected: only `src/agentControl` tests fail (Task 2), including
`panelControlCoverage.test.js` naming the four new keys.

- [ ] **Step 6: Commit**

```bash
git add src/lib src/components src/dock
git commit -m "feat(level-meter): keep Bar Colors per measurement mode" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Agent Control

Four public fields replace `barColors`: `peakBarColors`, `rmsBarColors`, `momentaryBarColors`,
`shortTermBarColors` (enum `"gradient" | "levelZones"`, default `"gradient"`), each effective in its
own mode, else inactive with `nonPeakMode` / `nonRmsMode` / `nonMomentaryMode` /
`nonShortTermMode`. Threshold pairs are effective in their mode under that mode's Level Zones; the
reason stays mode-first, then `gradientBarColors`.

**Files:**

- Modify: `src/agentControl/panelControls.js`, `panelControlSchema.js`, `panelControlPatch.js`,
  `dockControl.js`
- Test: the `src/agentControl` tests and `src/transfer/portablePreset.test.js` that mention
  `barColors` / `levelMeterBarColors`
- Regenerate: `docs/agent-control/generated/`; edit `docs/agent-control/panels.md`

- [ ] **Step 1: Update and add tests**

Run `git grep -n "barColors\|levelMeterBarColors" -- src/agentControl src/transfer`.

- Read-mapping, snapshot and Dock expectations: replace `barColors: "gradient"` with the four fields
  (`peakBarColors`, `rmsBarColors`, `momentaryBarColors`, `shortTermBarColors`), each `"gradient"`,
  after `tpMaxMarker` (Panel) / after `showLabels` (Dock), unless a test sets a value.
- Patches that used `barColors: "levelZones"` with Peak thresholds use `peakBarColors`; with RMS
  thresholds use `rmsBarColors`; `changed` entries become `controls.peakBarColors` etc.
- `patches Bar Colors and rejects unknown values` becomes:

  ```js
  it("patches each mode's Bar Colors and rejects unknown values", () => {
    const ok = planPublicPanelControlPatch("levelMeter", DEFAULT_PANEL_CONTROLS, {
      peakBarColors: "levelZones",
    });
    expect(ok).toMatchObject({ issues: [], changed: ["controls.peakBarColors"], warnings: [] });
    expect(ok.panelControls).toMatchObject({
      levelMeterPeakBarColors: "levelZones",
      levelMeterRmsBarColors: "gradient",
    });

    const bad = planPublicPanelControlPatch("levelMeter", DEFAULT_PANEL_CONTROLS, {
      momentaryBarColors: "rainbow",
    });
    expect(bad.issues).toEqual([
      expect.objectContaining({ code: "invalidEnum", path: "$.momentaryBarColors" }),
    ]);

    const inactive = planPublicPanelControlPatch("levelMeter", DEFAULT_PANEL_CONTROLS, {
      shortTermBarColors: "levelZones",
    });
    expect(inactive.warnings).toEqual([
      {
        code: "currentlyInactive",
        path: "controls.shortTermBarColors",
        inactiveReason: "nonShortTermMode",
      },
    ]);
  });
  ```

- `judges threshold warnings on the patch's final mode and Bar Colors`: patch 1 uses
  `rmsBarColors: "levelZones"`; patch 2 starts from `levelMeterPeakBarColors: "levelZones"` and
  sends `peakBarColors: "gradient"`; patch 3 sends `mode: "rms", rmsBarColors: "levelZones"` with
  Peak thresholds and still expects `nonPeakMode`. Add a fourth: from `DEFAULT_PANEL_CONTROLS`,
  `{ rmsBarColors: "levelZones", peakThresholdsDbfs: { warning: -12, critical: -3 } }` warns
  `gradientBarColors` on `controls.peakThresholdsDbfs` (Peak's own Bar Colors is still Gradient)
  and `nonRmsMode` on `controls.rmsBarColors`.
- Schema test: `barColors` assertions become per-mode — `peakBarColors` effective by default;
  `rmsBarColors` `{ effective: false, inactiveReason: "nonRmsMode" }`; with
  `levelMeterPeakBarColors: "levelZones"` the Peak thresholds are effective.
- Dock test `plans Dock Bar Colors through the panel's own rules` uses `peakBarColors`.
- Portable Preset round trip: set `levelMeterPeakBarColors: "levelZones"` on the Workspace panel
  and assert it (and `levelMeterRmsBarColors: "gradient"`) after import.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/agentControl src/transfer`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/agentControl/panelControls.js`, Level Meter branch: replace `barColors: …` with

```js
      peakBarColors: controls.levelMeterPeakBarColors,
      rmsBarColors: controls.levelMeterRmsBarColors,
      momentaryBarColors: controls.levelMeterMomentaryBarColors,
      shortTermBarColors: controls.levelMeterShortTermBarColors,
```

`src/agentControl/panelControlSchema.js`, Level Meter branch:

- Replace `const levelZones = …` and `thresholdsReason` with:

  ```js
  const levelZones = (mode) => controls[LEVEL_METER_BAR_COLORS_KEYS[mode]] === "levelZones";
  const thresholdsReason = (mode, modeReason) =>
    controls.levelMeterMode !== mode ? modeReason : "gradientBarColors";
  const barColors = (title, mode, reason) =>
    active(
      field(
        "string",
        title,
        "Gradient is appearance only; Level Zones color the bar by thresholds or Profile rules.",
        {
          default: defaults[`${mode}BarColors`],
          options: ["gradient", "levelZones"],
        }
      ),
      controls.levelMeterMode === mode,
      reason
    );
  ```

  (import `LEVEL_METER_BAR_COLORS_KEYS` from `../lib/panelControls.js`).

- Replace the `barColors: field(…)` entry with:

  ```js
      peakBarColors: barColors("Peak Bar Colors", "peak", "nonPeakMode"),
      rmsBarColors: barColors("RMS Bar Colors", "rms", "nonRmsMode"),
      momentaryBarColors: barColors("Momentary Bar Colors", "momentary", "nonMomentaryMode"),
      shortTermBarColors: barColors("Short-term Bar Colors", "shortTerm", "nonShortTermMode"),
  ```

- In the threshold entries, replace `&& levelZones` with `&& levelZones("peak")` /
  `&& levelZones("rms")`.

`src/agentControl/panelControlPatch.js`:

- In `LEVEL_METER_FIELDS`, replace `"barColors"` with the four public names.
- Below `LEVEL_METER_BAR_COLORS`, add:

  ```js
  const LEVEL_METER_BAR_COLORS_FIELDS = [
    ["peakBarColors", "levelMeterPeakBarColors", "peak", "nonPeakMode"],
    ["rmsBarColors", "levelMeterRmsBarColors", "rms", "nonRmsMode"],
    ["momentaryBarColors", "levelMeterMomentaryBarColors", "momentary", "nonMomentaryMode"],
    ["shortTermBarColors", "levelMeterShortTermBarColors", "shortTerm", "nonShortTermMode"],
  ];
  ```

- Replace the `barColors` validation with:

  ```js
  for (const [publicKey] of LEVEL_METER_BAR_COLORS_FIELDS) {
    if (hasOwn(patch, publicKey) && !LEVEL_METER_BAR_COLORS.has(patch[publicKey])) {
      issues.push(
        issue("invalidEnum", `$.${publicKey}`, `${publicKey} is not a supported Bar Colors option.`)
      );
    }
  }
  ```

- Replace the `barColors` mapping with:

  ```js
  for (const [publicKey, internalKey] of LEVEL_METER_BAR_COLORS_FIELDS) {
    if (hasOwn(patch, publicKey) && patch[publicKey] !== current[internalKey]) {
      panelControls[internalKey] = patch[publicKey];
      changed.push(`controls.${publicKey}`);
    }
  }
  ```

- Replace the threshold warning block with:

  ```js
  for (const [publicKey, , mode, reason] of LEVEL_METER_BAR_COLORS_FIELDS) {
    if (finalMode !== mode) warn(publicKey, reason);
  }
  const levelZones = (mode) => panelControls[LEVEL_METER_BAR_COLORS_KEYS[mode]] === "levelZones";
  if (finalMode !== "peak") warn("peakThresholdsDbfs", "nonPeakMode");
  else if (!levelZones("peak")) warn("peakThresholdsDbfs", "gradientBarColors");
  if (finalMode !== "rms") warn("rmsThresholdsDbfs", "nonRmsMode");
  else if (!levelZones("rms")) warn("rmsThresholdsDbfs", "gradientBarColors");
  ```

  (import `LEVEL_METER_BAR_COLORS_KEYS`; `DEFAULT_PANEL_CONTROLS`/`normalizePanelControls` are
  already imported from the same module.)

`src/agentControl/dockControl.js`: in `PUBLIC_DOCK_CONTROLS.levelMeter` and in `publicControls`,
replace `barColors` with the four public fields (`peakBarColors: all.peakBarColors`, …).

`docs/agent-control/panels.md`: in the Level Meter effectiveness bullet, replace the `barColors`
wording with: each `*BarColors` field is effective in its own mode; a threshold pair is effective
only when its mode's bar colors is `levelZones`, otherwise it reports `gradientBarColors`.

- [ ] **Step 4: Regenerate and run**

Run: `npm run docs:agent-control`
Run: `npx vitest run`
Expected: PASS (fully green).

- [ ] **Step 5: Commit**

```bash
git add src/agentControl src/transfer docs/agent-control
git commit -m "feat(cli): expose Bar Colors per Level Meter mode" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: User guide

**Files:** `docs/user/panels.md`

- [ ] **Step 1:** In the Level Meter paragraph, change its first sentence "**Bar Colors** chooses
      what the colours mean." to "**Bar Colors** chooses what the colours mean, separately for each
      mode: switching Mode brings back that mode's own choice." Leave the rest unchanged.
- [ ] **Step 2:** Run `npx vitest run scripts/documentationStructure.test.js`. Expected: PASS.
- [ ] **Step 3: Commit**

```bash
git add docs/user/panels.md
git commit -m "docs(level-meter): note Bar Colors is kept per mode" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Verification

- [ ] Run `npm run check`. Expected: exit 0.
- [ ] Manual check for the user (`npm run desktop`): set Peak to Level Zones, switch to Momentary
      (Gradient), back to Peak (Level Zones again); same in the Dock; restart the app and confirm all
      four choices persisted.
