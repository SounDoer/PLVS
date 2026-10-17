#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  acceptanceReportMarkdown,
  acceptanceRunId,
  buildAcceptanceReport,
  resolveEvidencePath,
  resolveGitSha,
  sha256File,
  validateAcceptanceEvidence,
  writeJsonAtomic,
  writeTextAtomic,
} from "./acceptance-evidence.mjs";

export function parseAcceptanceReportArgs(args) {
  const evidence = [];
  let target = "HEAD";
  let outDir = null;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!new Set(["--evidence", "--target", "--out-dir"]).has(flag)) {
      throw new Error(
        "Usage: npm run acceptance:report -- [--target <sha>] [--evidence <result.json>]... [--out-dir <directory>]"
      );
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    if (flag === "--evidence") evidence.push(resolveEvidencePath(value));
    else if (flag === "--target") target = value;
    else outDir = resolve(value);
    index += 1;
  }
  const targetSha = resolveGitSha(target);
  const output = outDir ?? resolve("artifacts", "acceptance-report", acceptanceRunId());
  return { evidence, targetSha, outDir: output };
}

export async function generateAcceptanceReport({ evidence: paths, targetSha, outDir }) {
  const evidence = paths.map((file) => {
    const value = validateAcceptanceEvidence(JSON.parse(readFileSync(file, "utf8")));
    return { file, sha256: sha256File(file), value };
  });
  const report = buildAcceptanceReport({ targetSha, evidence });
  const jsonPath = join(outDir, "report.json");
  const markdownPath = join(outDir, "report.md");
  await mkdir(outDir, { recursive: true });
  await writeJsonAtomic(jsonPath, report);
  await writeTextAtomic(markdownPath, acceptanceReportMarkdown(report, markdownPath));
  return { report, jsonPath, markdownPath };
}

async function main() {
  const options = parseAcceptanceReportArgs(process.argv.slice(2));
  const { report, jsonPath, markdownPath } = await generateAcceptanceReport(options);
  console.log(`Acceptance evidence: ${report.verdict}`);
  console.log(`Ready              : ${report.ready}`);
  console.log(`JSON               : ${jsonPath}`);
  console.log(`Markdown           : ${markdownPath}`);
  if (!report.ready) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(`Acceptance report failed: ${error.message}`);
    process.exitCode = 2;
  });
}
