#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MULTICHANNEL_MONITORING_PRESET } from "../src/sharesets-preview/multichannelMonitoringPreset.js";

export function buildMultichannelMonitoringPack() {
  return {
    app: "PLVS",
    kind: "preset-pack",
    version: 2,
    items: [{ id: "multichannel-monitoring", ...MULTICHANNEL_MONITORING_PRESET }],
    dependencies: [],
  };
}

export async function syncMultichannelMonitoringPreset() {
  const path = resolve(
    "sharesets",
    "catalogue",
    "artifacts",
    "multichannel-monitoring-v1.plvspreset"
  );
  await writeFile(path, `${JSON.stringify(buildMultichannelMonitoringPack(), null, 2)}\n`, "utf8");
  return path;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  syncMultichannelMonitoringPreset()
    .then((path) => process.stdout.write(`Wrote ${path}\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    });
}
