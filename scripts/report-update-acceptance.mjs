import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { verifyUpdateAcceptance } from "./verify-update-acceptance.mjs";

export const UPDATE_ACCEPTANCE_MAX_AGE_DAYS = 14;
const PLATFORMS = ["windows", "macos"];

export function classifyUpdateAcceptance({ summary, automatedFailures, ageDays, maxAgeDays }) {
  if (summary !== "complete" || automatedFailures.length > 0) return "incomplete";
  return ageDays > maxAgeDays ? "stale" : "complete";
}

function sourceHead(repository) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr.trim() || "Could not resolve HEAD");
  return result.stdout.trim();
}

export function acceptanceReceiptRoots(repository) {
  const parent = path.join(repository, "artifacts", "update-acceptance");
  if (!existsSync(parent)) return [];
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(parent, entry.name))
    .filter((root) => existsSync(path.join(root, "acceptance.json")));
}

function candidateRuns(root) {
  const runs = path.join(root, "runs");
  if (!existsSync(runs)) return [];
  return readdirSync(runs, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(path.join(runs, entry.name, "result.json"))
    )
    .map((entry) => entry.name);
}

export function updateAcceptanceAdvisory({
  repository,
  sourceSha = sourceHead(repository),
  now = new Date(),
  maxAgeDays = UPDATE_ACCEPTANCE_MAX_AGE_DAYS,
}) {
  const observations = Object.fromEntries(
    PLATFORMS.map((platform) => [
      platform,
      { platform, status: "missing", reason: "no exact-SHA evidence" },
    ])
  );
  for (const root of acceptanceReceiptRoots(repository)) {
    let receipt;
    try {
      receipt = JSON.parse(readFileSync(path.join(root, "acceptance.json"), "utf8"));
    } catch {
      continue;
    }
    if (receipt.sourceSha !== sourceSha || !PLATFORMS.includes(receipt.platform?.os)) continue;
    for (const runId of candidateRuns(root)) {
      let verification;
      try {
        verification = verifyUpdateAcceptance({ root, runId });
      } catch (error) {
        if (["missing", "invalid"].includes(observations[receipt.platform.os].status)) {
          observations[receipt.platform.os] = {
            platform: receipt.platform.os,
            status: "invalid",
            reason: error.message,
            runId,
          };
        }
        continue;
      }
      const endedAt = new Date(verification.result.endedAt);
      const ageDays = Number.isFinite(endedAt.getTime())
        ? Math.max(0, (now.getTime() - endedAt.getTime()) / 86_400_000)
        : Number.POSITIVE_INFINITY;
      const current = observations[receipt.platform.os];
      const currentEnded = current.endedAt ? new Date(current.endedAt).getTime() : -1;
      if (endedAt.getTime() < currentEnded) continue;
      const status = classifyUpdateAcceptance({
        summary: verification.result.summary,
        automatedFailures: verification.automatedFailures,
        ageDays,
        maxAgeDays,
      });
      observations[receipt.platform.os] = {
        platform: receipt.platform.os,
        status,
        reason:
          status === "incomplete"
            ? `required gaps: ${verification.automatedFailures.join(", ") || verification.result.summary}`
            : status === "stale"
              ? `evidence is ${ageDays.toFixed(1)} days old`
              : "exact-SHA automated scenarios complete",
        runId,
        endedAt: verification.result.endedAt,
        ageDays,
        gaps: verification.result.scenarios.filter((scenario) => scenario.status !== "passed"),
      };
    }
  }
  return {
    sourceSha,
    advisory: true,
    platforms: PLATFORMS.map((platform) => observations[platform]),
  };
}

export function formatUpdateAcceptanceAdvisory(report) {
  const lines = [
    "Update acceptance evidence (advisory; does not block this release):",
    `  Exact source: ${report.sourceSha}`,
  ];
  for (const platform of report.platforms) {
    lines.push(`  ${platform.platform}: ${platform.status} — ${platform.reason}`);
    for (const gap of platform.gaps || []) {
      lines.push(`    ${gap.id}: ${gap.status}${gap.reason ? ` — ${gap.reason}` : ""}`);
    }
  }
  if (report.platforms.some((platform) => platform.status !== "complete")) {
    lines.push(
      "  Release is proceeding without complete cross-platform update acceptance evidence."
    );
  }
  return lines.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const repository = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    console.log(formatUpdateAcceptanceAdvisory(updateAcceptanceAdvisory({ repository })));
  } catch (error) {
    console.log("Update acceptance evidence (advisory; does not block this release):");
    console.log(`  unavailable — ${error.message}`);
    console.log(
      "  Release is proceeding without complete cross-platform update acceptance evidence."
    );
  }
}
