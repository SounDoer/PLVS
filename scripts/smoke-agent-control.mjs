#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildPlvsCli } from "./build-plvs-cli.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED_METHODS = [
  "app.capabilities",
  "app.inspect",
  "visual.screenshot",
  "visual.recording.start",
  "visual.recording.wait",
];

export function parseJsonEnvelope(label, output) {
  const line = output.replace(/^﻿/, "").trim().split(/\r?\n/).pop();
  let envelope;
  try {
    envelope = JSON.parse(line);
  } catch {
    throw new Error(`${label} produced invalid JSON: ${line || "(empty output)"}`);
  }
  if (!envelope || envelope.ok !== true || !envelope.result) {
    const code = envelope?.error?.code ?? "unknownError";
    const message = envelope?.error?.message ?? "The command returned no result.";
    throw new Error(`${label} failed (${code}): ${message}`);
  }
  return envelope;
}

export function verifyArtifactBuffer(label, contents, artifact) {
  if (!artifact || typeof artifact !== "object") {
    throw new Error(`${label} returned no artifact metadata.`);
  }
  const sha256 = createHash("sha256").update(contents).digest("hex");
  if (contents.length !== artifact.bytes) {
    throw new Error(
      `${label} byte count differs: expected ${artifact.bytes}, got ${contents.length}.`
    );
  }
  if (sha256.toLowerCase() !== artifact.sha256?.toLowerCase()) {
    throw new Error(`${label} SHA-256 differs from the returned metadata.`);
  }
  if (
    label === "screenshot" &&
    !contents.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
  ) {
    throw new Error("screenshot is not a PNG file.");
  }
  if (label === "recording" && contents.subarray(4, 8).toString("ascii") !== "ftyp") {
    throw new Error("recording is not an MP4 file.");
  }
  return { bytes: contents.length, sha256 };
}

function parseArgs(args) {
  let outDir;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--out-dir" || !args[index + 1]) {
      throw new Error("Usage: npm run smoke:agent-control -- [--out-dir <directory>]");
    }
    outDir = args[(index += 1)];
  }
  const stamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d{3}Z$/, "Z");
  const fallback = join(root, "artifacts", "agent-control-smoke", `${stamp}-${process.platform}`);
  return { outDir: resolve(root, outDir ?? fallback) };
}

function createRunner(executable) {
  return (label, args, { allowFailure = false } = {}) => {
    const result = spawnSync(executable, args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 330_000,
    });
    if (result.error) throw new Error(`${label} could not run: ${result.error.message}`);
    if (allowFailure && result.status !== 0) return null;
    let envelope;
    try {
      envelope = parseJsonEnvelope(label, result.stdout);
    } catch (error) {
      const stderr = result.stderr?.trim();
      throw new Error(stderr ? `${error.message}\n${stderr}` : error.message);
    }
    if (result.status !== 0) {
      throw new Error(`${label} exited with status ${result.status}.`);
    }
    return envelope;
  };
}

export async function runAgentControlSmoke({ executable, outDir }) {
  await mkdir(outDir, { recursive: true });
  const run = createRunner(executable);
  let activeRecordingId = null;
  try {
    const capabilities = run("capabilities", ["capabilities", "--json"]);
    const methods = capabilities.result.methods;
    if (!Array.isArray(methods)) throw new Error("capabilities returned no method list.");
    const missing = REQUIRED_METHODS.filter((method) => !methods.includes(method));
    if (missing.length > 0) {
      throw new Error(`This desktop does not advertise required methods: ${missing.join(", ")}.`);
    }

    const inspected = run("inspect", ["inspect", "--json"]);
    const revision = inspected.result.revision;
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error("inspect returned an invalid global revision.");
    }

    const screenshotPath = join(outDir, "main.png");
    const screenshot = run("visual screenshot", [
      "visual",
      "screenshot",
      "--target",
      "main",
      "--expected-revision",
      String(revision),
      "--out",
      screenshotPath,
      "--json",
    ]);
    const screenshotCheck = verifyArtifactBuffer(
      "screenshot",
      await readFile(screenshotPath),
      screenshot.result.artifact
    );

    const started = run("visual recording start", [
      "visual",
      "recording",
      "start",
      "--target",
      "main",
      "--audio",
      "none",
      "--max-duration-seconds",
      "3",
      "--expected-revision",
      String(revision),
      "--json",
    ]);
    activeRecordingId = started.result.recording?.recordingId;
    if (typeof activeRecordingId !== "string" || activeRecordingId.length === 0) {
      throw new Error("visual recording start returned no recording ID.");
    }

    const recordingPath = join(outDir, "main-3s.mp4");
    const completed = run("visual recording wait", [
      "visual",
      "recording",
      "wait",
      activeRecordingId,
      "--timeout-ms",
      "30000",
      "--out",
      recordingPath,
      "--json",
    ]);
    if (
      completed.result.outcome !== "terminal" ||
      completed.result.recording?.state !== "completed"
    ) {
      throw new Error(
        `recording wait ended with outcome ${completed.result.outcome ?? "unknown"}.`
      );
    }
    const recording = completed.result.recording;
    const recordingCheck = verifyArtifactBuffer(
      "recording",
      await readFile(recordingPath),
      recording?.artifact
    );
    activeRecordingId = null;

    const report = {
      ok: true,
      createdAt: new Date().toISOString(),
      platform: process.platform,
      revision,
      runtime: capabilities.result.runtime,
      artifacts: {
        screenshot: {
          path: screenshotPath,
          ...screenshotCheck,
          metadata: screenshot.result.artifact,
        },
        recording: { path: recordingPath, ...recordingCheck, metadata: recording.artifact },
      },
    };
    const reportPath = join(outDir, "smoke-report.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return { report, reportPath };
  } catch (error) {
    if (activeRecordingId) {
      try {
        run(
          "visual recording cleanup",
          ["visual", "recording", "stop", activeRecordingId, "--json"],
          { allowFailure: true }
        );
      } catch {
        // Preserve the original smoke failure; cleanup is best-effort only.
      }
    }
    throw error;
  }
}

async function main() {
  const { outDir } = parseArgs(process.argv.slice(2));
  const { executable } = buildPlvsCli({ identity: "development" });
  const { report, reportPath } = await runAgentControlSmoke({ executable, outDir });
  console.log(`OK Agent Control smoke passed on ${report.platform}.`);
  console.log(`Screenshot: ${report.artifacts.screenshot.path}`);
  console.log(`Recording : ${report.artifacts.recording.path}`);
  console.log(`Report    : ${reportPath}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(`Agent Control smoke failed: ${error.message}`);
    console.error(
      "Start the development app with `npm run desktop`, keep Agent Control enabled, and retry."
    );
    process.exitCode = 1;
  });
}
