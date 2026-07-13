import { describe, expect, it } from "vitest";
import {
  acceptAccessorySnapshot,
  createAccessorySnapshot,
  normalizeAccessoryAction,
  normalizeAccessoryPointer,
} from "./accessoryProtocol.js";

describe("Dock accessory protocol", () => {
  it("creates serializable snapshots and rejects stale or cross-surface state", () => {
    const snapshot = createAccessorySnapshot("dock-header", 3, { edge: "top" });
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(acceptAccessorySnapshot(2, snapshot, "dock-header")).toEqual(snapshot);
    expect(acceptAccessorySnapshot(3, snapshot, "dock-header")).toBeNull();
    expect(acceptAccessorySnapshot(0, snapshot, "dock-editor")).toBeNull();
  });

  it("normalizes known semantic actions and pointer messages", () => {
    expect(
      normalizeAccessoryAction({
        surface: "dock-header",
        type: "set-edge",
        revision: 4,
        payload: { edge: "bottom" },
      })
    ).toEqual({
      surface: "dock-header",
      type: "set-edge",
      revision: 4,
      payload: { edge: "bottom" },
    });
    expect(normalizeAccessoryAction({ surface: "dock-header", type: "unknown" })).toBeNull();
    expect(normalizeAccessoryPointer({ surface: "dock-editor", inside: true })).toEqual({
      surface: "dock-editor",
      inside: true,
    });
  });
});
