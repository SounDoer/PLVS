#!/usr/bin/env node
// An isolated null sink exercises the same Linux monitor discovery and PCM path as the GUI.
// No default-device changes or audible playback; only this run's module is removed on exit.
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { compareMetrics, locateHarness, RigError, synthesizeSignal } from "./capture-rig.mjs";

function run(command, args, timeout = 30_000) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout });
  if (result.error || result.status !== 0) {
    throw new RigError(
      `${command} failed: ${result.error?.message || result.stderr || result.stdout}`
    );
  }
  return result.stdout.trim();
}

function report(harness, args) {
  const output = run(harness, ["--harness", ...args, "--json"]);
  const value = JSON.parse(output.split(/\r?\n/).at(-1));
  if (value.status !== "ok") throw new RigError(value.error?.message || "Harness did not succeed");
  return value;
}

let moduleId;
let player;
let temporary;
try {
  if (process.platform !== "linux") throw new RigError("Run this smoke test inside Linux.");
  const harness = locateHarness();
  run("pactl", ["info"]);
  temporary = await mkdtemp(join(tmpdir(), "plvs-linux-smoke-"));
  const wav = join(temporary, "signal.wav");
  await synthesizeSignal(wav);
  const truth = report(harness, ["analyze", wav]).summary;

  const sink = `plvs_smoke_${process.pid}`;
  moduleId = run("pactl", [
    "load-module",
    "module-null-sink",
    `sink_name=${sink}`,
    "rate=48000",
    "channels=2",
    `sink_properties=device.description=${sink}`,
  ]);
  if (!/^\d+$/.test(moduleId)) throw new RigError("Audio server returned an invalid module ID");
  player = spawn("paplay", [`--device=${sink}`, wav], { stdio: "ignore" });
  let playbackError;
  player.on("error", (error) => {
    playbackError = error;
  });
  await delay(2000);
  if (playbackError || player.exitCode !== null) throw new RigError("Test playback did not start");
  const live = report(harness, ["capture", "--device", sink, "--seconds", "10"]);
  const comparison = compareMetrics(truth, live.summary);
  const healthy =
    live.health.droppedChunks === 0 &&
    live.source.sampleRateHz === 48000 &&
    live.source.channelCount === 2;
  console.log(JSON.stringify({ truth, live, comparison }, null, 2));
  if (!healthy || !comparison.ok) {
    console.error("FAIL Linux monitor capture disagrees with file analysis or lost audio.");
    process.exitCode = 1;
  } else {
    console.log("OK Linux monitor capture agrees with file analysis, with zero dropped chunks.");
  }
} catch (error) {
  console.error(`RIG ${error.message}`);
  process.exitCode = 2;
} finally {
  if (player && player.exitCode === null) {
    player.kill();
    await Promise.race([new Promise((resolve) => player.once("close", resolve)), delay(2000)]);
  }
  if (moduleId && /^\d+$/.test(moduleId)) {
    try {
      run("pactl", ["unload-module", moduleId]);
    } catch (error) {
      console.error(`Cleanup failed: ${error.message}`);
      process.exitCode = 2;
    }
  }
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
