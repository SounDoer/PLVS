import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { sha256File, validateAcceptanceReceipt } from "./update-acceptance-lib.mjs";
import { loadUpdateResult, validateUpdateResult } from "./update-acceptance-evidence.mjs";

const usage = "Usage: node scripts/verify-update-acceptance.mjs <artifact-root> [--run <run-id>]";

export function parseVerifyArguments(args) {
  if (!args[0] || args[0].startsWith("--")) throw new Error(usage);
  let runId = null;
  if (args.length > 1) {
    if (args.length !== 3 || args[1] !== "--run" || !args[2]) throw new Error(usage);
    runId = args[2];
  }
  return { root: path.resolve(args[0]), runId };
}

export function selectRunDirectory(root, runId = null) {
  const runs = path.join(root, "runs");
  if (runId) {
    const selected = path.resolve(runs, runId);
    if (!selected.startsWith(`${path.resolve(runs)}${path.sep}`) || !existsSync(selected)) {
      throw new Error(`Unknown update acceptance run: ${runId}`);
    }
    return selected;
  }
  const candidates = existsSync(runs)
    ? readdirSync(runs)
        .map((name) => path.join(runs, name))
        .filter((directory) => existsSync(path.join(directory, "result.json")))
        .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)
    : [];
  if (!candidates.length) throw new Error("No update acceptance result.json was found");
  return candidates[0];
}

export function verifyUpdateAcceptance({ root, runId = null }) {
  const receipt = JSON.parse(readFileSync(path.join(root, "acceptance.json"), "utf8"));
  validateAcceptanceReceipt(receipt, root);
  for (const entry of receipt.versions) {
    const file = path.resolve(root, entry.file);
    if (sha256File(file) !== entry.sha256) throw new Error(`Package hash changed: ${entry.file}`);
  }
  const runDir = selectRunDirectory(root, runId);
  const result = loadUpdateResult(runDir);
  const validation = validateUpdateResult(result, { root, runDir, receipt });
  return { receipt, result, runDir, ...validation };
}

export function formatVerification({ result, runDir, automatedFailures }) {
  const gaps = result.scenarios.filter((scenario) => scenario.status !== "passed");
  const lines = [
    `Update acceptance: ${result.summary}`,
    `Run: ${runDir}`,
    `Source: ${result.sourceSha}`,
    `Platform: ${result.platform.os}/${result.platform.arch}`,
  ];
  if (automatedFailures.length) lines.push(`Required failures: ${automatedFailures.join(", ")}`);
  if (gaps.length) {
    lines.push("Explicit gaps:");
    for (const gap of gaps)
      lines.push(`- ${gap.id}: ${gap.status}${gap.reason ? ` — ${gap.reason}` : ""}`);
  }
  return lines.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const verification = verifyUpdateAcceptance(parseVerifyArguments(process.argv.slice(2)));
    console.log(formatVerification(verification));
    if (verification.automatedFailures.length || verification.result.summary === "failed") {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
