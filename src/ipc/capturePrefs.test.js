/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./env.js", () => ({ isTauri: () => false }));

import {
  LEGACY_CAPTURE_DEVICE_LS_KEY,
  loadCaptureDeviceId,
  saveCaptureDeviceId,
} from "./capturePrefs.js";

const STABLE_LOOPBACK_ID = "lb-0123456789abcdef0123456789abcdef";
const STABLE_CAPTURE_ID = "cap-fedcba9876543210fedcba9876543210";

describe("capturePrefs localStorage keys", () => {
  beforeEach(() => localStorage.clear());

  it("uses plvs.captureDeviceId as LEGACY_CAPTURE_DEVICE_LS_KEY", () => {
    expect(LEGACY_CAPTURE_DEVICE_LS_KEY).toBe("plvs.captureDeviceId");
  });

  it.each([STABLE_LOOPBACK_ID, STABLE_CAPTURE_ID])(
    "round-trips current stable device ID %s",
    async (id) => {
      await saveCaptureDeviceId(id);
      expect(await loadCaptureDeviceId()).toBe(id);
      expect(localStorage.getItem(LEGACY_CAPTURE_DEVICE_LS_KEY)).toBe(id);
    }
  );

  it.each(["out:2", "in:7"])("retains legacy ID %s for native migration", async (id) => {
    await saveCaptureDeviceId(id);
    expect(await loadCaptureDeviceId()).toBe(id);
  });

  it("normalizes labels, malformed hashes, and indexes outside the legacy grammar", async () => {
    for (const id of ["Microphone", "lb-short", "cap-Z123", "out:-1"]) {
      await saveCaptureDeviceId(id);
      expect(await loadCaptureDeviceId()).toBe("default");
    }
  });
});
