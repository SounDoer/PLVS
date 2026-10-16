import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { presetUsesPanelOrientation } from "./preset-presentation.mjs";

export const SHARESETS_MINIMUM_APP_VERSION = "0.20.0";

// Record the FIRST stable release supporting a feature; never track the latest app version.
// null is allowed during development, but blocks a stable release.
export const SHARESETS_APP_FEATURES = {
  panelOrientation: { minimumAppVersion: null, introducedAfter: "0.20.0" },
};

const validVersion = (value) =>
  typeof value === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
const compare = (left, right) => {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

export function sharesetsAppRequirement(pack, features = SHARESETS_APP_FEATURES) {
  if (!presetUsesPanelOrientation(pack)) return `Requires PLVS ${SHARESETS_MINIMUM_APP_VERSION}+`;
  const minimum = features.panelOrientation?.minimumAppVersion;
  if (minimum == null) return "Requires upcoming PLVS";
  if (!validVersion(minimum)) throw new Error("Invalid panelOrientation minimumAppVersion");
  return `Requires PLVS ${minimum}+`;
}

export function checkSharesetsAppCompatibility({ appVersion, features = SHARESETS_APP_FEATURES }) {
  if (!validVersion(appVersion)) return { ok: false, message: "Invalid release version" };
  for (const [feature, { minimumAppVersion: minimum, introducedAfter }] of Object.entries(
    features
  )) {
    if (
      !validVersion(minimum) ||
      compare(minimum, introducedAfter) <= 0 ||
      compare(minimum, appVersion) > 0
    ) {
      return {
        ok: false,
        message: `Register ${feature}'s first supported stable version in SHARESETS_APP_FEATURES (scripts/sharesets-app-compatibility.mjs): minimumAppVersion must be after ${introducedAfter} and no later than ${appVersion}.`,
      };
    }
  }
  return { ok: true, message: "Sharesets feature minimum app versions are registered" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const appVersion = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8")
  ).version;
  const result = checkSharesetsAppCompatibility({ appVersion });
  console.log(result.message);
  if (!result.ok) process.exitCode = 1;
}
