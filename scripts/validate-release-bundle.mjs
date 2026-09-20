#!/usr/bin/env node
/**
 * Verify that a staged release contains exactly the public files PLVS expects and that the updater
 * manifest points back to those same immutable assets.
 *
 * Usage: node scripts/validate-release-bundle.mjs <version> <asset-directory>
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

import { releaseAssetNames } from "./release-assets.mjs";

export function validateReleaseBundle(version, assetDirectory) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }

  const names = releaseAssetNames(version);
  const expectedAssets = [
    names.windowsInstaller,
    names.windowsPortable,
    names.macosDmg,
    names.macosUpdater,
    names.updaterManifest,
  ].sort();
  const actualAssets = readdirSync(assetDirectory).sort();

  if (JSON.stringify(actualAssets) !== JSON.stringify(expectedAssets)) {
    throw new Error(
      `Release asset set mismatch.\nExpected: ${expectedAssets.join(", ")}\nActual: ${actualAssets.join(", ")}`
    );
  }

  for (const asset of actualAssets) {
    if (!statSync(join(assetDirectory, asset)).isFile()) {
      throw new Error(`Release asset is not a file: ${asset}`);
    }
    if (statSync(join(assetDirectory, asset)).size === 0) {
      throw new Error(`Release asset is empty: ${asset}`);
    }
  }

  const manifest = JSON.parse(readFileSync(join(assetDirectory, names.updaterManifest), "utf8"));
  if (manifest.version !== version) {
    throw new Error(
      `Updater manifest version ${manifest.version ?? "<missing>"} does not match ${version}`
    );
  }

  const expectedPlatforms = {
    "darwin-aarch64": names.macosUpdater,
    "windows-x86_64": names.windowsInstaller,
  };
  const actualPlatforms = Object.keys(manifest.platforms ?? {}).sort();
  if (JSON.stringify(actualPlatforms) !== JSON.stringify(Object.keys(expectedPlatforms).sort())) {
    throw new Error(`Unexpected updater platforms: ${actualPlatforms.join(", ")}`);
  }

  for (const [platform, asset] of Object.entries(expectedPlatforms)) {
    const descriptor = manifest.platforms[platform];
    const expectedUrl = `https://github.com/SounDoer/PLVS/releases/download/v${version}/${asset}`;
    if (descriptor?.url !== expectedUrl) {
      throw new Error(`Unexpected ${platform} updater URL: ${descriptor?.url ?? "<missing>"}`);
    }
    if (typeof descriptor.signature !== "string" || descriptor.signature.trim() === "") {
      throw new Error(`Missing ${platform} updater signature`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , version, assetDirectory] = process.argv;
  if (!version || !assetDirectory) {
    console.error("Usage: node scripts/validate-release-bundle.mjs <version> <asset-directory>");
    process.exit(1);
  }

  try {
    validateReleaseBundle(version, assetDirectory);
    console.log(`Validated complete release bundle for v${version}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
