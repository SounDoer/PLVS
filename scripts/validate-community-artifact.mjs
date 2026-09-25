import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateCommunityArtifactText } from "../src/transfer/communityArtifact.js";

export async function validateCommunityArtifactFile(path) {
  const bytes = await readFile(path);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (_) {
    throw new Error("Community artifacts must be valid UTF-8 text.");
  }
  return validateCommunityArtifactText(text, { fileName: basename(path) });
}

async function main(args) {
  if (args.length !== 1) {
    throw new Error(
      "Usage: npm run community:validate -- <artifact.plvsloudness|plvspreset|plvstheme>"
    );
  }
  const report = await validateCommunityArtifactFile(resolve(args[0]));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    const report = {
      valid: false,
      code: error?.code ?? "communityArtifactValidationFailed",
      message: error instanceof Error ? error.message : String(error),
      issues: Array.isArray(error?.issues) ? error.issues : [],
    };
    process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = 1;
  });
}

export const scriptPath = fileURLToPath(import.meta.url);
