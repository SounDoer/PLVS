import { describe, expect, it } from "vitest";
import { resolveChannelLayout } from "./channelLayoutResolver.js";

describe("resolveChannelLayout", () => {
  // --- manual presets (unchanged) ---
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

  // --- auto-detection ---
  it("auto: 1ch → mono", () => {
    expect(resolveChannelLayout("auto", { channelCount: 1 })).toEqual({
      mode: "auto",
      setting: "auto",
      resolved: "mono",
    });
  });
  it("auto: 2ch → stereo", () => {
    expect(resolveChannelLayout("auto", { channelCount: 2 })).toEqual({
      mode: "auto",
      setting: "auto",
      resolved: "stereo",
    });
  });
  it("auto: 6ch → 5.1", () => {
    expect(resolveChannelLayout("auto", { channelCount: 6 })).toEqual({
      mode: "auto",
      setting: "auto",
      resolved: "5.1",
    });
  });
  it("auto: 8ch → 7.1", () => {
    expect(resolveChannelLayout("auto", { channelCount: 8 })).toEqual({
      mode: "auto",
      setting: "auto",
      resolved: "7.1",
    });
  });
  it("auto: 0ch (not running) → unknown", () => {
    expect(resolveChannelLayout("auto", { channelCount: 0 })).toEqual({
      mode: "auto",
      setting: "auto",
      resolved: "unknown",
    });
  });
  it("auto: 3ch → unknown", () => {
    expect(resolveChannelLayout("auto", { channelCount: 3 })).toEqual({
      mode: "auto",
      setting: "auto",
      resolved: "unknown",
    });
  });
  it("auto: 5ch → unknown", () => {
    expect(resolveChannelLayout("auto", { channelCount: 5 })).toEqual({
      mode: "auto",
      setting: "auto",
      resolved: "unknown",
    });
  });
  it("auto: 7ch → unknown", () => {
    expect(resolveChannelLayout("auto", { channelCount: 7 })).toEqual({
      mode: "auto",
      setting: "auto",
      resolved: "unknown",
    });
  });
  it("auto: no ctx → unknown", () => {
    expect(resolveChannelLayout("auto")).toEqual({
      mode: "auto",
      setting: "auto",
      resolved: "unknown",
    });
  });
});
