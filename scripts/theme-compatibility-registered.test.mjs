import { describe, it, expect } from "vitest";
import { checkThemeCompatibilityRegistered } from "./theme-compatibility-registered.mjs";

function check(compatibility, appVersion = "0.20.0") {
  return checkThemeCompatibilityRegistered({
    appVersion,
    compatibility,
    formatVersion: 1,
    semanticsVersion: 5,
  });
}

describe("checkThemeCompatibilityRegistered", () => {
  it("passes when the current contract names the release that first shipped it", () => {
    expect(check({ "1:5": { minimumAppVersion: "0.20.0", maximumAppVersion: null } })).toEqual({
      ok: true,
      message: 'Theme contract "1:5" requires PLVS 0.20.0 or later',
    });
  });

  it("passes for a contract that shipped in an earlier release", () => {
    expect(check({ "1:5": { minimumAppVersion: "0.9.12", maximumAppVersion: null } }).ok).toBe(
      true
    );
  });

  it("fails an unresolved entry and names the version being released", () => {
    const result = check({ "1:5": { minimumAppVersion: null, maximumAppVersion: null } });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('"1:5" has no minimumAppVersion');
    expect(result.message).toContain('set it to "0.20.0"');
  });

  it("fails when the current contract was never added to the table", () => {
    const result = check({ "1:4": { minimumAppVersion: "0.19.0", maximumAppVersion: null } });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('"1:5" has no minimumAppVersion');
  });

  it.each(["0.20", "v0.20.0", "", 20])("fails the malformed version %j", (minimumAppVersion) => {
    const result = check({ "1:5": { minimumAppVersion, maximumAppVersion: null } });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("expected a version");
  });

  it("fails a minimum newer than the version being released", () => {
    const result = check({ "1:5": { minimumAppVersion: "0.21.0", maximumAppVersion: null } });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("newer than the 0.20.0 being released");
  });

  it("reads the shipped table and the portable contract by default", () => {
    expect(checkThemeCompatibilityRegistered({ appVersion: "0.19.0" }).message).toContain(
      'Theme contract "1:'
    );
  });
});
