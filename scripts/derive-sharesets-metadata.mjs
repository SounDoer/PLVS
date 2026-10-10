import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deriveSharesetsCatalogueMetadata } from "../src/transfer/sharesetsContract.js";

export async function deriveSharesetsMetadataFile(path) {
  const bytes = await readFile(path);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (_) {
    throw new Error("Sharesets artifacts must be valid UTF-8 text.");
  }
  return deriveSharesetsCatalogueMetadata(text, { fileName: basename(path) });
}

async function main(args) {
  if (args.length !== 1) {
    throw new Error(
      "Usage: npm run sharesets:metadata -- <artifact.plvsloudness|plvspreset|plvstheme>"
    );
  }
  const metadata = await deriveSharesetsMetadataFile(resolve(args[0]));
  process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    const report = {
      valid: false,
      code: error?.code ?? "sharesetsMetadataDerivationFailed",
      message: error instanceof Error ? error.message : String(error),
      issues: Array.isArray(error?.issues) ? error.issues : [],
    };
    process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = 1;
  });
}
