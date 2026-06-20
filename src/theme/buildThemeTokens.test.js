import { describe, it, expect } from "vitest";
import { BUILTIN_THEMES, THEME_IDS } from "./builtinThemes.js";
import { buildThemeTokens } from "./buildThemeTokens.js";

function dist(a, b) {
  const pa = parseInt(a.replace("#", "").slice(0, 6), 16);
  const pb = parseInt(b.replace("#", "").slice(0, 6), 16);
  return Math.hypot(
    ((pa >> 16) & 255) - ((pb >> 16) & 255),
    ((pa >> 8) & 255) - ((pb >> 8) & 255),
    (pa & 255) - (pb & 255)
  );
}

const DARK_ANCHORS = {
  "--ui-loudness-momentary": "#fb923c",
  "--ui-loudness-momentary-snap": "#fcd34d",
  "--ui-loudness-momentary-over": "#ff5a1f",
  "--ui-loudness-shortterm": "#c66a2a",
  "--ui-spectrum-secondary": "#38bdf8",
  "--ui-signal-tp-max": "#f97373",
  "--ui-meter-gradient-bottom": "#34d399",
};

describe("buildThemeTokens", () => {
  it("returns a value for every instrument color token, for every theme", () => {
    const REQUIRED = [
      "--ui-loudness-momentary",
      "--ui-loudness-momentary-snap",
      "--ui-loudness-momentary-over",
      "--ui-loudness-shortterm",
      "--ui-loudness-shortterm-snap",
      "--ui-loudness-shortterm-over",
      "--ui-loudness-selection",
      "--ui-loudness-grid",
      "--ui-vectorscope-trace",
      "--ui-vectorscope-trace-snap",
      "--ui-vectorscope-grid-stroke",
      "--ui-spectrum-primary",
      "--ui-spectrum-primary-snap",
      "--ui-spectrum-secondary",
      "--ui-spectrum-secondary-snap",
      "--ui-waveform-trace",
      "--ui-signal-peak-sample",
      "--ui-signal-tp-max",
      "--ui-signal-bad",
      "--ui-signal-warn",
      "--ui-meter-gradient-top",
      "--ui-meter-gradient-mid",
      "--ui-meter-gradient-bottom",
    ];
    for (const id of THEME_IDS) {
      const tokens = buildThemeTokens(BUILTIN_THEMES[id]);
      for (const key of REQUIRED) {
        expect(tokens[key], `${id} ${key}`).toBeTruthy();
      }
    }
  });

  it("derives dark tokens close to the current anchors", () => {
    const t = buildThemeTokens(BUILTIN_THEMES["plvs-dark"]);
    for (const [key, anchor] of Object.entries(DARK_ANCHORS)) {
      expect(dist(t[key], anchor), `${key} ~ ${anchor} got ${t[key]}`).toBeLessThanOrEqual(30);
    }
  });

  it("ties the snap family to one shared snap color", () => {
    const t = buildThemeTokens(BUILTIN_THEMES["plvs-dark"]);
    expect(t["--ui-vectorscope-trace-snap"]).toBe(t["--ui-loudness-momentary-snap"]);
    expect(t["--ui-spectrum-primary-snap"]).toBe(t["--ui-loudness-momentary-snap"]);
    expect(t["--ui-loudness-selection"]).toBe(t["--ui-loudness-momentary-snap"]);
  });

  it("maps signal seed straight onto meter and tp-max", () => {
    const t = buildThemeTokens(BUILTIN_THEMES["plvs-dark"]);
    const { signal } = BUILTIN_THEMES["plvs-dark"].seeds;
    expect(t["--ui-meter-gradient-bottom"]).toBe(signal.good);
    expect(t["--ui-meter-gradient-mid"]).toBe(signal.warn);
    expect(t["--ui-meter-gradient-top"]).toBe(signal.bad);
    expect(t["--ui-signal-tp-max"]).toBe(signal.bad);
    expect(t["--ui-signal-bad"]).toBe(signal.bad);
    expect(t["--ui-signal-warn"]).toBe(signal.warn);
  });
});
