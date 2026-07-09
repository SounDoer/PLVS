import { describe, it, expect } from "vitest";
import { resolveDevice } from "./audioEngineCommands";

const loopback = { id: "lb-aaa", label: "Speakers (loopback)", isLoopback: true };
const tap = { id: "tap-bbb", label: "System Audio", isSystemOutputMonitor: true };
const mic = { id: "cap-ccc", label: "Microphone", isLoopback: false };

describe("resolveDevice", () => {
  it("returns isAutomatic=true when captureDeviceId is 'default'", () => {
    const { isAutomatic } = resolveDevice([mic], "default");
    expect(isAutomatic).toBe(true);
  });

  it("returns isAutomatic=true when captureDeviceId is empty", () => {
    const { isAutomatic } = resolveDevice([mic], "");
    expect(isAutomatic).toBe(true);
  });

  it("prefers isSystemOutputMonitor over isLoopback in automatic mode", () => {
    const { device } = resolveDevice([loopback, tap, mic], "default");
    expect(device.id).toBe(tap.id);
  });

  it("falls back to isLoopback when no monitor device exists", () => {
    const { device } = resolveDevice([loopback, mic], "default");
    expect(device.id).toBe(loopback.id);
  });

  it("falls back to first device when no loopback or monitor exists", () => {
    const { device } = resolveDevice([mic], "default");
    expect(device.id).toBe(mic.id);
  });

  it("returns null when device list is empty in automatic mode", () => {
    const { device } = resolveDevice([], "default");
    expect(device).toBeNull();
  });

  it("returns the matching device when a specific id is given", () => {
    const { device, isAutomatic } = resolveDevice([loopback, mic], mic.id);
    expect(device.id).toBe(mic.id);
    expect(isAutomatic).toBe(false);
  });

  it("falls back to automatic selection when specific id is not found", () => {
    const { device, isAutomatic } = resolveDevice([tap, mic], "lb-unknown");
    expect(isAutomatic).toBe(true);
    expect(device.id).toBe(tap.id);
  });
});
