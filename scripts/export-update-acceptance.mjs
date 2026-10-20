import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { verifyUpdateAcceptance } from "./verify-update-acceptance.mjs";

const usage =
  "Usage: node scripts/export-update-acceptance.mjs <artifact-root> <output-directory> [--run <run-id>]";

export function exportUpdateAcceptance({ root, output, runId = null }) {
  const source = path.resolve(root);
  const destination = path.resolve(output);
  if (existsSync(destination)) throw new Error(`Output already exists: ${destination}`);
  const verification = verifyUpdateAcceptance({ root: source, runId });
  mkdirSync(destination, { recursive: true });
  for (const name of ["acceptance.json", "acceptance.key.pub"]) {
    const file = path.join(source, name);
    if (existsSync(file)) copyFileSync(file, path.join(destination, name));
  }
  for (const entry of verification.receipt.versions) {
    const from = path.resolve(source, entry.file);
    const to = path.resolve(destination, entry.file);
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(from, to);
    if (existsSync(`${from}.sig`)) copyFileSync(`${from}.sig`, `${to}.sig`);
  }
  const exportedRun = path.join(destination, "runs", verification.result.runId);
  mkdirSync(path.dirname(exportedRun), { recursive: true });
  cpSync(verification.runDir, exportedRun, { recursive: true });
  verifyUpdateAcceptance({ root: destination, runId: verification.result.runId });
  return destination;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 && !(args.length === 4 && args[2] === "--run")) {
      throw new Error(usage);
    }
    const output = exportUpdateAcceptance({
      root: args[0],
      output: args[1],
      runId: args[3] ?? null,
    });
    const receipt = JSON.parse(readFileSync(path.join(output, "acceptance.json"), "utf8"));
    console.log(`Exported ${receipt.platform.os} update acceptance: ${output}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
