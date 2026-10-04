import { describe, expect, it } from "vitest";

import { BUILTIN_THEMES } from "../builtinThemes.js";
import { compileTheme } from "../compileTheme.js";
import { makeCustomThemeFromBase } from "../customTheme.js";
import { resolveV1Theme } from "../legacy/resolveV1Theme.js";
import { isCurrentThemeDocument } from "../themeSchema.js";
import {
  migrateThemeDocument,
  migrateV1Theme,
  migrateV2Theme,
  normalizeThemeDocument,
} from "./migrateV1Theme.js";

const REVIEWED_REPLACEMENTS = new Set([
  "--ui-activity-snapshot",
  "--ui-loudness-momentary-snap",
  "--ui-loudness-shortterm",
  "--ui-loudness-shortterm-snap",
  "--ui-loudness-selection",
  "--ui-spectrum-primary-snap",
  "--ui-spectrum-secondary-snap",
  "--ui-stereo-map-primary-snap",
  "--ui-stereo-map-secondary-snap",
  "--ui-vectorscope-trace-snap",
  "--ui-waveform-trace-snap",
  "--ui-loudness-grid",
  "--ui-vectorscope-guides-stroke",
  "--border",
  "--input",
]);

function legacy(id = "custom-test", builtin = "plvs-dark") {
  return makeCustomThemeFromBase(BUILTIN_THEMES[builtin], "Legacy", () => id);
}

describe("migrateV1Theme", () => {
  it.each([1, 2, 3])(
    "retires selection overrides from semantics %s without mutating the source",
    (semanticsVersion) => {
      const current = migrateV1Theme(legacy());
      const raw = {
        ...current,
        semanticsVersion,
        overrides: {
          "interface.surface.selected": { kind: "color", value: "#ff0000" },
          "interface.content.onSelected": { kind: "color", value: "#ffffff" },
          "interface.text.secondary": { kind: "color", value: "#888888" },
        },
      };
      const before = structuredClone(raw);
      const result = normalizeThemeDocument(raw);
      expect(result.overrides).toEqual({
        "interface.text.secondary": { kind: "color", value: "#888888" },
      });
      expect(compileTheme(result).css["--accent"]).toBeUndefined();
      expect(compileTheme(result).roles["interface.content.onSelected"]).toBeUndefined();
      expect(raw).toEqual(before);
      expect(() =>
        compileTheme(
          normalizeThemeDocument({
            ...raw,
            overrides: { "unknown.role": { kind: "color", value: "#ffffff" } },
          })
        )
      ).toThrow();
    }
  );
  it.each(["plvs-dark", "plvs-light"])("preserves comparable %s output", (builtin) => {
    const oldTheme = legacy(`custom-${builtin}`, builtin);
    const migrated = migrateV1Theme(oldTheme);
    const before = resolveV1Theme(oldTheme).css;
    const after = compileTheme(migrated).css;

    expect(isCurrentThemeDocument(migrated)).toBe(true);
    for (const [binding, value] of Object.entries(after)) {
      if (!(binding in before) || REVIEWED_REPLACEMENTS.has(binding)) continue;
      expect(value, binding).toBe(before[binding]);
    }
    const resolved = compileTheme(migrated);
    expect(after["--border"]).toBe(builtin === "plvs-dark" ? "#2a2a2a" : "#ddd9d6");
    expect(after["--input"]).toBe(after["--border"]);
    expect(resolved.canvas["spectrogram.ink"]).toBe(before["--muted-foreground"]);
    expect(resolved.canvas["spectrogram.surfaceInk"]).toBe(before["--foreground"]);
  });

  it("flattens the former compiler-owned border effect and unifies input borders", () => {
    const oldTheme = legacy();
    oldTheme.semantic.border = "oklch(0.5 0.1 30 / 23%)";
    oldTheme.semantic.input = "oklch(0.8 0.05 200 / 41%)";
    const migrated = migrateV1Theme(oldTheme);
    const before = resolveV1Theme(oldTheme).css;
    const after = compileTheme(migrated).css;

    expect(after["--border"]).toBe("#201a19");
    expect(after["--input"]).toBe("#201a19");
    expect(after["--border"]).not.toBe(before["--border"]);
    expect(after["--input"]).not.toBe(before["--input"]);
  });

  it("keeps Interface Accent and Primary Data as independent V2 fields", () => {
    const migrated = migrateV1Theme(legacy());
    expect(migrated.core.interfaceAccent).toBe("#fb923c");
    expect(migrated.core.primaryData).toBe("#fb923c");
    expect(migrated.core).not.toBe(migrated.core.interfaceAccent);
  });

  it("uses one ingress for legacy and current documents and rejects malformed data", () => {
    const migrated = migrateV1Theme(legacy());
    expect(normalizeThemeDocument(legacy())).toEqual(migrated);
    expect(normalizeThemeDocument(migrated)).toEqual(migrated);
    expect(normalizeThemeDocument({ id: "custom-bad" })).toBeNull();
    expect(normalizeThemeDocument({ version: 99 })).toBeNull();
    expect(migrateV1Theme({ ...legacy(), colormap: [[0, [0, 0, 0]]] })).toBeNull();
  });

  it("migrates semantics 1 Grid overrides into the clarified roles", () => {
    const current = migrateV1Theme(legacy());
    const semantics1 = {
      ...current,
      semanticsVersion: 1,
      overrides: {
        ...current.overrides,
        "vectorscope.grid": { kind: "color", value: "#123456" },
        "waveform.grid": { kind: "color", value: "#234567" },
        "spectrogram.gridSubtle": { kind: "color", value: "#345678" },
      },
    };

    const migrated = migrateThemeDocument(semantics1);
    expect(migrated?.theme).toMatchObject({
      semanticsVersion: 3,
      overrides: { "vectorscope.guides": { kind: "color", value: "#123456" } },
    });
    expect(migrated?.theme.overrides).not.toHaveProperty("vectorscope.grid");
    expect(migrated?.theme.overrides).not.toHaveProperty("waveform.grid");
    expect(migrated?.theme.overrides).not.toHaveProperty("spectrogram.gridSubtle");
    expect(migrated?.notes).toEqual([expect.objectContaining({ code: "clarify-grid-semantics" })]);
  });

  it("moves V2 backfills into an explicit, inspectable migration", () => {
    const current = migrateV1Theme(legacy());
    const { formatVersion: _format, semanticsVersion: _semantics, ...body } = current;
    const { interface: _interface, status, ...otherPalettes } = body.palettes;
    const old = {
      version: 2,
      ...body,
      palettes: {
        ...otherPalettes,
        status: {
          presetId: status.presetId,
          good: status.safe,
          warning: status.warning,
          critical: status.critical,
        },
      },
    };

    expect(migrateV2Theme(old)).toMatchObject({
      formatVersion: 2,
      semanticsVersion: 3,
      palettes: {
        status: { safe: current.palettes.status.safe },
        interface: {
          success: current.palettes.status.safe,
          warning: current.palettes.status.warning,
          danger: current.palettes.status.critical,
        },
      },
    });
    expect(migrateThemeDocument(old)?.notes).toEqual([
      expect.objectContaining({ code: "split-version-fields" }),
      expect.objectContaining({ code: "seed-interface-feedback" }),
    ]);
  });
});
