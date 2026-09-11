import { describe, expect, it } from "vitest";
import { describeActiveLoudnessProfile } from "./activeLoudnessProfile.js";

const broadcast = { id: "p1", name: "Broadcast", referenceLufs: -23, rules: [] };

describe("describeActiveLoudnessProfile", () => {
  it("is null when no profile document is in force", () => {
    expect(
      describeActiveLoudnessProfile({ active: "off", document: null, draft: null })
    ).toBeNull();
    expect(describeActiveLoudnessProfile({})).toBeNull();
  });

  it("describes the selected saved profile", () => {
    expect(
      describeActiveLoudnessProfile({ active: "profile:p1", document: broadcast, draft: null })
    ).toEqual({ mode: "saved", id: "p1", name: "Broadcast", document: broadcast });
  });

  it("describes an open draft as preview under the id being edited", () => {
    const edited = { ...broadcast, name: "Broadcast (editing)" };
    expect(
      describeActiveLoudnessProfile({
        active: "profile:p1",
        document: edited,
        draft: { editingId: "p1", document: edited, dirty: true },
      })
    ).toEqual({ mode: "preview", id: "p1", name: "Broadcast (editing)", document: edited });
  });

  it("gives a new, never-saved draft no id", () => {
    expect(
      describeActiveLoudnessProfile({
        active: "off",
        document: broadcast,
        draft: { editingId: null, document: broadcast, dirty: false },
      }).id
    ).toBeNull();
  });
});
