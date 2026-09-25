import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import { buildPack, PackValidationError } from "./packShape.js";
import { validatePublishablePack } from "./communityPack.js";

const PROFILE = {
  id: "broadcast",
  name: "Broadcast",
  referenceLufs: -23,
  rules: [{ metricId: "truePeak", op: ">", value: -1, severity: "fail" }],
};

describe("Community Pack publication validation", () => {
  it("returns one canonical Loudness Profile and derived compatibility facts", () => {
    const result = validatePublishablePack(buildPack("loudness", [PROFILE]), "loudness");
    expect(result).toMatchObject({
      type: "loudness",
      primaryItem: PROFILE,
      portableItem: { kind: "plvs-loudness-profile", name: "Broadcast" },
      assessment: {
        compatibility: { metricIds: ["truePeak"] },
        communityPublication: { eligible: true, blockers: [] },
      },
    });
  });

  it("accepts a publishable portable Theme through the same boundary", () => {
    const theme = {
      ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]),
      id: "custom-community",
      name: "Community",
    };
    expect(validatePublishablePack(buildPack("themes", [theme]), "themes")).toMatchObject({
      type: "themes",
      portableItem: { kind: "plvs-theme", name: "Community" },
    });
  });

  it("rejects Pack V1 and a multi-item desktop pack", () => {
    expect(() =>
      validatePublishablePack(
        { app: "PLVS", kind: "loudness-pack", version: 1, items: [PROFILE] },
        "loudness"
      )
    ).toThrowError(
      expect.objectContaining({
        issues: [expect.objectContaining({ code: "unsupportedPackVersion", path: "$.version" })],
      })
    );
    expect(() =>
      validatePublishablePack(
        buildPack("loudness", [PROFILE, { ...PROFILE, id: "other" }]),
        "loudness"
      )
    ).toThrowError(
      expect.objectContaining({
        issues: [expect.objectContaining({ code: "invalidPrimaryItemCount", path: "$.items" })],
      })
    );
  });

  it("keeps Preset publication closed until Portable Preset V1 lands", () => {
    expect(() =>
      validatePublishablePack(
        { app: "PLVS", kind: "preset-pack", version: 2, items: [{}], dependencies: [] },
        "presets"
      )
    ).toThrow(PackValidationError);
  });
});
