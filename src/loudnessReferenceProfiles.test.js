import { describe, expect, it } from "vitest";
import {
  LOUDNESS_REFERENCE_PROFILE_IDS,
  getDefaultLoudnessReferenceProfileId,
  getLoudnessReferenceProfileById,
  normalizeLoudnessReferenceProfileId,
} from "./loudnessReferenceProfiles";

describe("loudnessReferenceProfiles", () => {
  it("defaults to EBU R128 -23", () => {
    expect(getDefaultLoudnessReferenceProfileId()).toBe(
      LOUDNESS_REFERENCE_PROFILE_IDS.ebuR128Minus23
    );
    expect(getLoudnessReferenceProfileById(undefined).id).toBe(
      LOUDNESS_REFERENCE_PROFILE_IDS.ebuR128Minus23
    );
  });

  it("normalizes invalid ids to default", () => {
    expect(normalizeLoudnessReferenceProfileId(null)).toBe(getDefaultLoudnessReferenceProfileId());
    expect(normalizeLoudnessReferenceProfileId("not-a-real-profile")).toBe(
      getDefaultLoudnessReferenceProfileId()
    );
  });

  it("returns profile by id", () => {
    const p = getLoudnessReferenceProfileById(LOUDNESS_REFERENCE_PROFILE_IDS.ebuR128Minus23);
    expect(p.targetLufs).toBe(-23);
    expect(p.label.toLowerCase()).toContain("ebu");
  });
});
