import { describe, expect, it } from "vitest";
import {
  CHANNEL_ROLE_VOCABULARY,
  roleTokensToLabels,
  seedTokensFromLabels,
  sanitizeChannelLabelOverrides,
} from "./channelRoles.js";

describe("CHANNEL_ROLE_VOCABULARY", () => {
  it("includes generic plus surround and Atmos roles, each with id + label", () => {
    const ids = CHANNEL_ROLE_VOCABULARY.map((r) => r.id);
    expect(ids).toContain("generic");
    expect(ids).toContain("L");
    expect(ids).toContain("LFE");
    expect(ids).toContain("Cs");
    expect(ids).toContain("Ltf");
    for (const r of CHANNEL_ROLE_VOCABULARY) {
      expect(typeof r.id).toBe("string");
      expect(r.id.length).toBeGreaterThan(0);
      expect(typeof r.label).toBe("string");
    }
  });
});

describe("roleTokensToLabels", () => {
  it("maps role tokens to labels; generic and unknown become Ch N", () => {
    expect(roleTokensToLabels(["L", "R", "C", "LFE", "Ls", "Rs", "Cs"])).toEqual([
      "L",
      "R",
      "C",
      "LFE",
      "Ls",
      "Rs",
      "Cs",
    ]);
    expect(roleTokensToLabels(["L", "generic", "zzz"])).toEqual(["L", "Ch 2", "Ch 3"]);
  });
});

describe("seedTokensFromLabels", () => {
  it("maps auto labels back to tokens; numbered labels become generic", () => {
    expect(seedTokensFromLabels(["L", "R", "C", "LFE", "Ls", "Rs"])).toEqual([
      "L",
      "R",
      "C",
      "LFE",
      "Ls",
      "Rs",
    ]);
    expect(seedTokensFromLabels(["Ch 1", "Ch 2", "Ch 3"])).toEqual([
      "generic",
      "generic",
      "generic",
    ]);
  });
});

describe("sanitizeChannelLabelOverrides", () => {
  it("keeps valid entries, drops wrong-length / unknown-token / malformed ones", () => {
    const raw = {
      2: ["L", "R"],
      6: ["L", "R", "C", "LFE", "Ls", "Rs"],
      4: ["L", "R", "Ls"], // wrong length
      3: ["L", "R", "nope"], // unknown token
      foo: ["L", "R"], // non-numeric key
      8: "not-an-array",
    };
    expect(sanitizeChannelLabelOverrides(raw)).toEqual({
      2: ["L", "R"],
      6: ["L", "R", "C", "LFE", "Ls", "Rs"],
    });
  });

  it("returns {} for non-object input", () => {
    expect(sanitizeChannelLabelOverrides(null)).toEqual({});
    expect(sanitizeChannelLabelOverrides([1, 2])).toEqual({});
    expect(sanitizeChannelLabelOverrides("x")).toEqual({});
  });
});
