import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readCommunitySource } from "./community-catalogue-source.mjs";

export async function validateCommunitySourceDirectory(path = resolve("community", "catalogue")) {
  const source = await readCommunitySource(path);
  return {
    valid: true,
    schemaVersion: source.manifest.schemaVersion,
    contentRoot: source.root,
    listingCount: source.listings.length,
    listingPaths: source.listings.map(({ sourcePath }) => sourcePath),
  };
}

async function main(args) {
  if (args.length > 1) {
    throw new Error("Usage: npm run community:source:check -- [content-directory]");
  }
  const report = await validateCommunitySourceDirectory(args[0]);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${JSON.stringify(
        {
          valid: false,
          code: error?.code ?? "communitySourceValidationFailed",
          message: error instanceof Error ? error.message : String(error),
          issues: Array.isArray(error?.issues) ? error.issues : [],
        },
        null,
        2
      )}\n`
    );
    process.exitCode = 1;
  });
}
