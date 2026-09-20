#!/usr/bin/env node

import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LICENSE_ASSETS } from "./license-assets.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function stageLicenseAssets(destinationRoot) {
  for (const asset of LICENSE_ASSETS) {
    const destination = join(destinationRoot, asset.destination);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(repoRoot, asset.source), destination);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destinationRoot = process.argv[2];
  if (!destinationRoot) {
    console.error("Usage: node scripts/stage-license-assets.mjs <destination-root>");
    process.exit(2);
  }
  await stageLicenseAssets(resolve(destinationRoot));
  console.log(`Staged ${LICENSE_ASSETS.length} license assets in ${resolve(destinationRoot)}`);
}
