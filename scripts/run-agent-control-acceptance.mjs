#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ISOLATED_SCENARIOS } from "./accept-agent-control.mjs";
import { hostPlatform, resolveEvidenceSourceSha, writeJsonAtomic } from "./acceptance-evidence.mjs";
import {
  currentOwner,
  ensureLeaseDirectory,
  leasePath,
  machineLeaseDirectory,
  releaseLease,
  waitForLease,
} from "./rig-lease.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const acceptance = join(root, "scripts", "accept-agent-control.mjs");

async function readEvidence(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// This is the only output copied to Actions. Detailed traces may contain local paths,
// display or device names, and window pixels.
export function summarizeScenario(scenario, sourceSha, exitCode, trace, desktop) {
  const validTrace =
    trace?.scenario === scenario && trace.head === sourceSha && trace.workingTreeDirty === false;
  const validDesktop = desktop?.sourceSha === sourceSha && Array.isArray(desktop.scenarios);
  return {
    id: scenario,
    status:
      exitCode === 0 &&
      validTrace &&
      trace.status === "passed" &&
      (scenario !== "desktop" || (validDesktop && desktop.summary === "complete"))
        ? "passed"
        : "failed",
    exitCode,
    ...(scenario === "desktop" && validDesktop
      ? { checks: desktop.scenarios.map(({ id, status }) => ({ id, status })) }
      : {}),
  };
}

async function main([out, ...extra]) {
  if (!out || extra.length) {
    throw new Error("Usage: node scripts/run-agent-control-acceptance.mjs <output-directory>");
  }

  const sourceSha = resolveEvidenceSourceSha(root);
  const outDir = resolve(out);
  const report = {
    sourceSha,
    platform: hostPlatform(),
    scenarios: ISOLATED_SCENARIOS.map((id) => ({ id, status: "notRun" })),
  };
  await mkdir(dirname(outDir), { recursive: true });
  await mkdir(outDir, { mode: 0o700 });
  const summaryPath = join(outDir, "summary.json");
  await writeJsonAtomic(summaryPath, report);
  const lease = await waitForLease(
    leasePath(ensureLeaseDirectory(machineLeaseDirectory())),
    currentOwner({ worktree: root, command: "Agent Control desktop acceptance" }),
    { onBusy: () => process.stdout.write("Waiting for the desktop rig lease.\n") }
  );
  try {
    for (const [index, scenario] of ISOLATED_SCENARIOS.entries()) {
      const directory = join(outDir, "details", scenario);
      await mkdir(directory, { recursive: true });
      const log = openSync(join(directory, "command.log"), "w", 0o600);
      let child;
      try {
        child = spawnSync(
          process.execPath,
          [acceptance, "--scenario", scenario, "--out-dir", directory],
          {
            cwd: root,
            env: { ...process.env, PLVS_ACCEPTANCE_OWN_VITE: "1" },
            stdio: ["ignore", log, log],
          }
        );
      } finally {
        closeSync(log);
      }
      if (child.error) throw child.error;
      const trace = await readEvidence(join(directory, `${scenario}.json`));
      const desktop =
        scenario === "desktop" ? await readEvidence(join(directory, "result.json")) : null;
      const summary = summarizeScenario(scenario, sourceSha, child.status, trace, desktop);
      report.scenarios[index] = summary;
      process.stdout.write(`${scenario}: ${summary.status}\n`);
      await writeJsonAtomic(summaryPath, report);
      // A failed cleanup may have left a workbench still running. Leave subsequent scenarios unrun.
      if (trace?.cleanupError) break;
    }
    if (report.scenarios.some(({ status }) => status !== "passed")) {
      process.exitCode = 1;
    }
  } finally {
    releaseLease(lease);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
