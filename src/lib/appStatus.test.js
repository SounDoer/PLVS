import { describe, expect, it } from "vitest";
import { buildAppStatusItems, inferredChannelLayout } from "./appStatus.js";

it("shows the live Mix warning before the retained incomplete notice", () => {
  const mixCapture = { total: 2, unavailable: ["Player"], incomplete: true };
  expect(buildAppStatusItems({ mixCapture })).toEqual([
    expect.objectContaining({
      id: "mix-capture",
      text: "Mix Source Unavailable",
      details: expect.stringContaining("Player"),
    }),
  ]);
  expect(buildAppStatusItems({ mixCapture: { ...mixCapture, unavailable: [] } })[0].text).toBe(
    "Incomplete Mix Measurement"
  );
  expect(
    buildAppStatusItems({ mixCapture: { ...mixCapture, unavailable: ["Player", "DAW"] } })[0]
      .details
  ).toContain("No Mix sources can currently be measured");
});

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

describe("inferred channel layout", () => {
  const eight = { channelCount: 8, loudnessLayoutKnown: true };

  it("reports a surround layout chosen from the channel count alone", () => {
    const layoutInferred = inferredChannelLayout(eight);
    expect(layoutInferred).toEqual({ layoutId: "7.1", name: "7.1", channelCount: 8 });
    const [item] = buildAppStatusItems({ layoutInferred });
    expect(item).toMatchObject({
      id: "channel-layout-inferred",
      kind: "info",
      text: "Channel Layout Inferred",
      helpTopic: "channel-layout-inferred",
      action: "settings",
    });
    expect(item.details).toContain("8 channels as 7.1 by count");
  });

  it("stays quiet when the source or the user supplies the roles, or for mono and stereo", () => {
    const roles = ["L", "R", "C", "LFE", "Lb", "Rb", "Ls", "Rs"];
    expect(inferredChannelLayout({ ...eight, autoChannelRoles: roles })).toBeNull();
    expect(inferredChannelLayout({ ...eight, manualRoles: roles })).toBeNull();
    expect(inferredChannelLayout({ channelCount: 2, loudnessLayoutKnown: true })).toBeNull();
    expect(inferredChannelLayout({ channelCount: 8, loudnessLayoutKnown: false })).toBeNull();
    expect(inferredChannelLayout({ channelCount: 12, loudnessLayoutKnown: true })).toBeNull();
  });

  it("leaves an unknown layout to the stronger unknown-layout warning", () => {
    const items = buildAppStatusItems({
      layoutUnknown: true,
      layoutInferred: { name: "7.1", channelCount: 8 },
    });
    expect(items.map((item) => item.id)).toEqual(["channel-layout"]);
  });
});
