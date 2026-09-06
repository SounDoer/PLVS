import { describe, expect, it, vi } from "vitest";
import { LOUDNESS_PROFILE_OFF, profileSelectionId } from "./loudnessProfileCatalog.js";
import {
  LoudnessProfileDocumentError,
  planLoudnessProfileCreate,
  planLoudnessProfileDelete,
  planLoudnessProfileRename,
  planLoudnessProfileReorder,
  planLoudnessProfileSelect,
  planLoudnessProfileUpdate,
  validateLoudnessProfileDocument,
} from "./loudnessProfileLibrary.js";

const PROFILE_A = {
  id: "profile-a",
  name: "A",
  referenceLufs: -23,
  rules: [{ metricId: "integrated", op: ">", value: -22.5, severity: "fail" }],
};
const PROFILE_B = { id: "profile-b", name: "B", referenceLufs: null, rules: [] };

function state(active = LOUDNESS_PROFILE_OFF) {
  return { active, profiles: [PROFILE_A, PROFILE_B] };
}

function authoring(overrides = {}) {
  return {
    name: "  Broadcast  ",
    referenceLufs: -24,
    rules: [
      { metricId: "truePeak", op: ">", value: -1, severity: "warn" },
      { metricId: "lra", op: "<", severity: "fail" },
    ],
    ...overrides,
  };
}

describe("Loudness Profile authoring validation", () => {
  it("returns the normalized id-free document and preserves an omitted rule value", () => {
    expect(validateLoudnessProfileDocument(authoring())).toEqual({
      name: "Broadcast",
      referenceLufs: -24,
      rules: [
        { metricId: "truePeak", op: ">", value: -1, severity: "warn" },
        { metricId: "lra", op: "<", severity: "fail" },
      ],
    });
  });

  it("rejects every detectable issue in stable document order", () => {
    let error;
    try {
      validateLoudnessProfileDocument({
        name: "   ",
        referenceLufs: -71,
        rules: [
          {
            metricId: "missing",
            op: "=",
            value: Number.POSITIVE_INFINITY,
            severity: "maybe",
            x: 1,
          },
          null,
        ],
        id: "caller-owned",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(LoudnessProfileDocumentError);
    expect(error.issues).toEqual([
      expect.objectContaining({ code: "invalidName", path: "$.name" }),
      expect.objectContaining({ code: "outOfRange", path: "$.referenceLufs" }),
      expect.objectContaining({ code: "unknownField", path: "$.rules[0].x" }),
      expect.objectContaining({ code: "unknownMetric", path: "$.rules[0].metricId" }),
      expect.objectContaining({ code: "invalidOperator", path: "$.rules[0].op" }),
      expect.objectContaining({ code: "invalidNumber", path: "$.rules[0].value" }),
      expect.objectContaining({ code: "invalidSeverity", path: "$.rules[0].severity" }),
      expect.objectContaining({ code: "invalidRule", path: "$.rules[1]" }),
      expect.objectContaining({ code: "unknownField", path: "$.id" }),
    ]);
  });

  it("rejects non-objects, missing fields, and explicit non-numeric empty values", () => {
    for (const input of [null, [], "profile"]) {
      expect(() => validateLoudnessProfileDocument(input)).toThrow(LoudnessProfileDocumentError);
    }
    expect(() =>
      validateLoudnessProfileDocument({
        name: "A",
        referenceLufs: null,
        rules: [
          {
            metricId: "truePeak",
            op: ">",
            value: null,
            severity: "fail",
          },
        ],
      })
    ).toThrow(LoudnessProfileDocumentError);
    try {
      validateLoudnessProfileDocument({});
    } catch (error) {
      expect(error.issues.map(({ path }) => path)).toEqual([
        "$.name",
        "$.referenceLufs",
        "$.rules",
      ]);
    }
  });
});

describe("Loudness Profile library planning", () => {
  it("selects a Profile or Off, dirties an active Preset, and detects no-ops", () => {
    const presets = { list: [], activeId: "preset-a", dirty: false };
    const selected = planLoudnessProfileSelect(state(), presets, "profile-a");
    expect(selected).toMatchObject({
      issues: [],
      changed: ["loudnessProfiles.active", "presets.dirty"],
      from: null,
      to: "profile-a",
      presets: { activeId: "preset-a", dirty: true },
    });
    expect(selected.loudnessProfiles.active).toBe(profileSelectionId("profile-a"));

    const noOp = planLoudnessProfileSelect(
      selected.loudnessProfiles,
      selected.presets,
      "profile-a"
    );
    expect(noOp.changed).toEqual([]);
    expect(noOp.loudnessProfiles).toBe(selected.loudnessProfiles);
    expect(
      planLoudnessProfileSelect(selected.loudnessProfiles, selected.presets, "off").to
    ).toBeNull();
    expect(planLoudnessProfileSelect(state(), presets, "missing").issues).toEqual([
      expect.objectContaining({ code: "loudnessProfileNotFound", path: "$.profileId" }),
    ]);
  });

  it("plans dry-run create without allocating an ID and real create with an injected unique ID", () => {
    const makeId = vi.fn(() => "profile-new");
    const current = state();
    const preview = planLoudnessProfileCreate(
      current,
      { list: [], activeId: null, dirty: false },
      authoring()
    );
    expect(preview.issues).toEqual([]);
    expect(preview.profile).toBeUndefined();
    expect(preview.document).toMatchObject({ name: "Broadcast" });
    expect(preview.selectCreated).toBe(true);
    expect(preview.loudnessProfiles).toBe(current);

    const planned = planLoudnessProfileCreate(
      state(),
      { list: [], activeId: "preset-a", dirty: false },
      authoring(),
      { makeId }
    );
    expect(makeId).toHaveBeenCalledTimes(1);
    expect(planned.profile).toMatchObject({ id: "profile-new", name: "Broadcast" });
    expect(planned.loudnessProfiles.profiles).toHaveLength(3);
    expect(planned.loudnessProfiles.active).toBe(profileSelectionId("profile-new"));
    expect(planned.presets.dirty).toBe(true);
    expect(state().profiles).toEqual([PROFILE_A, PROFILE_B]);
  });

  it("refuses a generated duplicate ID without changing either input", () => {
    const current = state();
    const presets = { list: [], activeId: null, dirty: false };
    const planned = planLoudnessProfileCreate(current, presets, authoring(), {
      makeId: () => "profile-a",
    });
    expect(planned.issues).toEqual([
      expect.objectContaining({ code: "duplicateProfileId", path: "$.profile.id" }),
    ]);
    expect(planned.loudnessProfiles).toBe(current);
    expect(planned.presets).toBe(presets);
  });

  it("updates complete normalized content in place while preserving selection and detects no-ops", () => {
    const current = state(profileSelectionId("profile-b"));
    const planned = planLoudnessProfileUpdate(current, "profile-a", authoring());
    expect(planned.issues).toEqual([]);
    expect(planned.profile).toEqual({
      id: "profile-a",
      ...validateLoudnessProfileDocument(authoring()),
    });
    expect(planned.loudnessProfiles.active).toBe(profileSelectionId("profile-b"));
    expect(planned.loudnessProfiles.profiles.map(({ id }) => id)).toEqual([
      "profile-a",
      "profile-b",
    ]);

    const noOp = planLoudnessProfileUpdate(
      planned.loudnessProfiles,
      "profile-a",
      authoring({ name: " Broadcast " })
    );
    expect(noOp.changed).toEqual([]);
    expect(noOp.loudnessProfiles).toBe(planned.loudnessProfiles);
  });

  it("renames with trimming, preserves selection and position, and validates the target", () => {
    const current = state(profileSelectionId("profile-b"));
    const planned = planLoudnessProfileRename(current, "profile-a", "  B  ");
    expect(planned.profile).toMatchObject({ id: "profile-a", name: "B" });
    expect(planned.loudnessProfiles.active).toBe(current.active);
    expect(planned.loudnessProfiles.profiles[0].id).toBe("profile-a");
    expect(planLoudnessProfileRename(current, "missing", "Name").issues[0].code).toBe(
      "loudnessProfileNotFound"
    );
    expect(planLoudnessProfileRename(current, "profile-a", " ").issues[0].code).toBe("invalidName");
  });

  it("deletes a Profile, falls back to Off, rewrites every Preset reference, and reports IDs", () => {
    const current = state(profileSelectionId("profile-a"));
    const presets = {
      list: [
        { id: "preset-a", name: "A", loudnessProfileActive: profileSelectionId("profile-a") },
        { id: "preset-b", name: "B", loudnessProfileActive: profileSelectionId("profile-b") },
        { id: "preset-c", name: "C", loudnessProfileActive: profileSelectionId("profile-a") },
      ],
      activeId: "preset-b",
      dirty: false,
    };
    const planned = planLoudnessProfileDelete(current, presets, "profile-a");
    expect(planned).toMatchObject({
      issues: [],
      selectionFallsBackToOff: true,
      affectedPresetIds: ["preset-a", "preset-c"],
      deletedProfile: PROFILE_A,
      presets: { activeId: "preset-b", dirty: true },
    });
    expect(planned.loudnessProfiles).toEqual({ active: "off", profiles: [PROFILE_B] });
    expect(planned.presets.list.map(({ loudnessProfileActive }) => loudnessProfileActive)).toEqual([
      "off",
      profileSelectionId("profile-b"),
      "off",
    ]);
    expect(current).toEqual(state(profileSelectionId("profile-a")));
    expect(presets.list[0].loudnessProfileActive).toBe(profileSelectionId("profile-a"));
  });

  it("deletes an inactive Profile without changing selection or dirty state", () => {
    const presets = {
      list: [{ id: "preset-a", loudnessProfileActive: profileSelectionId("profile-a") }],
      activeId: "preset-a",
      dirty: false,
    };
    const planned = planLoudnessProfileDelete(
      state(profileSelectionId("profile-b")),
      presets,
      "profile-a"
    );
    expect(planned.selectionFallsBackToOff).toBe(false);
    expect(planned.presets.dirty).toBe(false);
    expect(planLoudnessProfileDelete(state(), presets, "missing").issues[0].code).toBe(
      "loudnessProfileNotFound"
    );
  });

  it("requires reorder to be an exact permutation and preserves objects", () => {
    const current = state(profileSelectionId("profile-a"));
    const planned = planLoudnessProfileReorder(current, ["profile-b", "profile-a"]);
    expect(planned.issues).toEqual([]);
    expect(planned.loudnessProfiles.profiles).toEqual([PROFILE_B, PROFILE_A]);
    expect(planned.loudnessProfiles.active).toBe(current.active);
    const noOp = planLoudnessProfileReorder(current, ["profile-a", "profile-b"]);
    expect(noOp.changed).toEqual([]);
    expect(noOp.loudnessProfiles).toBe(current);

    for (const invalid of [
      ["profile-a"],
      ["profile-a", "profile-a"],
      ["profile-a", "missing"],
      ["profile-a", 3],
    ]) {
      expect(planLoudnessProfileReorder(current, invalid).issues).toEqual([
        expect.objectContaining({ code: "invalidPermutation", path: "$.profileIds" }),
      ]);
    }
  });
});
