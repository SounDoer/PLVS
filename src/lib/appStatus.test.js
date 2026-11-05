import { describe, expect, it } from "vitest";
import { buildAppStatusItems } from "./appStatus.js";

describe("current app status", () => {
  it("keeps independent conditions together and prioritizes interrupted measurement", () => {
    const items = buildAppStatusItems({
      notice: { kind: "error", text: "Capture Stopped", requiresAttention: true },
      layoutUnknown: true,
      audioDrop: { chunks: 2, since: 0 },
      update: { phase: "error", text: "Update Failed" },
    });
    expect(items.map((item) => item.id)).toEqual([
      "notice",
      "update",
      "audio-drop",
      "channel-layout",
    ]);
    expect(items.filter((item) => item.requiresAttention)).toHaveLength(1);
    expect(items.find((item) => item.id === "audio-drop").details).toContain("Clear to reset");
  });
  it("removes resolved conditions without dismissing other active ones", () => {
    expect(buildAppStatusItems({ layoutUnknown: true })).toHaveLength(1);
    expect(buildAppStatusItems()).toEqual([]);
    expect(
      buildAppStatusItems({ update: { phase: "available", text: "Update Available" } }).map(
        (item) => item.id
      )
    ).toEqual(["update"]);
  });
  it("does not interrupt the dock for ordinary errors or update failures", () => {
    const items = buildAppStatusItems({
      notice: { kind: "error", text: "Could Not Reserve Space" },
      update: { phase: "error", text: "Update Failed" },
    });
    expect(items.some((item) => item.requiresAttention)).toBe(false);
  });
});

it("explains partial native roles without claiming the extra tracks are unused", () => {
  const [item] = buildAppStatusItems({
    layoutUnknown: true,
    autoChannelRoles: ["L", "R", "generic", "generic"],
  });
  expect(item.details).toContain("4-channel stream: 1=L, 2=R");
  expect(item.details).toContain("Other channel roles remain unknown");
  expect(item.details).toContain("channels 1–2 only");
  expect(item.details).toContain("True Peak Max covers every channel");
});
