import { describe, expect, it } from "vitest";
import { changeUpdatePreferences, normalizeUpdatePreferences } from "./updatePreferences.js";

describe("update preferences", () => {
  it("makes no automatic requests before a deliberate choice", () => {
    expect(normalizeUpdatePreferences(undefined)).toEqual({
      choiceMade: false,
      autoCheck: false,
      autoDownload: false,
    });
    expect(normalizeUpdatePreferences({ autoCheck: true, autoDownload: true }).autoCheck).toBe(
      false
    );
  });
  it("turns downloading off with checking and does not restore it when checking returns", () => {
    const enabled = changeUpdatePreferences(null, { autoCheck: true, autoDownload: true });
    const disabled = changeUpdatePreferences(enabled, { autoCheck: false });
    expect(disabled).toEqual({ choiceMade: true, autoCheck: false, autoDownload: false });
    expect(changeUpdatePreferences(disabled, { autoCheck: true }).autoDownload).toBe(false);
  });
  it("records manual-only as a completed choice and rejects nonboolean flags", () => {
    expect(changeUpdatePreferences(null, {})).toEqual({
      choiceMade: true,
      autoCheck: false,
      autoDownload: false,
    });
    expect(
      normalizeUpdatePreferences({ choiceMade: true, autoCheck: "true", autoDownload: 1 }).autoCheck
    ).toBe(false);
  });
});
