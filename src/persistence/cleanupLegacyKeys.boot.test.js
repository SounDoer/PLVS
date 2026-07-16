/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanupLegacyKeys, LEGACY_LOCALSTORAGE_KEYS } from "./cleanupLegacyKeys.js";

describe("legacy cleanup does not touch new domains", () => {
  afterEach(() => localStorage.clear());

  it("removes only legacy keys, preserving plvs:settings/plvs:workspace", () => {
    for (const k of LEGACY_LOCALSTORAGE_KEYS) localStorage.setItem(k, "x");
    localStorage.setItem("plvs:settings", JSON.stringify({ referenceLufs: -23 }));
    localStorage.setItem("plvs:workspace", JSON.stringify({ activePresetId: "lls" }));
    cleanupLegacyKeys();
    expect(JSON.parse(localStorage.getItem("plvs:settings"))).toEqual({ referenceLufs: -23 });
    expect(JSON.parse(localStorage.getItem("plvs:workspace"))).toEqual({ activePresetId: "lls" });
    for (const k of LEGACY_LOCALSTORAGE_KEYS) expect(localStorage.getItem(k)).toBeNull();
  });
});
