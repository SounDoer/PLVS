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
  "--ui-chart-momentary": "#fb923c",
  "--ui-chart-momentary-snap": "#fcd34d",
  "--ui-chart-momentary-over": "#ff5a1f",
  "--ui-chart-shortterm": "#c66a2a",
  "--ui-chart-spectrum-live-b": "#38bdf8",
  "--ui-signal-tp-max": "#f97373",
  "--ui-meter-grad-bottom": "#34d399",
};

describe("buildThemeTokens", () => {
  it("returns a value for every instrument color token, for every theme", () => {
    const REQUIRED = [
      "--ui-chart-momentary",
      "--ui-chart-momentary-snap",
      "--ui-chart-momentary-over",
      "--ui-chart-shortterm",
      "--ui-chart-shortterm-snap",
      "--ui-chart-shortterm-over",
      "--ui-chart-selection",
      "--ui-chart-vectorscope-live",
      "--ui-chart-vectorscope-snap",
      "--ui-chart-spectrum-live",
      "--ui-chart-spectrum-snap",
      "--ui-chart-spectrum-live-b",
      "--ui-chart-spectrum-snap-b",
      "--ui-chart-waveform-live",
      "--ui-signal-peak-sample",
      "--ui-signal-peak-true",
      "--ui-signal-tp-max",
      "--ui-signal-corr-bad",
      "--ui-signal-corr-good",
      "--ui-signal-corr-mid",
      "--ui-meter-grad-top",
      "--ui-meter-grad-mid",
      "--ui-meter-grad-bottom",
      "--ui-chart-target-line",
      "--ui-metric-row-bg",
      "--ui-metric-row-hover-bg",
      "--ui-metric-row-toggle-on-border",
      "--ui-metric-row-toggle-on-bg",
      "--ui-metric-row-toggle-on-glow",
      "--ui-metric-toggle-on-label",
      "--ui-loudness-history-grid-line",
      "--ui-vs-grid-diag-stroke",
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
    expect(t["--ui-chart-vectorscope-snap"]).toBe(t["--ui-chart-momentary-snap"]);
    expect(t["--ui-chart-spectrum-snap"]).toBe(t["--ui-chart-momentary-snap"]);
    expect(t["--ui-chart-selection"]).toBe(t["--ui-chart-momentary-snap"]);
  });

  it("maps signal seed straight onto meter/peak/correlation", () => {
    const t = buildThemeTokens(BUILTIN_THEMES["plvs-dark"]);
    const { signal } = BUILTIN_THEMES["plvs-dark"].seeds;
    expect(t["--ui-meter-grad-bottom"]).toBe(signal.good);
    expect(t["--ui-meter-grad-mid"]).toBe(signal.warn);
    expect(t["--ui-meter-grad-top"]).toBe(signal.bad);
    expect(t["--ui-signal-tp-max"]).toBe(signal.bad);
    expect(t["--ui-signal-corr-good"]).toBe(signal.good);
  });

  it("uses the muted-foreground reference for correlation mid", () => {
    const t = buildThemeTokens(BUILTIN_THEMES["plvs-dark"]);
    expect(t["--ui-signal-corr-mid"]).toBe("var(--muted-foreground)");
  });
});
