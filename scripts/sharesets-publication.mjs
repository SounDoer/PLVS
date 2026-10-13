import { appendFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Last markerless public site: v0.19.0, whose Catalogue manifest is empty. It predates the rename
// to Sharesets, so its Catalogue is served at /community/ and stored under community/.
export const SHARESETS_BOOTSTRAP_COMMIT = "a953766217e6ebeceac264ba86e10f4b69eeabcd";
export const SHARESETS_BOOTSTRAP_PAGE = "/community/";
export const SHARESETS_BOOTSTRAP_CATALOGUE = "community/catalogue";
export const SHARESETS_CATALOGUE = "sharesets/catalogue";

export function publicationMarker(repository, commitSha) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) {
    throw new Error("Invalid publication repository.");
  }
  if (!/^[0-9a-f]{40}$/.test(commitSha ?? "")) {
    throw new Error("Publication requires an exact commit SHA.");
  }
  return { schemaVersion: 1, repository, commitSha };
}

export async function resolvePublishedSharesets({
  host,
  repository,
  allowBootstrap = false,
  fetchImpl = fetch,
}) {
  if (!/^[a-z0-9.-]+$/i.test(host ?? "")) throw new Error("Invalid publication host.");
  const request = (path) =>
    fetchImpl(`https://${host}${path}?publication=${Date.now()}`, {
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
      headers: { "Cache-Control": "no-cache" },
    });
  const response = await request("/sharesets/publication.json");
  if (response.status === 404) {
    if (!allowBootstrap)
      throw new Error(
        "Sharesets publication marker is missing. Only the first empty-site publication may explicitly enable bootstrap."
      );
    // A missing marker on a populated Catalogue must never reset its history to empty.
    const page = await request(SHARESETS_BOOTSTRAP_PAGE);
    if (page.status !== 200) throw new Error("Cannot verify the markerless Sharesets Catalogue.");
    const html = await page.text();
    if (
      !html.includes("Nothing published yet") ||
      /data-catalogue-grid|\/(?:community|sharesets)\/files\//.test(html)
    ) {
      throw new Error(
        "Published Sharesets content has no version marker; recover its exact baseline before deploying."
      );
    }
    return {
      ...publicationMarker(repository, SHARESETS_BOOTSTRAP_COMMIT),
      cataloguePath: SHARESETS_BOOTSTRAP_CATALOGUE,
      bootstrap: true,
    };
  }
  if (response.status !== 200)
    throw new Error(`Cannot read Sharesets publication marker (HTTP ${response.status}).`);
  const raw = await response.json();
  if (raw?.schemaVersion !== 1 || raw.repository !== repository) {
    throw new Error("Sharesets publication marker has an unsupported schema or repository.");
  }
  return {
    ...publicationMarker(raw.repository, raw.commitSha),
    cataloguePath: SHARESETS_CATALOGUE,
    bootstrap: false,
  };
}

async function main(args) {
  if (args[0] === "resolve" && args.length === 2) {
    const result = await resolvePublishedSharesets({
      host: (await readFile(args[1], "utf8")).trim(),
      repository: process.env.GITHUB_REPOSITORY,
      allowBootstrap: process.env.ALLOW_SHARESETS_BOOTSTRAP === "true",
    });
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `ref=${result.commitSha}\npath=${result.cataloguePath}\nbootstrap=${result.bootstrap}\n`
    );
  } else if (args[0] === "write" && args.length === 3) {
    await writeFile(
      args[1],
      `${JSON.stringify(publicationMarker(process.env.GITHUB_REPOSITORY, args[2]), null, 2)}\n`
    );
  } else {
    throw new Error(
      "Usage: sharesets-publication.mjs resolve <CNAME> | write <marker-path> <commit-sha>"
    );
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
