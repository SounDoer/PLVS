#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import {
  resolveLinuxCaptureRoute,
  stopPlayer,
  synthesizeSignal,
  withCaptureRig,
} from "./capture-rig.mjs";

function playbackIndices(players) {
  const result = spawnSync("pactl", ["-f", "json", "list", "sink-inputs"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "Could not list playback streams.");
  const streams = JSON.parse(result.stdout);
  return players.map((player) => {
    const stream = streams.find(
      ({ properties }) => properties["application.process.id"] === String(player.pid)
    );
    if (!stream) throw new Error("The fixture playback stream was not found.");
    return stream.index;
  });
}

function measure(sink, index, backend = "pulse") {
  const command = backend === "pipewire" ? "pw-record" : "parec";
  const args =
    backend === "pipewire"
      ? [
          "--target",
          String(index),
          "--rate",
          "48000",
          "--channels",
          "2",
          "--format",
          "f32",
          "--properties",
          "stream.monitor=true node.dont-fallback=true node.dont-reconnect=true",
          "-",
        ]
      : [
          `--device=${sink}.monitor`,
          "--raw",
          "--format=float32le",
          "--rate=48000",
          "--channels=2",
          "--latency-msec=40",
          ...(index == null ? [] : [`--monitor-stream=${index}`]),
        ];
  const result = spawnSync("timeout", ["3", command, ...args], { maxBuffer: 2 * 1024 * 1024 });
  if (result.error || result.status !== 124) {
    throw new Error(result.error?.message || result.stderr.toString() || "Recording failed.");
  }
  const pcm = result.stdout;
  let start = 0;
  if (pcm.toString("ascii", 0, 4) === "RIFF") {
    const data = pcm.indexOf("data", 12, "ascii");
    if (data < 0) throw new Error("PipeWire recording has no PCM chunk.");
    start = data + 8;
  }
  let leftPeak = 0;
  let rightPeak = 0;
  let frames = 0;
  for (let byte = start; byte + 8 <= pcm.length; byte += 8) {
    leftPeak = Math.max(leftPeak, Math.abs(pcm.readFloatLE(byte)));
    rightPeak = Math.max(rightPeak, Math.abs(pcm.readFloatLE(byte + 4)));
    frames++;
  }
  return { frames, leftPeak, rightPeak };
}

const scratch = await mkdtemp(join(tmpdir(), "plvs-linux-source-mix-"));
try {
  await withCaptureRig(
    async () => {
      const route = resolveLinuxCaptureRoute();
      const players = [];
      try {
        const levels = [
          { peakLDb: -20, peakRDb: -Infinity },
          { peakLDb: -Infinity, peakRDb: -26 },
        ];
        for (const [index, level] of levels.entries()) {
          const path = join(scratch, `signal-${index}.wav`);
          await synthesizeSignal(path, { seconds: 20, ...level });
          players.push(
            spawn("paplay", [`--device=${route.playerTarget}`, path], { stdio: "ignore" })
          );
        }
        await setTimeout(1500);
        const [leftIndex, rightIndex] = playbackIndices(players);
        const backend = process.argv.includes("--pipewire") ? "pipewire" : "pulse";
        const left = measure(route.playerTarget, leftIndex, backend);
        const right = measure(route.playerTarget, rightIndex, backend);
        const output = measure(route.playerTarget);
        console.log(
          JSON.stringify({ backend, leftIndex, rightIndex, left, right, output }, null, 2)
        );
        if (
          [left, right, output].some(({ frames }) => frames < 96_000) ||
          Math.abs(left.leftPeak - 0.1) > 0.002 ||
          left.rightPeak > 0.0001 ||
          Math.abs(right.rightPeak - 10 ** (-26 / 20)) > 0.002 ||
          right.leftPeak > 0.0001 ||
          Math.abs(output.leftPeak - left.leftPeak) > 0.002 ||
          Math.abs(output.rightPeak - right.rightPeak) > 0.002
        ) {
          throw new Error("The per-stream PCM did not match the isolated fixture signals.");
        }
      } finally {
        for (const player of players) stopPlayer(player, { keepLease: true });
        route.release();
      }
    },
    { wait: process.argv.includes("--wait") }
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
