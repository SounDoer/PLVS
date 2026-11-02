import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SHARESETS_APP_FEATURES,
  checkSharesetsAppCompatibility,
  sharesetsAppRequirement,
} from "./sharesets-app-compatibility.mjs";

const pack = {
  items: [{ workspace: { panels: [{ controls: { orientation: "left-to-right" } }] } }],
};
const dockPack = (aboveFullScreen) => ({
  items: [{ workspace: { panels: [] }, dock: { enabled: true, aboveFullScreen } }],
});
const features = (minimumAppVersion) => ({
  panelOrientation: { ...SHARESETS_APP_FEATURES.panelOrientation, minimumAppVersion },
});

describe("Sharesets app requirements", () => {
  it("uses a short development label until the first supporting version is registered", () => {
    expect(sharesetsAppRequirement(pack, features(null))).toBe("Requires upcoming PLVS");
    expect(sharesetsAppRequirement(pack, features("0.21.0"))).toBe("Requires PLVS 0.21.0+");
    expect(sharesetsAppRequirement(null, features(null))).toBe("Requires PLVS 0.20.0+");
  });

  it("requires the base version for a pack using no registered feature", () => {
    expect(sharesetsAppRequirement(dockPack(undefined))).toBe("Requires PLVS 0.20.0+");
  });

  it("keeps panelOrientation at 0.21.0", () => {
    expect(sharesetsAppRequirement(pack)).toBe("Requires PLVS 0.21.0+");
  });

  it("reads Requires upcoming PLVS for Dock aboveFullScreen false while unassigned", () => {
    expect(SHARESETS_APP_FEATURES.dockAboveFullScreen).toMatchObject({
      minimumAppVersion: null,
      introducedAfter: "0.24.0",
    });
    expect(sharesetsAppRequirement(dockPack(false))).toBe("Requires upcoming PLVS");
  });

  it("lets the highest assigned minimum win", () => {
    const both = {
      items: [{ ...pack.items[0], dock: { enabled: true, aboveFullScreen: false } }],
    };
    const registry = {
      ...SHARESETS_APP_FEATURES,
      dockAboveFullScreen: {
        ...SHARESETS_APP_FEATURES.dockAboveFullScreen,
        minimumAppVersion: "0.25.0",
      },
    };
    expect(sharesetsAppRequirement(both, registry)).toBe("Requires PLVS 0.25.0+");
    expect(sharesetsAppRequirement(pack, registry)).toBe("Requires PLVS 0.21.0+");
  });

  it("blocks a stable release while dockAboveFullScreen is unassigned", () => {
    expect(checkSharesetsAppCompatibility({ appVersion: "0.25.0" })).toMatchObject({ ok: false });
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
