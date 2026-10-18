import { createWriteStream, mkdirSync } from "node:fs";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  configureScenario,
  launchDesktopPerfRig,
  parseRigArgs,
  startLiveCapture,
  stopDesktopPerfRig,
} from "./desktop-perf-rig.mjs";
import { RigError } from "./capture-rig.mjs";
import {
  INSTALL_RUNTIME_PROBE,
  readProcessTree,
  readWebViewSample,
  summarizeDesktopSoak,
  wait,
} from "./webview-observability.mjs";

export const MAX_VISIBLE_FRAME_GAP_MS = 5_000;

export function desktopSurfaceFailure(sample) {
  if (sample.runtime?.documentHidden === true) {
    return "the renderer document became hidden";
  }
  const latestAgeMs = sample.runtime?.latestRafAgeMs;
  if (Number.isFinite(latestAgeMs) && latestAgeMs > MAX_VISIBLE_FRAME_GAP_MS) {
    return `renderer animation frames became stale (${Math.round(latestAgeMs)} ms)`;
  }
  const maxGapMs = sample.runtime?.rafGapMaxMs;
  if (Number.isFinite(maxGapMs) && maxGapMs > MAX_VISIBLE_FRAME_GAP_MS) {
    return `renderer animation frames paused (${Math.round(maxGapMs)} ms maximum gap)`;
  }
  return null;
}

export async function runDesktopSoak(options, log = console.log) {
  const rig = await launchDesktopPerfRig(options);
  mkdirSync(dirname(options.out), { recursive: true });
  const output = createWriteStream(options.out, { encoding: "utf8" });
  const samples = [];
  try {
    const layout = await configureScenario(rig.session, options.scenario);
    const device = await startLiveCapture(rig.session, options.device);
    if (rig.session.send) await rig.session.send("Performance.enable");
    if (rig.session.evaluate) await rig.session.evaluate(INSTALL_RUNTIME_PROBE);
    output.write(
      `${JSON.stringify({ type: "meta", startedAt: new Date().toISOString(), scenario: options.scenario, seconds: options.seconds, every: options.every, device, layout: layout ?? null, appPid: rig.app.pid })}\n`
    );
    log(`Desktop soak: ${options.scenario}, ${options.seconds}s, sample every ${options.every}s`);
    log(`Writing ${options.out}`);

    const started = Date.now();
    let nextSample = started;
    while (Date.now() - started < options.seconds * 1000) {
      const sampleStarted = Date.now();
      const [web, processes] = await Promise.all([
        readWebViewSample(rig.session),
        readProcessTree(rig.app.pid, rig.session.platform ?? process.platform),
      ]);
      const sample = {
        type: "sample",
        t: (sampleStarted - started) / 1000,
        at: new Date(sampleStarted).toISOString(),
        ...web,
        processes,
      };
      samples.push(sample);
      output.write(`${JSON.stringify(sample)}\n`);
      const surfaceFailure = desktopSurfaceFailure(sample);
      if (surfaceFailure) {
        output.write(
          `${JSON.stringify({ type: "rigFailure", at: new Date().toISOString(), t: sample.t, reason: surfaceFailure })}\n`
        );
        throw new RigError(
          `${surfaceFailure}; keep the PLVS test window visible and in the foreground`
        );
      }
      nextSample += options.every * 1000;
      await wait(Math.max(0, nextSample - Date.now()));
    }

    const summary = summarizeDesktopSoak(samples);
    output.write(`${JSON.stringify({ type: "summary", ...summary })}\n`);
    log(JSON.stringify(summary, null, 2));
    if (summary.uiDroppedFrames > 0 || summary.audioDroppedChunks > 0) {
      throw new Error(
        `soak observed ${summary.uiDroppedFrames} UI frame drops and ${summary.audioDroppedChunks} audio chunk drops`
      );
    }
    return summary;
  } finally {
    output.end();
    await once(output, "close");
    await stopDesktopPerfRig(rig);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const scenario =
    process.argv.includes("heavy") || process.argv.includes("--scenario=heavy")
      ? "heavy"
      : "default";
  const options = parseRigArgs(process.argv.slice(2), {
    seconds: 1_800,
    every: 10,
    out: join(process.cwd(), "artifacts", "soak", `desktop-soak-${scenario}-${Date.now()}.jsonl`),
  });
  if (options.help) {
    console.log(
      "usage: node scripts/soak-desktop.mjs [--scenario default|heavy] [--seconds 1800] [--every 10] [--out file.jsonl]"
    );
  } else {
    runDesktopSoak(options).catch((error) => {
      console.error(error.message);
      process.exitCode = error instanceof RigError ? 2 : 1;
    });
  }
}
