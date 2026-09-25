import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deriveCommunityCatalogueMetadata } from "../src/transfer/communityCatalogueMetadata.js";

export async function deriveCommunityMetadataFile(path) {
  const bytes = await readFile(path);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (_) {
    throw new Error("Community artifacts must be valid UTF-8 text.");
  }
  return deriveCommunityCatalogueMetadata(text, { fileName: basename(path) });
}

async function main(args) {
  if (args.length !== 1) {
    throw new Error(
      "Usage: npm run community:metadata -- <artifact.plvsloudness|plvspreset|plvstheme>"
    );
  }
  const metadata = await deriveCommunityMetadataFile(resolve(args[0]));
  process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    const report = {
      valid: false,
      code: error?.code ?? "communityMetadataDerivationFailed",
      message: error instanceof Error ? error.message : String(error),
      issues: Array.isArray(error?.issues) ? error.issues : [],
    };
    process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = 1;
  });
}
