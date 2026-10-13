import { appendFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function publicationMarker(repository, commitSha) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) {
    throw new Error("Invalid publication repository.");
  }
  if (!/^[0-9a-f]{40}$/.test(commitSha ?? "")) {
    throw new Error("Publication requires an exact commit SHA.");
  }
  return { schemaVersion: 1, repository, commitSha };
}

export async function resolvePublishedSharesets({ host, repository, fetchImpl = fetch }) {
  if (!/^[a-z0-9.-]+$/i.test(host ?? "")) throw new Error("Invalid publication host.");
  const response = await fetchImpl(
    `https://${host}/sharesets/publication.json?publication=${Date.now()}`,
    {
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
      headers: { "Cache-Control": "no-cache" },
    }
  );
  // A missing marker on a published Catalogue must never reset its history to empty.
  if (response.status === 404) {
    throw new Error(
      "Sharesets publication marker is missing; recover its exact baseline before deploying."
    );
  }
  if (response.status !== 200)
    throw new Error(`Cannot read Sharesets publication marker (HTTP ${response.status}).`);
  const raw = await response.json();
  if (raw?.schemaVersion !== 1 || raw.repository !== repository) {
    throw new Error("Sharesets publication marker has an unsupported schema or repository.");
  }
  return publicationMarker(raw.repository, raw.commitSha);
}

async function main(args) {
  if (args[0] === "resolve" && args.length === 2) {
    const result = await resolvePublishedSharesets({
      host: (await readFile(args[1], "utf8")).trim(),
      repository: process.env.GITHUB_REPOSITORY,
    });
    await appendFile(process.env.GITHUB_OUTPUT, `ref=${result.commitSha}\n`);
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
