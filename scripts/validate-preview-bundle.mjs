#!/usr/bin/env node
/** Verify the complete, platform-specific set of tested Preview packages. */
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function previewAssetNames(version, commitSha, platform = "windows") {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid Preview base version: ${version}`);
  }
  if (!/^[0-9a-f]{40}$/.test(commitSha)) {
    throw new Error(`Invalid Preview commit SHA: ${commitSha}`);
  }
  const label = `${version}-preview.${commitSha.slice(0, 7)}`;
  if (platform === "linux") return { deb: `PLVS-Preview_${label}_amd64.deb` };
  if (platform !== "windows") throw new Error(`Unsupported Preview platform: ${platform}`);
  return {
    installer: `PLVS-Preview_${label}_x64-setup.exe`,
    portable: `PLVS-Preview-v${label}-x64-portable.zip`,
  };
}

export function validatePreviewBundle(version, commitSha, assetDirectory, platform = "windows") {
  const names = previewAssetNames(version, commitSha, platform);
  const expected = Object.values(names).sort();
  const actual = readdirSync(assetDirectory).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Preview asset set mismatch.\nExpected: ${expected.join(", ")}\nActual: ${actual.join(", ")}`
    );
  }
  for (const asset of actual) {
    const path = join(assetDirectory, asset);
    if (!statSync(path).isFile()) throw new Error(`Preview asset is not a file: ${asset}`);
    if (statSync(path).size === 0) throw new Error(`Preview asset is empty: ${asset}`);
  }
  return names;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , version, commitSha, assetDirectory, platform = "windows"] = process.argv;
  if (!version || !commitSha || !assetDirectory) {
    console.error(
      "Usage: node scripts/validate-preview-bundle.mjs <version> <commit-sha> <asset-directory> [windows|linux]"
    );
    process.exit(1);
  }
  try {
    validatePreviewBundle(version, commitSha, assetDirectory, platform);
    console.log(`Validated complete Preview bundle for ${commitSha}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
