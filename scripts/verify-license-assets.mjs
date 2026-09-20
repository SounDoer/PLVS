#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LICENSE_ASSETS } from "./license-assets.mjs";

export async function verifyLicenseAssets(packageRoot) {
  for (const asset of LICENSE_ASSETS) {
    const path = join(packageRoot, asset.destination);
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) {
      throw new Error(`License asset is missing or empty: ${path}`);
    }
    const bytes = await readFile(path);
    if (asset.sha256) {
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (actual !== asset.sha256) {
        throw new Error(`License asset ${path} has SHA-256 ${actual}; expected ${asset.sha256}`);
      }
    }
    const content = bytes.toString("utf8");
    for (const marker of asset.markers) {
      if (!content.includes(marker)) {
        throw new Error(`License asset ${path} is missing marker: ${marker}`);
      }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const packageRoot = process.argv[2];
  if (!packageRoot) {
    console.error("Usage: node scripts/verify-license-assets.mjs <package-root>");
    process.exit(2);
  }
  await verifyLicenseAssets(resolve(packageRoot));
  console.log(`Verified ${LICENSE_ASSETS.length} license assets in ${resolve(packageRoot)}`);
}
