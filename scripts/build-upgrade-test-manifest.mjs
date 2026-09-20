#!/usr/bin/env node
/**
 * Materialize a private upgrade-test latest.json from { platform, asset, signature } descriptors.
 * Assets are basenames below the private HTTPS server so one signed candidate can be tested in
 * multiple isolated labs without rebuilding it.
 */
import { readFileSync, writeFileSync } from "node:fs";

const [, , version, baseUrlInput, notesFile, outFile, ...descriptorFiles] = process.argv;

if (!version || !baseUrlInput || !notesFile || !outFile || descriptorFiles.length === 0) {
  console.error(
    "Usage: node scripts/build-upgrade-test-manifest.mjs <version> <https-base-url> <notes-file> <out-file> <descriptor.json...>"
  );
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`Upgrade candidate version must be plain semver: ${version}`);
}

const baseUrl = new URL(baseUrlInput.endsWith("/") ? baseUrlInput : `${baseUrlInput}/`);
if (baseUrl.protocol !== "https:") {
  throw new Error("The private upgrade-test server must use HTTPS.");
}

const platforms = {};
for (const file of descriptorFiles) {
  const { platform, asset, signature } = JSON.parse(readFileSync(file, "utf8"));
  if (!platform || !asset || !signature) {
    throw new Error(`Descriptor ${file} is missing platform/asset/signature`);
  }
  if (platform in platforms) throw new Error(`Duplicate upgrade platform: ${platform}`);
  if (asset !== asset.split(/[\\/]/).at(-1) || asset === "." || asset === "..") {
    throw new Error(`Descriptor ${file} asset must be a basename: ${asset}`);
  }
  platforms[platform] = {
    signature,
    url: new URL(encodeURIComponent(asset), baseUrl).toString(),
  };
}

writeFileSync(
  outFile,
  JSON.stringify(
    {
      version,
      notes: readFileSync(notesFile, "utf8"),
      pub_date: new Date().toISOString(),
      platforms,
    },
    null,
    2
  ),
  "utf8"
);
console.log(`Wrote ${outFile} for private upgrade testing.`);
