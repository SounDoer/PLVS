/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { LEGACY_CAPTURE_DEVICE_LS_KEY } from "./capturePrefs.js";

describe("capturePrefs localStorage keys", () => {
  it("uses plvs.captureDeviceId as LEGACY_CAPTURE_DEVICE_LS_KEY", () => {
    expect(LEGACY_CAPTURE_DEVICE_LS_KEY).toBe("plvs.captureDeviceId");
  });
});
