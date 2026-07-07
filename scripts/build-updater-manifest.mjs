#!/usr/bin/env node
/**
 * Merge per-platform updater descriptor JSON files (each written by a build job:
 * { platform, url, signature }) into one latest.json for tauri-plugin-updater.
 * Usage: node scripts/build-updater-manifest.mjs <version> <notesFile> <outFile> <descriptor1.json> [descriptor2.json ...]
 */
import { readFileSync, writeFileSync } from "node:fs";

const [, , version, notesFile, outFile, ...descriptorFiles] = process.argv;

if (!version || !notesFile || !outFile || descriptorFiles.length === 0) {
  console.error(
    "Usage: node scripts/build-updater-manifest.mjs <version> <notesFile> <outFile> <descriptor.json...>"
  );
  process.exit(1);
}

const notes = readFileSync(notesFile, "utf8");
const platforms = {};

for (const file of descriptorFiles) {
  const { platform, url, signature } = JSON.parse(readFileSync(file, "utf8"));
  if (!platform || !url || !signature) {
    throw new Error(`Descriptor ${file} is missing platform/url/signature`);
  }
  platforms[platform] = { signature, url };
}

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms,
};

writeFileSync(outFile, JSON.stringify(manifest, null, 2), "utf8");
console.log(`Wrote ${outFile} with platforms: ${Object.keys(platforms).join(", ")}`);
