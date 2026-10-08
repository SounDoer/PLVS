import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import { makeCustomThemeV2FromBase } from "../theme/customTheme.js";
import { describeEditorDraft, planEditorDraftPatch } from "./editorDraftControl.js";

describe("semantic editor draft control", () => {
  it("describes only the Theme operations and roles the visible editor owns", () => {
    const description = describeEditorDraft("theme");

    expect(description).toMatchObject({
      kind: "theme",
      history: { undo: true, redo: true },
      operations: expect.arrayContaining([
        "setName",
        "setCoreColor",
        "applyPalettePreset",
        "setOverrideReference",
      ]),
    });
    expect(description.coreKeys).toEqual([
      "workspace",
      "surface",
      "text",
      "interfaceAccent",
      "primaryData",
      "secondaryData",
    ]);
    expect(description.overrideRoles.find(({ id }) => id === "waveform.trace")).toMatchObject({
      modes: ["color", "reference"],
      references: ["core.primaryData", "core.secondaryData"],
    });
    expect(description.overrideRoles.some(({ id }) => id === "data.primary")).toBe(false);
    expect(description.operationSchemas.setCoreColor).toEqual({
      required: ["op", "key", "color"],
      properties: {
        op: { const: "setCoreColor" },
        key: { enum: description.coreKeys },
        color: { type: "cssColor" },
      },
      additionalProperties: false,
    });
  });

  it("plans one atomic Theme transaction from closed semantic operations", () => {
    const current = makeCustomThemeV2FromBase(
      BUILTIN_THEMES_V2["plvs-dark"],
      "Before",
      () => "custom-test"
    );
    const planned = planEditorDraftPatch("theme", current, {
      operations: [
        { op: "setName", name: "After" },
        { op: "setCoreColor", key: "workspace", color: "#111111" },
        { op: "applyPalettePreset", palette: "frequency", presetId: "frequency-plvs" },
        {
          op: "setOverrideReference",
          roleId: "waveform.trace",
          sourceRoleId: "core.secondaryData",
        },
      ],
    });

    expect(planned.issues).toEqual([]);
    expect(planned.changed).toBe(true);
    expect(planned.document).toMatchObject({
      id: "custom-test",
      name: "After",
      core: { workspace: "#111111" },
      palettes: {
        frequency: {
          presetId: "frequency-plvs",
          low: "#ff2d3d",
          mid: "#fb923c",
          high: "#356dff",
        },
      },
      overrides: {
        "waveform.trace": { kind: "reference", source: "core.secondaryData" },
      },
    });
    expect(current.name).toBe("Before");
  });

  it("plans Profile rules with metric-change threshold clearing", () => {
    const planned = planEditorDraftPatch(
      "loudnessProfile",
      {
        id: "draft",
        name: "Before",
        referenceLufs: null,
        rules: [{ metricId: "integrated", op: ">", value: -22, severity: "fail" }],
      },
      {
        operations: [
          { op: "setName", name: "Broadcast" },
          { op: "setReferenceLufs", value: -23 },
          { op: "updateRule", index: 0, patch: { metricId: "shortTerm" } },
          {
            op: "addRule",
            rule: { metricId: "truePeak", op: ">", value: -1, severity: "warn" },
          },
          { op: "reorderRules", order: [1, 0] },
        ],
      }
    );

    expect(planned).toMatchObject({
      issues: [],
      changed: true,
      document: {
        id: "draft",
        name: "Broadcast",
        referenceLufs: -23,
        rules: [
          { metricId: "truePeak", op: ">", value: -1, severity: "warn" },
          { metricId: "shortTerm", op: ">", severity: "fail" },
        ],
      },
    });
  });

  it("uses the visible metric precision for supplied Profile thresholds", () => {
    const planned = planEditorDraftPatch(
      "loudnessProfile",
      { id: "draft", name: "Before", referenceLufs: null, rules: [] },
      {
        operations: [
          {
            op: "addRule",
            rule: { metricId: "integrated", op: ">", value: -22.149, severity: "warn" },
          },
        ],
      }
    );

    expect(planned.document.rules[0].value).toBe(-22.1);
  });

  it("rejects unknown operations without returning a partially changed document", () => {
    const current = {
      id: "draft",
      name: "Before",
      referenceLufs: null,
      rules: [],
    };
    const planned = planEditorDraftPatch("loudnessProfile", current, {
      operations: [
        { op: "setName", name: "Would have changed" },
        { op: "setReactState", path: "anything", value: true },
      ],
    });

    expect(planned.issues).toEqual([
      expect.objectContaining({ code: "unknownOperation", path: "$.operations[1].op" }),
    ]);
    expect(planned.document).toBe(current);
    expect(planned.changed).toBe(false);
  });

  it("rejects duplicate and conflicting Theme targets as one atomic batch", () => {
    const current = makeCustomThemeV2FromBase(
      BUILTIN_THEMES_V2["plvs-dark"],
      "Before",
      () => "custom-test"
    );
    const planned = planEditorDraftPatch("theme", current, {
      operations: [
        { op: "setName", name: "First" },
        { op: "setName", name: "Second" },
        { op: "setCoreColor", key: "workspace", color: "#111111" },
        { op: "resetCore" },
        { op: "applyPalettePreset", palette: "status", presetId: "status-plvs" },
        { op: "setPaletteColor", palette: "status", key: "safe", color: "#00ff00" },
      ],
    });

    expect(planned.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "conflictingOperation", path: "$.operations[1]" }),
        expect.objectContaining({ code: "conflictingOperation", path: "$.operations[3]" }),
        expect.objectContaining({ code: "conflictingOperation", path: "$.operations[5]" }),
      ])
    );
    expect(planned.document).toBe(current);
    expect(planned.changed).toBe(false);
  });

  it("rejects extra fields, oversized batches, and conflicting Profile rule edits", () => {
    const current = {
      id: "draft",
      name: "Before",
      referenceLufs: null,
      rules: [{ metricId: "integrated", op: ">", severity: "warn" }],
    };
    const extraField = planEditorDraftPatch("loudnessProfile", current, {
      operations: [{ op: "setName", name: "After", reactState: true }],
    });
    const oversized = planEditorDraftPatch("loudnessProfile", current, {
      operations: Array.from({ length: 65 }, (_, index) => ({
        op: "addRule",
        rule: { metricId: "integrated", op: ">", value: index, severity: "warn" },
      })),
    });
    const ruleConflict = planEditorDraftPatch("loudnessProfile", current, {
      operations: [
        { op: "updateRule", index: 0, patch: { severity: "fail" } },
        { op: "removeRule", index: 0 },
      ],
    });

    expect(extraField.issues).toEqual([
      expect.objectContaining({ code: "unknownField", path: "$.operations[0].reactState" }),
    ]);
    expect(oversized.issues).toEqual([
      expect.objectContaining({ code: "tooManyOperations", path: "$.operations" }),
    ]);
    expect(ruleConflict.issues).toEqual([
      expect.objectContaining({ code: "conflictingOperation", path: "$.operations[1]" }),
    ]);
    expect(extraField.document).toBe(current);
    expect(oversized.document).toBe(current);
    expect(ruleConflict.document).toBe(current);
  });
});
