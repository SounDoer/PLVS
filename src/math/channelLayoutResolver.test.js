import { describe, expect, it } from "vitest";

import { resolveChannelLayout } from "./channelLayoutResolver.js";

describe("resolveChannelLayout", () => {
  it("resolves manual stereo preset", () => {
    expect(resolveChannelLayout("stereo")).toEqual({
      mode: "manual",
      setting: "stereo",
      resolved: "stereo",
    });
  });

  it("resolves manual 5.1 preset", () => {
    expect(resolveChannelLayout("5.1")).toEqual({
      mode: "manual",
      setting: "5.1",
      resolved: "5.1",
    });
  });

  it("keeps auto mode with unknown resolved layout (no detector yet)", () => {
    expect(resolveChannelLayout("auto", { channelCount: 6 })).toEqual({
      mode: "auto",
      setting: "auto",
      resolved: "unknown",
    });
  });

  it("resolves manual 7.1 preset", () => {
    expect(resolveChannelLayout("7.1")).toEqual({
      mode: "manual",
      setting: "7.1",
      resolved: "7.1",
    });
  });

  it("treats invalid setting as auto", () => {
    // @ts-expect-error - runtime safety test
    expect(resolveChannelLayout("quad")).toEqual({
      mode: "auto",
      setting: "auto",
      resolved: "unknown",
    });
  });
});
