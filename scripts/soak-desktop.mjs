import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  configureScenario,
  launchDesktopPerfRig,
  parseRigArgs,
  startLiveCapture,
  stopDesktopPerfRig,
} from "./desktop-perf-rig.mjs";
import {
  INSTALL_RUNTIME_PROBE,
  readProcessTree,
  readWebViewSample,
  summarizeDesktopSoak,
  wait,
} from "./webview-observability.mjs";

export async function runDesktopSoak(options, log = console.log) {
  const rig = await launchDesktopPerfRig(options);
  const output = createWriteStream(options.out, { encoding: "utf8" });
  const samples = [];
  try {
    const layout = await configureScenario(rig.session, options.scenario);
    const device = await startLiveCapture(rig.session, options.device);
    await rig.session.send("Performance.enable");
    await rig.session.evaluate(INSTALL_RUNTIME_PROBE);
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
        readProcessTree(rig.app.pid),
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
    out: join(process.cwd(), `desktop-soak-${scenario}-${Date.now()}.jsonl`),
  });
  if (options.help) {
    console.log(
      "usage: node scripts/soak-desktop.mjs [--scenario default|heavy] [--seconds 1800] [--every 10] [--out file.jsonl]"
    );
  } else {
    runDesktopSoak(options).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
