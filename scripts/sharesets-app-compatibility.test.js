import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  checkSharesetsAppCompatibility,
  sharesetsAppRequirement,
} from "./sharesets-app-compatibility.mjs";

const pack = {
  items: [{ workspace: { panels: [{ controls: { orientation: "left-to-right" } }] } }],
};
const features = (minimumAppVersion) => ({
  panelOrientation: { minimumAppVersion, introducedAfter: "0.20.0" },
});

describe("Sharesets app requirements", () => {
  it("uses a short development label until the first supporting version is registered", () => {
    expect(sharesetsAppRequirement(pack, features(null))).toBe("Requires upcoming PLVS");
    expect(sharesetsAppRequirement(pack, features("0.21.0"))).toBe("Requires PLVS 0.21.0+");
    expect(sharesetsAppRequirement(null, features(null))).toBe("Requires PLVS 0.20.0+");
  });

  it.each([null, "", "0.21", "v0.21.0", "0.20.0", "0.19.0", "0.22.0"])(
    "blocks a stable release with minimum %j",
    (minimum) => {
      expect(
        checkSharesetsAppCompatibility({ appVersion: "0.21.0", features: features(minimum) }).ok
      ).toBe(false);
    }
  );

  it("keeps the earliest supporting version when a later app release ships", () => {
    const registry = features("0.21.0");
    for (const appVersion of ["0.21.0", "0.22.0", "1.0.0"]) {
      expect(checkSharesetsAppCompatibility({ appVersion, features: registry }).ok).toBe(true);
      expect(sharesetsAppRequirement(pack, registry)).toBe("Requires PLVS 0.21.0+");
    }
  });

  it("enforces the same requirement locally and in the stable publication workflow", () => {
    const local = readFileSync(new URL("./check-release-state.mjs", import.meta.url), "utf8");
    const workflow = readFileSync(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8"
    );
    expect(local).toContain("checkSharesetsAppCompatibility({ appVersion: version })");
    expect(workflow).toContain("node scripts/sharesets-app-compatibility.mjs");
  });
});
