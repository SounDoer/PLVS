import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  acceptanceRunId,
  completeScenarioCoverage,
  hostPlatform,
  resolveEvidenceSourceSha,
  writeJsonAtomic,
} from "./acceptance-evidence.mjs";
import {
  configureScenario,
  launchDesktopPerfRig,
  parseRigArgs,
  startLiveCapture,
  stopDesktopPerfRig,
} from "./desktop-perf-rig.mjs";
import { ROOT, RigError } from "./capture-rig.mjs";
import {
  readUiFrameDiagnostics,
  verifyBackpressurePhases,
  wait,
} from "./webview-observability.mjs";

export const PERFORMANCE_PHASES = ["normal", "stalled", "recovered"];
export const PERFORMANCE_SCENARIOS = ["default", "heavy"].flatMap((scenario) =>
  PERFORMANCE_PHASES.map((phase) => `performance.${scenario}.${phase}`)
);

export async function runAcceptance(options, log = console.log) {
  const rig = await launchDesktopPerfRig(options);
  let report = null;
  let primaryError = null;
  try {
    log(
      rig.session.url
        ? `Attached to ${rig.session.url}`
        : `Attached to isolated ${rig.session.platform} Agent Control`
    );
    const layout = await configureScenario(rig.session, options.scenario);
    const device = await startLiveCapture(rig.session, options.device);
    log(`Live signal: ${device}`);

    const normalStart = await readUiFrameDiagnostics(rig.session);
    await wait(1_500);
    const normalEnd = await readUiFrameDiagnostics(rig.session);

    if (rig.session.stall) await rig.session.stall(options.stallMs);
    else {
      await rig.session.evaluate(`(()=>{const end=performance.now()+${options.stallMs};
        while(performance.now()<end){};return true;})()`);
    }
    const stalled = await readUiFrameDiagnostics(rig.session);

    await wait(2_000);
    const recovered = await readUiFrameDiagnostics(rig.session);
    const verdict = verifyBackpressurePhases({ normalStart, normalEnd, stalled, recovered });
    const renderer = rig.session.readPerformanceSnapshot
      ? rig.session.readPerformanceSnapshot().renderer
      : null;
    report = {
      scenario: options.scenario,
      device,
      layout: layout ?? null,
      stallMs: options.stallMs,
      normalStart,
      normalEnd,
      stalled,
      recovered,
      renderer,
      verdict,
    };
    log(JSON.stringify(report, null, 2));
    if (!verdict.ok) {
      const error = new Error(verdict.failures.join("; "));
      error.report = report;
      throw error;
    }
    return report;
  } catch (error) {
    primaryError = error;
    if (report && !error.report) error.report = report;
    throw error;
  } finally {
    try {
      await stopDesktopPerfRig(rig);
    } catch (cleanupError) {
      if (primaryError) primaryError.cleanupError = cleanupError;
      else {
        cleanupError.report = report;
        throw cleanupError;
      }
    }
  }
}

export function buildPerformanceEvidence({
  sourceSha,
  runId,
  startedAt,
  endedAt,
  runs,
  warnings = [],
  cleanupStatus = "passed",
}) {
  const completed = [];
  for (const scenario of ["default", "heavy"]) {
    const run = runs[scenario];
    if (!run) continue;
    if (run.rigUnavailable) {
      completed.push(
        ...PERFORMANCE_PHASES.map((phase) => ({
          id: `performance.${scenario}.${phase}`,
          status: "rigUnavailable",
          observation: run.error,
        }))
      );
      continue;
    }
    for (const phase of PERFORMANCE_PHASES) {
      const result = run.report?.verdict?.phases?.[phase];
      completed.push({
        id: `performance.${scenario}.${phase}`,
        status: result?.ok ? "passed" : "failed",
        ...(result?.failures?.length ? { observation: result.failures } : {}),
      });
    }
  }
  const coverage = completeScenarioCoverage(PERFORMANCE_SCENARIOS, completed);
  const summary =
    cleanupStatus === "failed" || coverage.summary === "failed" ? "failed" : coverage.summary;
  return {
    schemaVersion: 1,
    domain: "performance",
    runId,
    sourceSha,
    platform: hostPlatform(),
    tool: { name: "desktop-performance", version: 1 },
    startedAt,
    endedAt,
    summary,
    scenarios: coverage.scenarios,
    artifacts: [],
    cleanup: {
      status: cleanupStatus,
      observations: [
        "Each isolated app, player, capture session, device selection, registry, and temporary data root was cleaned up.",
      ],
    },
    warnings,
    details: { runs },
  };
}

async function runSuite(options, log = console.log) {
  const sourceSha = resolveEvidenceSourceSha(ROOT);
  const runId = acceptanceRunId();
  const startedAt = new Date().toISOString();
  const scenarios = options.scenario === "all" ? ["default", "heavy"] : [options.scenario];
  const runs = {};
  const warnings = [];
  let cleanupStatus = "passed";
  let exitCode = 0;

  for (const scenario of scenarios) {
    try {
      runs[scenario] = { report: await runAcceptance({ ...options, scenario }, log) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`${scenario}: ${message}`);
      runs[scenario] = {
        report: error.report ?? null,
        error: message,
        rigUnavailable: error instanceof RigError,
      };
      if (error.cleanupError) {
        cleanupStatus = "failed";
        warnings.push(`${scenario} cleanup: ${error.cleanupError.message}`);
      }
      exitCode = error instanceof RigError ? Math.max(exitCode, 2) : 1;
      if (error instanceof RigError) break;
    }
  }

  const evidence = buildPerformanceEvidence({
    sourceSha,
    runId,
    startedAt,
    endedAt: new Date().toISOString(),
    runs,
    warnings,
    cleanupStatus,
  });
  if (evidence.summary === "incomplete") exitCode = Math.max(exitCode, 2);
  if (evidence.summary === "failed") exitCode = 1;
  const outDir = options.outDir
    ? resolve(options.outDir)
    : join(ROOT, "artifacts", "desktop-performance", sourceSha.slice(0, 8), runId);
  const evidencePath = join(outDir, "result.json");
  await writeJsonAtomic(evidencePath, evidence);
  log(`Evidence: ${evidencePath}`);
  return { evidence, evidencePath, exitCode };
}

function parseArgs(argv) {
  let outDir = null;
  const rigArgs = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--out-dir") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--out-dir requires a directory");
      outDir = value;
      index += 1;
    } else {
      rigArgs.push(argv[index]);
    }
  }
  return { ...parseRigArgs(rigArgs, { stallMs: 4_000, scenario: "all" }), outDir };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      "usage: node scripts/verify-ui-frame-backpressure.mjs [--exe path] [--port 9222] [--device name] [--scenario default|heavy|all] [--stall-ms 4000] [--out-dir directory]"
    );
  } else {
    runSuite(options)
      .then(({ exitCode }) => {
        process.exitCode = exitCode;
      })
      .catch((error) => {
        console.error(error.message);
        process.exitCode = 2;
      });
  }
}
