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

const REVIEWED_REPLACEMENTS = new Set(["--ui-loudness-grid", "--ui-vectorscope-grid-stroke"]);

function legacy(id = "custom-test", builtin = "plvs-dark") {
  return makeCustomThemeFromBase(BUILTIN_THEMES[builtin], "Legacy", () => id);
}

describe("migrateV1Theme", () => {
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
    expect(resolved.canvas["spectrogram.ink"]).toBe(before["--muted-foreground"]);
    expect(resolved.canvas["spectrogram.surfaceInk"]).toBe(before["--foreground"]);
  });

  it("preserves custom alpha-bearing border and input effects", () => {
    const oldTheme = legacy();
    oldTheme.semantic.border = "oklch(0.5 0.1 30 / 23%)";
    oldTheme.semantic.input = "oklch(0.8 0.05 200 / 41%)";
    const migrated = migrateV1Theme(oldTheme);
    const before = resolveV1Theme(oldTheme).css;
    const after = compileTheme(migrated).css;

    expect(after["--border"]).toBe(before["--border"]);
    expect(after["--input"]).toBe(before["--input"]);
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

  it("moves V2 backfills into an explicit, inspectable migration", () => {
    const current = migrateV1Theme(legacy());
    const { formatVersion: _format, semanticsVersion: _semantics, ...body } = current;
    const { interface: _interface, ...palettes } = body.palettes;
    const old = { version: 2, ...body, palettes };

    expect(migrateV2Theme(old)).toEqual(current);
    expect(migrateThemeDocument(old)?.notes).toEqual([
      expect.objectContaining({ code: "split-version-fields" }),
      expect.objectContaining({ code: "seed-interface-critical" }),
    ]);
  });
});
