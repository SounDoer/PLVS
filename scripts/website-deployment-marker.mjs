import { readFile, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

import { SITE_REPOSITORY } from "./resolve-website-deployment.mjs";
import { validateWebsiteMarker } from "./website-publication.mjs";

const [mode, path, pageUrl] = process.argv.slice(2);
const repository = process.env.GITHUB_REPOSITORY;

async function write() {
  const { PRODUCT_SHA, WEBSITE_SOURCE_SHA, CONTENT_SHA, POLICY_SHA } = process.env;
  const marker = validateWebsiteMarker(
    {
      schemaVersion: 1,
      repository,
      websiteSha: PRODUCT_SHA,
      productSha: PRODUCT_SHA,
      siteRepository: SITE_REPOSITORY,
      siteSourceSha: WEBSITE_SOURCE_SHA,
      contentSha: CONTENT_SHA,
      policySha: POLICY_SHA,
    },
    repository
  );
  await writeFile(path, JSON.stringify(marker, null, 2) + "\n");
}

async function verify() {
  const expected = validateWebsiteMarker(JSON.parse(await readFile(path, "utf8")), repository);
  async function markerAt(relativePath) {
    const url = new URL(relativePath, pageUrl);
    url.searchParams.set("verify", String(Date.now()));
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { "Cache-Control": "no-cache" },
    });
    if (!response.ok) throw new Error("HTTP " + response.status + " for " + relativePath);
    return response.json();
  }
  let failure;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const [live, catalogue] = await Promise.all([
        markerAt("publication.json"),
        markerAt("sharesets/publication.json"),
      ]);
      if (
        !Object.keys(expected).every((key) => live[key] === expected[key]) ||
        catalogue.schemaVersion !== 1 ||
        catalogue.repository !== repository ||
        catalogue.commitSha !== expected.contentSha
      ) {
        throw new Error("Live website or Catalogue identity does not match the deployed artifact");
      }
      console.log(JSON.stringify(expected, null, 2));
      return;
    } catch (error) {
      failure = error;
      if (attempt < 5) await setTimeout(5_000);
    }
  }
  throw failure;
}

try {
  if (mode === "write" && path && !pageUrl) await write();
  else if (mode === "verify" && path && pageUrl) await verify();
  else
    throw new Error("Usage: website-deployment-marker.mjs write <file> | verify <file> <page-url>");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
