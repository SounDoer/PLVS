/** @vitest-environment jsdom */
// src/persistence/cleanupLegacyKeys.test.js
import { afterEach, describe, expect, it } from "vitest";
import { cleanupLegacyKeys, LEGACY_LOCALSTORAGE_KEYS } from "./cleanupLegacyKeys.js";

describe("cleanupLegacyKeys", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("removes every legacy localStorage key", () => {
    for (const key of LEGACY_LOCALSTORAGE_KEYS) localStorage.setItem(key, "x");
    cleanupLegacyKeys();
    for (const key of LEGACY_LOCALSTORAGE_KEYS) {
      expect(localStorage.getItem(key)).toBeNull();
    }
  });

  it("leaves the new domain keys untouched", () => {
    localStorage.setItem("plvs:settings", "{}");
    localStorage.setItem("plvs:workspace", "{}");
    cleanupLegacyKeys();
    expect(localStorage.getItem("plvs:settings")).toBe("{}");
    expect(localStorage.getItem("plvs:workspace")).toBe("{}");
  });

  it("is idempotent (safe to call when keys are already gone)", () => {
    expect(() => {
      cleanupLegacyKeys();
      cleanupLegacyKeys();
    }).not.toThrow();
  });

  it("covers exactly the five known legacy keys", () => {
    expect(LEGACY_LOCALSTORAGE_KEYS).toEqual([
      "plvs.ui",
      "plvs:workspace:v3",
      "plvs:windowPinned",
      "plvs:closeAction",
      "plvs.captureDeviceId",
    ]);
  });
});
