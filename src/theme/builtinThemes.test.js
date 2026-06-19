import { describe, it, expect } from "vitest";
import { UI_PREFERENCES } from "../preferences/data.js";
import { BUILTIN_THEMES, THEME_IDS } from "./builtinThemes.js";
import { buildThemeTokens } from "./buildThemeTokens.js";

function hexToRgb(hex) {
  const matched = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!matched) return null;

  const value = Number.parseInt(matched[1], 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function colorDistance(a, b) {
  const rgbA = hexToRgb(a);
  const rgbB = hexToRgb(b);
  if (!rgbA || !rgbB) return 0;

  return Math.hypot(rgbA.r - rgbB.r, rgbA.g - rgbB.g, rgbA.b - rgbB.b);
}

function expectHexColor(value) {
  expect(value).toMatch(/^#[0-9a-f]{6}$/i);
}

function getSnapshotTokens(themeId) {
  const t = buildThemeTokens(BUILTIN_THEMES[themeId]);
  return {
    momentaryLive: t["--ui-loudness-momentary"],
    momentarySnap: t["--ui-loudness-momentary-snap"],
    shortTermLive: t["--ui-loudness-shortterm"],
    shortTermSnap: t["--ui-loudness-shortterm-snap"],
    vectorscopeLive: t["--ui-vectorscope-trace"],
    vectorscopeSnap: t["--ui-vectorscope-trace-snap"],
    spectrumLive: t["--ui-spectrum-primary"],
    spectrumSnap: t["--ui-spectrum-primary-snap"],
    spectrumLiveB: t["--ui-spectrum-secondary"],
    spectrumSnapB: t["--ui-spectrum-secondary-snap"],
  };
}

describe("BUILTIN_THEMES", () => {
  it("contains exactly plvs-dark and plvs-light", () => {
    expect(THEME_IDS).toContain("plvs-dark");
    expect(THEME_IDS).toContain("plvs-light");
    expect(THEME_IDS).not.toContain("plvs-phosphor");
    expect(THEME_IDS).not.toContain("plvs-tungsten");
    expect(THEME_IDS).not.toContain("plvs-abyss");
    expect(THEME_IDS).toHaveLength(2);
  });

  it("defines distinct loudness history trace tokens for every theme", () => {
    for (const themeId of THEME_IDS) {
      const tokens = buildThemeTokens(BUILTIN_THEMES[themeId]);
      const loudnessHistory = UI_PREFERENCES.modules.loudness.history;

      const momentary = tokens["--ui-loudness-momentary"];
      const momentaryOver = tokens["--ui-loudness-momentary-over"];
      const shortTerm = tokens["--ui-loudness-shortterm"];
      const shortTermOver = tokens["--ui-loudness-shortterm-over"];

      expectHexColor(momentary);
      expectHexColor(momentaryOver);
      expectHexColor(shortTerm);
      expectHexColor(shortTermOver);

      expect(momentaryOver).not.toBe(momentary);
      expect(shortTermOver).not.toBe(shortTerm);
      expect(colorDistance(momentary, momentaryOver)).toBeGreaterThanOrEqual(45);
      expect(colorDistance(shortTerm, shortTermOver)).toBeGreaterThanOrEqual(45);

      expect(momentary).not.toBe(shortTerm);
      expect(Number(loudnessHistory.momentaryStrokeWidth)).toBeGreaterThan(0);
      expect(Number(loudnessHistory.shortTermStrokeWidth)).toBeGreaterThan(0);
      expect(
        Number(loudnessHistory.shortTermStrokeWidth) / Number(loudnessHistory.momentaryStrokeWidth)
      ).toBeGreaterThanOrEqual(1.75);
      expect(colorDistance(momentary, shortTerm)).toBeGreaterThanOrEqual(45);
    }
  });

  it("defines one visually distinct chart snapshot family for every theme", () => {
    for (const themeId of THEME_IDS) {
      const tokens = getSnapshotTokens(themeId);

      for (const value of Object.values(tokens)) {
        expectHexColor(value);
      }

      expect(tokens.momentarySnap).toBe(tokens.vectorscopeSnap);
      expect(tokens.momentarySnap).toBe(tokens.spectrumSnap);

      expect(colorDistance(tokens.momentaryLive, tokens.momentarySnap)).toBeGreaterThanOrEqual(45);
      expect(colorDistance(tokens.shortTermLive, tokens.shortTermSnap)).toBeGreaterThanOrEqual(45);
      expect(colorDistance(tokens.vectorscopeLive, tokens.vectorscopeSnap)).toBeGreaterThanOrEqual(
        45
      );
      expect(colorDistance(tokens.spectrumLive, tokens.spectrumSnap)).toBeGreaterThanOrEqual(45);

      expect(tokens.shortTermSnap).not.toBe(tokens.momentarySnap);
      expect(colorDistance(tokens.shortTermSnap, tokens.momentarySnap)).toBeGreaterThanOrEqual(25);
      expect(colorDistance(tokens.shortTermSnap, tokens.momentarySnap)).toBeLessThanOrEqual(120);
    }
  });

  it("defines a distinct secondary spectrum color", () => {
    for (const themeId of THEME_IDS) {
      const tokens = buildThemeTokens(BUILTIN_THEMES[themeId]);
      const spectrumLiveB = tokens["--ui-spectrum-secondary"];
      const spectrumLive = tokens["--ui-spectrum-primary"];
      const spectrumSnapB = tokens["--ui-spectrum-secondary-snap"];

      expect(typeof spectrumLiveB).toBe("string");
      expect(spectrumLiveB.length).toBeGreaterThan(0);
      expect(spectrumLiveB).not.toBe(spectrumLive);
      expect(typeof spectrumSnapB).toBe("string");
      expect(spectrumSnapB.length).toBeGreaterThan(0);
    }
  });
});
