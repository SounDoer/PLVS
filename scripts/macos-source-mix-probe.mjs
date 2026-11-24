#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import {
  ROOT,
  resolveMacRenderDevice,
  startPlayer,
  stopPlayer,
  synthesizeSignal,
  withCaptureRig,
} from "./capture-rig.mjs";

const output = "BlackHole 2ch";
const seconds = 4;
const tapOutput = process.argv.includes("--unbound") ? "unbound" : output;
const scratch = await mkdtemp(join(tmpdir(), "plvs-macos-source-mix-"));
const probe = join(scratch, "source-mix-probe");

async function measure(endpoint, signals, captureGroups) {
  const players = [];
  try {
    for (const [index, signal] of signals.entries()) {
      const path = join(scratch, `signal-${index}.wav`);
      await synthesizeSignal(path, { seconds: 30, ...signal });
      players.push(await startPlayer(endpoint, path));
    }
    await setTimeout(2000);
    if (players.some(({ pid, exitCode }) => !pid || exitCode !== null)) {
      throw new Error("A VLC fixture player did not stay running.");
    }
    return captureGroups.map((group) =>
      JSON.parse(
        execFileSync(
          probe,
          [output, String(seconds), ...group.map((i) => String(players[i].pid))],
          {
            encoding: "utf8",
            timeout: (seconds + 5) * 1000,
          }
        )
      )
    );
  } finally {
    for (const player of players) stopPlayer(player, { keepLease: true });
  }
}

try {
  execFileSync(
    "xcrun",
    [
      "clang",
      "-fobjc-arc",
      "-fmodules",
      "-mmacosx-version-min=14.2",
      "-framework",
      "CoreAudio",
      "-framework",
      "AppKit",
      "-sectcreate",
      "__TEXT",
      "__info_plist",
      "src-tauri/Info.plist",
      "src-tauri/native/macos/tap_bridge.m",
      "scripts/macos/source-mix-probe.m",
      "-o",
      probe,
    ],
    { cwd: ROOT, stdio: "inherit" }
  );
  await withCaptureRig(
    async () => {
      const endpoint = String(resolveMacRenderDevice().audioObjectId);
      const none = -Infinity;
      const [left, right, isolatedGroup] = await measure(
        endpoint,
        [
          { peakLDb: -20, peakRDb: none },
          { peakLDb: none, peakRDb: -26 },
          { peakLDb: -4, peakRDb: -4 },
        ],
        [[0], [1], [0, 1]]
      );
      const [phaseGroup] = await measure(
        endpoint,
        [
          { peakLDb: -4, peakRDb: none },
          { peakLDb: -4, peakRDb: none, freqHz: 1001 },
        ],
        [[0, 1]]
      );
      console.log(JSON.stringify({ left, right, isolatedGroup, phaseGroup }, null, 2));
      const near = (a, b) => Math.abs(a - b) <= 0.003;
      if (
        !near(left.leftPeak, 0.1) ||
        !near(right.rightPeak, 10 ** (-26 / 20)) ||
        left.rightPeak > 0.0001 ||
        right.leftPeak > 0.0001 ||
        !near(isolatedGroup.leftPeak, left.leftPeak) ||
        !near(isolatedGroup.rightPeak, right.rightPeak) ||
        !near(phaseGroup.leftPeak, 2 * 10 ** (-4 / 20)) ||
        phaseGroup.minLeftWindowPeak > 0.1
      ) {
        throw new Error("Core Audio tap did not match the isolated or summed reference.");
      }
    },
    { wait: process.argv.includes("--wait") }
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
