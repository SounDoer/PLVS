import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { badgeVariants } from "./badge.jsx";
import { buttonVariants } from "./button.jsx";

/** Every app source except tests, keyed by path. */
function appSources() {
  const sources = import.meta.glob("../../**/*.{js,jsx}", {
    query: "?raw",
    import: "default",
    eager: true,
  });
  return Object.fromEntries(Object.entries(sources).filter(([path]) => !path.includes(".test.")));
}

describe("theme color contract", () => {
  it("uses the destructive foreground token for destructive buttons", () => {
    const classes = buttonVariants({ variant: "destructive" });

    expect(classes).toContain("text-destructive-foreground");
    expect(classes).not.toMatch(/(?:^|\s)text-white(?:\s|$)/);
  });

  it("suppresses focus outlines globally rather than per component", () => {
    // The browser draws its own unless something says otherwise, so this one rule
    // carries the whole decision.
    const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
    const base = css.match(/@layer base \{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(base).toMatch(/:focus-visible\s*\{\s*outline:\s*none;\s*\}/);
  });

  it("leaves no per-component focus ring to fight the global rule", () => {
    const offenders = Object.entries(appSources())
      .filter(([, source]) => /focus(?:-visible)?:(?:ring|outline|border-ring)/.test(source))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it("routes technical annotations through the public Annotation Text role", () => {
    const registry = readFileSync(
      new URL("../../theme/themeRoleRegistry.js", import.meta.url),
      "utf8"
    );
    const consumers = [
      "../panels/LoudnessHistoryChart.jsx",
      "../panels/SpectrogramPanel.jsx",
      "../panels/SpectrumPanel.jsx",
      "../panels/StereoMapPanel.jsx",
      "../panels/WaveformPanel.jsx",
      "../panels/LevelMeterPanel.jsx",
      "../../lib/shellLayout.js",
    ];

    expect(registry).toContain('css: ["--ui-text-annotation"]');
    expect(registry).toMatch(/"spectrogram\.axisLabel"[\s\S]*?"interface\.text\.annotation"/);
    for (const path of consumers) {
      expect(readFileSync(new URL(path, import.meta.url), "utf8"), path).toContain(
        "--ui-text-annotation"
      );
    }
  });

  it("never spends the accent surface on hover", () => {
    // `--accent` marks what is currently active. Hover is where the pointer is,
    // which is not the same claim and must not borrow the same color.
    const offenders = Object.entries(appSources())
      .filter(([, source]) => /(?:hover|focus):bg-accent/.test(source))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it("keeps one neutral hover for every transparent-base control", () => {
    // Filled controls use opaque derived colours; transparent controls use muted/50.
    const offenders = Object.entries(appSources())
      .filter(([path]) => !/(?:^|\/)(?:badge|button)\.jsx$/.test(path))
      .filter(([, source]) => /hover:bg-secondary/.test(source))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it("does not attenuate ordinary Border, Input, or semantic text roles a second time", () => {
    const offenders = Object.entries(appSources())
      .filter(([, source]) =>
        /(?:border-(?:border|input)|text-(?:foreground|muted-foreground|popover-foreground))\/[0-9]+/.test(
          source
        )
      )
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it("uses only semantic product elevations", () => {
    const offenders = Object.entries(appSources())
      .filter(([, source]) => /shadow-(?:xs|sm|md|lg|xl|2xl)(?:\s|"|')/.test(source))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it("paints grid lines at the colour the theme resolved for them", () => {
    // Six modules resolve their grid from one role, but each used to dim it again
    // on the way to the canvas -- 0.3 and 0.16 in the 3D floor, 0.08 borrowed
    // from the spectrum's token for the stereo map's baseline. A second strength
    // is a second role now (data.gridSubtle), not an alpha in a draw call.
    const offenders = Object.entries(appSources())
      .filter(([, source]) => /--ui-spectrum-grid-opacity|stroke="var\(--border\)"/.test(source))
      .map(([path]) => path);

    expect(offenders).toEqual([]);

    const loudness = readFileSync(
      new URL("../panels/LoudnessHistoryChart.jsx", import.meta.url),
      "utf8"
    );
    const spectrum = readFileSync(new URL("../panels/SpectrumPanel.jsx", import.meta.url), "utf8");
    const stereoMap = readFileSync(new URL("../panels/StereoMapPlot.jsx", import.meta.url), "utf8");
    const waveform = readFileSync(new URL("../panels/WaveformPanel.jsx", import.meta.url), "utf8");
    expect(loudness).toContain("var(--ui-loudness-grid)");
    expect(spectrum).toContain("var(--ui-spectrum-grid)");
    expect(stereoMap).toContain("themeColors.grid");
    expect(waveform).toContain("themeColors.grid");
  });

  it("keeps timeline Selection ownership local to each module", () => {
    const spectrogram = readFileSync(
      new URL("../panels/SpectrogramPanel.jsx", import.meta.url),
      "utf8"
    );
    const waveform = readFileSync(new URL("../panels/WaveformPanel.jsx", import.meta.url), "utf8");

    expect(spectrogram).toContain("spectrogramTheme.selection");
    expect(waveform).toContain("themeColors.selection");
    expect(spectrogram).not.toContain('stroke="var(--ui-loudness-selection)"');
    expect(waveform).not.toContain('stroke="var(--ui-loudness-selection)"');
  });

  it("keeps Stereo Map geometry independent from Spectrum", () => {
    const stereoMap = readFileSync(new URL("../panels/StereoMapPlot.jsx", import.meta.url), "utf8");

    expect(stereoMap).toContain("--ui-stereo-map-stroke-width");
    expect(stereoMap).not.toContain("--ui-spectrum-stroke-width");
    expect(stereoMap).not.toContain("--ui-stereo-map-fill-opacity");
  });

  it("keeps classic Waveform fill opacity in the Theme Canvas bundle", () => {
    const waveform = readFileSync(new URL("../panels/WaveformPanel.jsx", import.meta.url), "utf8");
    const dockWaveform = readFileSync(
      new URL("../../dock/modules/DockWaveform.jsx", import.meta.url),
      "utf8"
    );
    const layoutPublisher = readFileSync(
      new URL("../../preferences/applyDocumentTheme.js", import.meta.url),
      "utf8"
    );

    expect(waveform).toContain("themeColors.fillOpacity");
    expect(dockWaveform).toContain("themeColors.fillOpacity");
    expect(waveform).not.toContain("--ui-waveform-fill-opacity");
    expect(dockWaveform).not.toContain("--ui-waveform-fill-opacity");
    expect(layoutPublisher).not.toContain("--ui-waveform-fill-opacity");
  });

  it("does not route runtime consumers through the retired shared signal bindings", () => {
    const offenders = Object.entries(appSources())
      .filter(
        ([path]) =>
          !path.includes("/theme/legacy/") &&
          !path.endsWith("/theme/legacyBuiltinThemes.js") &&
          !path.endsWith("/theme/buildThemeTokens.js") &&
          !path.includes("/theme/fixtures/")
      )
      .filter(([, source]) => /--ui-signal-(?:good|warn|bad)/.test(source))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });

  it("publishes semantic Raised and Modal shadows in a colour the theme owns", () => {
    const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");
    const theme = css.match(/@theme[^{]*\{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(theme).toMatch(/--shadow-raised:[^;]*var\(--ui-shadow-color\)/);
    expect(theme).toMatch(/--shadow-modal:[^;]*var\(--ui-shadow-color\)/);
  });

  it("uses the destructive foreground token for destructive badges", () => {
    const classes = badgeVariants({ variant: "destructive" });

    expect(classes).toContain("text-destructive-foreground");
    expect(classes).not.toMatch(/(?:^|\s)text-white(?:\s|$)/);
  });
});
