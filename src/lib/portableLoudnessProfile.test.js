import { describe, expect, it } from "vitest";
import {
  MAX_PORTABLE_LOUDNESS_PROFILE_NAME_LENGTH,
  MAX_PORTABLE_LOUDNESS_PROFILE_RULES,
  PortableLoudnessProfileError,
  loudnessProfileToPortable,
  portableToStoredLoudnessProfile,
  validatePortableLoudnessProfile,
} from "./portableLoudnessProfile.js";

function portable(overrides = {}) {
  return {
    kind: "plvs-loudness-profile",
    formatVersion: 1,
    semanticsVersion: 1,
    name: "Broadcast",
    referenceLufs: -23,
    rules: [{ metricId: "truePeak", op: ">", value: -1, severity: "fail" }],
    ...overrides,
  };
}

describe("portable Loudness Profile", () => {
  it("strictly validates and canonicalizes the id-free document", () => {
    expect(validatePortableLoudnessProfile(portable({ name: " Broadcast " }))).toEqual(
      portable({ name: "Broadcast" })
    );
  });

  it("round-trips stored content without carrying the local id", () => {
    const stored = {
      id: "local-a",
      name: "Broadcast",
      referenceLufs: -23,
      rules: [{ metricId: "truePeak", op: ">", value: -1, severity: "fail" }],
    };
    const document = loudnessProfileToPortable(stored);
    expect(document).not.toHaveProperty("id");
    expect(portableToStoredLoudnessProfile(document, "incoming-a")).toEqual({
      ...stored,
      id: "incoming-a",
    });
  });

  it("rejects incomplete rules and semantically empty profiles for publication", () => {
    expect(() =>
      validatePortableLoudnessProfile(
        portable({
          referenceLufs: null,
          rules: [{ metricId: "truePeak", op: ">", severity: "fail" }],
        })
      )
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "incompleteRule", path: "$.rules[0].value" }),
        ]),
      })
    );
    expect(() =>
      validatePortableLoudnessProfile(portable({ referenceLufs: null, rules: [] }))
    ).toThrowError(
      expect.objectContaining({
        issues: [expect.objectContaining({ code: "emptyProfile", path: "$" })],
      })
    );
  });

  it("enforces public name and rule-count limits", () => {
    const longName = "x".repeat(MAX_PORTABLE_LOUDNESS_PROFILE_NAME_LENGTH + 1);
    const tooManyRules = Array.from({ length: MAX_PORTABLE_LOUDNESS_PROFILE_RULES + 1 }, () => ({
      metricId: "truePeak",
      op: ">",
      value: -1,
      severity: "fail",
    }));
    for (const input of [portable({ name: longName }), portable({ rules: tooManyRules })]) {
      expect(() => validatePortableLoudnessProfile(input)).toThrow(PortableLoudnessProfileError);
    }
  });

  it("rejects unknown fields and unsupported document versions", () => {
    expect(() =>
      validatePortableLoudnessProfile({ ...portable(), formatVersion: 2, extra: true })
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "unknownField", path: "$.extra" }),
          expect.objectContaining({ code: "unsupportedFormatVersion", path: "$.formatVersion" }),
        ]),
      })
    );
  });
});
