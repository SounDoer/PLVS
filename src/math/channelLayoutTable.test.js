import { describe, expect, it } from "vitest";
import {
  CHANNEL_ROLES,
  CHANNEL_LAYOUTS,
  layoutIdForRoles,
  layoutsForChannelCount,
  rolesForLayout,
  roleWeight,
  standardLayoutIdForCount,
  weightsForRoles,
} from "./channelLayoutTable.js";

const SURROUND = 10 ** (1.5 / 10);

describe("channelLayoutTable", () => {
  it("weights follow BS.1770-5 Table 4", () => {
    for (const layout of CHANNEL_LAYOUTS) {
      for (const role of layout.roles) {
        const expected =
          role === "LFE" ? 0 : ["Ls", "Rs", "Lw", "Rw"].includes(role) ? SURROUND : 1;
        expect(roleWeight(role), `${layout.id} ${role}`).toBe(expected);
      }
    }
  });

  it("lists layouts with their channel counts", () => {
    expect(CHANNEL_LAYOUTS.map((l) => [l.id, l.roles.length])).toEqual([
      ["mono", 1],
      ["stereo", 2],
      ["lcr", 3],
      ["quad", 4],
      ["5.0", 5],
      ["5.1", 6],
      ["7.0", 7],
      ["7.1", 8],
      ["5.1.2", 8],
      ["5.1.4", 10],
      ["7.1.2", 10],
      ["7.1.4", 12],
      ["9.1.6", 16],
    ]);
  });

  it("matches a role list to a layout only when it is exact", () => {
    const roles = [...rolesForLayout("7.1.4")];
    expect(layoutIdForRoles(roles)).toBe("7.1.4");
    [roles[4], roles[6]] = [roles[6], roles[4]];
    expect(layoutIdForRoles(roles)).toBe(null);
  });

  it("offers both 8-channel layouts for 8 channels", () => {
    expect(layoutsForChannelCount(8).map((l) => l.id)).toEqual(["7.1", "5.1.2"]);
    expect(layoutsForChannelCount(9)).toEqual([]);
  });

  it("returns null weights when a role is unknown", () => {
    expect(weightsForRoles(["L", "Nope"])).toBe(null);
    expect(weightsForRoles(["L", "LFE"])).toEqual([1, 0]);
  });

  it("includes the roles the immersive layouts need", () => {
    const ids = CHANNEL_ROLES.map((r) => r.id);
    for (const id of ["Lw", "Rw", "Ltm", "Rtm"]) {
      expect(ids).toContain(id);
    }
  });

  it("auto-detects by count only up to 8 channels", () => {
    expect(standardLayoutIdForCount(6)).toBe("5.1");
    expect(standardLayoutIdForCount(8)).toBe("7.1");
    expect(standardLayoutIdForCount(12)).toBe(null);
  });
});
