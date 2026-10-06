#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { comparePngDirectories } from "./ui-visual-compare-lib.mjs";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--before" && args[index + 1]) options.beforeDir = args[(index += 1)];
    else if (value === "--after" && args[index + 1]) options.afterDir = args[(index += 1)];
    else if (value === "--out-dir" && args[index + 1]) options.outDir = args[(index += 1)];
    else {
      throw new Error(
        "Usage: node scripts/ui-visual-compare.mjs --before <directory> --after <directory> --out-dir <directory>"
      );
    }
  }
  if (!options.beforeDir || !options.afterDir || !options.outDir) {
    throw new Error("--before, --after and --out-dir are required.");
  }
  return Object.fromEntries(
    Object.entries(options).map(([key, value]) => [key, resolve(repositoryRoot, value)])
  );
}

async function main() {
  const { beforeDir, afterDir, outDir } = parseArgs(process.argv.slice(2));
  await mkdir(outDir, { recursive: true });
  const report = await comparePngDirectories({ beforeDir, afterDir, diffDir: outDir });
  await writeFile(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
  if (!report.passed) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replaceAll("\\", "/")}`).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
