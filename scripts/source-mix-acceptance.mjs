#!/usr/bin/env node
// Exercises the real Mix editor, persistence and Live engine on an isolated dev Workbench.
import { execFileSync, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { buildPlvsCli } from "./build-plvs-cli.mjs";
import {
  ROOT,
  resolveLinuxCaptureRoute,
  resolveMacRenderDevice,
  stopPlayer,
  synthesizeSignal,
  withCaptureRig,
} from "./capture-rig.mjs";
import { scopeDevCliToWorktree } from "./dev-worktree.mjs";

if (!["darwin", "linux"].includes(process.platform) || !scopeDevCliToWorktree()) {
  throw new Error("Run the probe against an isolated macOS or Linux dev app.");
}

const { executable } = buildPlvsCli({ identity: "dev" });
const scratch = await mkdtemp(join(tmpdir(), "plvs-mix-acceptance-"));
const prefix = `Mix Fixture ${process.pid}`;
let ownedSurface;

function call(args, input) {
  try {
    const body = JSON.parse(
      execFileSync(executable, [...args, "--json"], { encoding: "utf8", input, timeout: 15_000 })
    );
    if (!body.ok) throw new Error(JSON.stringify(body));
    return body.result;
  } catch (error) {
    if (error.stdout)
      throw new Error(`${args.join(" ")}: ${error.stdout.trim()}`, { cause: error });
    throw error;
  }
}

function revision() {
  return String(call(["inspect"]).revision);
}

function uiTokens(ui) {
  return [
    "--expected-revision",
    String(ui.revision),
    "--expected-ui-generation",
    String(ui.uiGeneration),
  ];
}

function decide(ui, surface, choice) {
  return call([
    "ui",
    "decide",
    "--surface-id",
    surface.surfaceId,
    "--choice",
    choice,
    ...uiTokens(ui),
  ]);
}

function draftTokens(snapshot) {
  return [...uiTokens(snapshot), "--expected-draft-generation", String(snapshot.draftGeneration)];
}

function openMixEditor(choice) {
  const before = call(["ui", "inspect"]);
  call(["ui", "show", "toolbar-menu", "--menu", "sources", ...uiTokens(before)]);
  const shown = call(["ui", "inspect"]);
  const sources = shown.surfaces.find(({ choices }) => choices?.some(({ id }) => id === choice));
  if (!sources) throw new Error(`Sources choice missing: ${choice}`);
  decide(shown, sources, choice);
  const surface = call(["ui", "inspect"]).surfaces.find(({ kind }) => kind === "sourceMixEditor");
  if (!surface) throw new Error("Mix draft did not open.");
  ownedSurface = surface.surfaceId;
  return ownedSurface;
}

function patchMix(surface, operations) {
  const draft = call(["editor-draft", "inspect", "mix", surface]);
  return call(
    ["editor-draft", "patch", "mix", surface, "-", ...draftTokens(draft)],
    JSON.stringify({ operations })
  );
}

function saveMix(surface) {
  const draft = call(["editor-draft", "inspect", "mix", surface]);
  const result = call(["editor-draft", "save", "mix", surface, ...draftTokens(draft)]);
  ownedSurface = undefined;
  return result;
}

async function waitFor(label, observe, matches) {
  let last;
  for (let attempt = 0; attempt < 50; attempt++) {
    last = observe();
    if (matches(last)) return last;
    await setTimeout(200);
  }
  throw new Error(`${label}: ${JSON.stringify(last)}`);
}

function meetsPeaks(reading, expected) {
  const peaks = reading.levels?.channels?.map(({ peakDbfs }) => peakDbfs);
  return Boolean(
    Number.isFinite(reading.loudness?.integratedLufs) &&
    peaks &&
    expected.every((target, index) =>
      target == null
        ? peaks[index] == null || peaks[index] < -60
        : Number.isFinite(peaks[index]) && Math.abs(peaks[index] - target) < 0.6
    )
  );
}

async function createPlayer(name, input, endpoint, index) {
  if (process.platform === "linux") {
    return spawn(
      "paplay",
      [
        `--device=${endpoint}`,
        `--client-name=${name}`,
        `--property=application.id=org.plvs.fixture.${process.pid}.${index}`,
        input,
      ],
      { stdio: "ignore" }
    );
  }
  const bundle = join(scratch, `${name}.app`, "Contents");
  const executable = join(bundle, "MacOS", "source-mix-player");
  if (
    !(await access(executable).then(
      () => true,
      () => false
    ))
  ) {
    await mkdir(join(bundle, "MacOS"), { recursive: true });
    await writeFile(
      join(bundle, "Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
      <key>CFBundleIdentifier</key><string>org.plvs.fixture.${process.pid}.${index}</string>
      <key>CFBundleName</key><string>${name}</string>
      <key>CFBundleExecutable</key><string>source-mix-player</string>
      <key>CFBundlePackageType</key><string>APPL</string></dict></plist>`
    );
    execFileSync("xcrun", [
      "swiftc",
      join(ROOT, "scripts", "macos", "source-mix-player.swift"),
      "-o",
      executable,
    ]);
  }
  return spawn(executable, [endpoint, input], { stdio: ["ignore", "ignore", "inherit"] });
}

try {
  await withCaptureRig(
    async () => {
      const route = process.platform === "linux" ? resolveLinuxCaptureRoute() : null;
      const endpoint = route?.playerTarget ?? String(resolveMacRenderDevice().audioObjectId);
      const players = [];
      const saved = [];
      let inputModule;
      let previousInputDefault;
      let scenarioError;
      try {
        const ui = call(["ui", "inspect"]);
        const welcome = ui.surfaces.find(
          ({ kind, target }) => kind === "update" && target.phase === "preferences"
        );
        if (welcome) decide(ui, welcome, "save");
        for (const [index, levels] of [
          { peakLDb: -20, peakRDb: -Infinity },
          { peakLDb: -Infinity, peakRDb: -26 },
        ].entries()) {
          const path = join(scratch, `${index}.wav`);
          await synthesizeSignal(path, { seconds: 100, ...levels });
          players.push(await createPlayer(`${prefix} ${index}`, path, endpoint, index));
        }
        const applications = await waitFor(
          "Two fixture applications were not discovered",
          () =>
            call(["device", "list"])
              .applications.filter(({ label }) => label.startsWith(prefix))
              .sort((a, b) => a.label.localeCompare(b.label)),
          (apps) => apps.length === 2
        );
        const [left, right] = applications.map(({ id }) => id);
        const surface = openMixEditor("add-mix");
        patchMix(surface, [
          { op: "setName", name: prefix },
          { op: "setFormat", format: "stereo" },
          { op: "setApplication", sourceId: left, enabled: true },
          { op: "setApplication", sourceId: right, enabled: true },
        ]);
        const { savedId } = saveMix(surface);
        saved.push(savedId);
        call(["transport", "live", "start", "--expected-revision", revision()]);
        const stereo = await waitFor(
          "Stereo mix did not reproduce the isolated peaks",
          () => call(["measurement", "inspect"]),
          (reading) =>
            reading.sample?.elapsedMs >= 1500 &&
            meetsPeaks(reading, [-20, -26]) &&
            Math.abs(reading.loudness.integratedLufs - -22.03) <= 0.5 &&
            Math.abs(reading.levels.truePeak.leftDbtp - -20) <= 0.3
        );

        stopPlayer(players[1], { keepLease: true });
        await waitFor(
          "Mix did not keep metering the remaining application",
          () => call(["measurement", "inspect"]),
          (reading) => meetsPeaks(reading, [-20, null])
        );
        players[1] = await createPlayer(`${prefix} 1`, join(scratch, "1.wav"), endpoint, 1);
        await waitFor(
          "The restarted application was not discovered",
          () => call(["device", "list"]).applications,
          (applications) => applications.some(({ id }) => id === right)
        );
        const restored = await waitFor(
          "Mix did not recapture the restarted application",
          () => call(["measurement", "inspect"]),
          (reading) => meetsPeaks(reading, [-20, -26])
        );
        if (restored.source.sessionGeneration !== stereo.source.sessionGeneration) {
          throw new Error("The restarted application reset the Mix measurement.");
        }
        const edit = openMixEditor(`edit:${savedId}`);
        patchMix(edit, [
          { op: "setFormat", format: "5.1" },
          { op: "setRoute", sourceId: left, lane: "L", destination: "Ls" },
          { op: "setRoute", sourceId: right, lane: "R", destination: "Rs" },
        ]);
        const surround = await waitFor(
          "Live preview did not move the signals to the surround channels",
          () => call(["measurement", "inspect"]),
          (reading) =>
            reading.topology?.channelCount === 6 &&
            meetsPeaks(reading, [null, null, null, null, -20, -26])
        );
        saveMix(edit);
        const library = call(["mix", "list"]);
        if (
          library.activeId !== savedId ||
          !library.mixes.some(({ id, format }) => id === savedId && format === "5.1")
        ) {
          throw new Error("The saved mix and its format were not restored in the library listing.");
        }
        const widerEdit = openMixEditor(`edit:${savedId}`);
        patchMix(widerEdit, [
          { op: "setFormat", format: "9.1.6" },
          { op: "setRoute", sourceId: left, lane: "L", destination: "Ltf" },
          { op: "setRoute", sourceId: right, lane: "R", destination: "Rtr" },
        ]);
        const immersive = await waitFor(
          "9.1.6 preview did not route to the expected height channels",
          () => call(["measurement", "inspect"]),
          (reading) =>
            reading.topology?.channelCount === 16 &&
            meetsPeaks(
              reading,
              reading.topology.channelLabels.map((role) =>
                role === "Ltf" ? -20 : role === "Rtr" ? -26 : null
              )
            )
        );
        const widerUi = call(["ui", "inspect"]);
        call(["ui", "cancel", widerEdit, ...uiTokens(widerUi)]);
        ownedSurface = undefined;
        const restoredPreview = await waitFor(
          "Cancel did not restore the saved 5.1 routing",
          () => call(["measurement", "inspect"]),
          (reading) =>
            reading.topology?.channelCount === 6 &&
            meetsPeaks(reading, [null, null, null, null, -20, -26])
        );
        if (restoredPreview.source.sessionGeneration === immersive.source.sessionGeneration) {
          throw new Error("Cancel did not restore the original capture configuration.");
        }
        let groupedPlayback;
        if (process.platform === "linux") {
          const path = join(scratch, "extra-stream.wav");
          await synthesizeSignal(path, { seconds: 40, peakLDb: -Infinity, peakRDb: -30 });
          const extra = await createPlayer(`${prefix} 0`, path, endpoint, 0);
          players.push(extra);
          const surface = openMixEditor("add-mix");
          patchMix(surface, [
            { op: "setName", name: `${prefix} Multiple Streams` },
            { op: "setFormat", format: "stereo" },
            { op: "setApplication", sourceId: left, enabled: true },
          ]);
          groupedPlayback = await waitFor(
            "Two playback streams from one application did not sum in isolation",
            () => call(["measurement", "inspect"]),
            (reading) => reading.topology?.channelCount === 2 && meetsPeaks(reading, [-20, -30])
          );
          saved.push(saveMix(surface).savedId);
          stopPlayer(extra, { keepLease: true });
        }
        let deviceCombinations;
        if (process.argv.includes("--devices")) {
          const inputName = route ? `${endpoint}_input` : "BlackHole 2ch";
          if (route) {
            previousInputDefault = execFileSync("pactl", ["get-default-source"], {
              encoding: "utf8",
            }).trim();
            inputModule = execFileSync(
              "pactl",
              [
                "load-module",
                "module-remap-source",
                `master=${endpoint}.monitor`,
                `source_name=${inputName}`,
                `source_properties=device.description=${inputName}`,
                "channels=2",
                "channel_map=front-left,front-right",
              ],
              { encoding: "utf8" }
            ).trim();
          }
          const devices = await waitFor(
            "Rig input and output were not available",
            () => call(["device", "list"]).devices,
            (devices) =>
              devices.some(({ label, kind }) => label === inputName && kind === "input") &&
              devices.some(
                ({ label, kind, mixOutputRoles }) =>
                  label.includes(route ? endpoint : "BlackHole 2ch") &&
                  kind === "systemOutput" &&
                  mixOutputRoles?.length === 2
              )
          );
          const input = devices.find(
            ({ label, kind }) => label === inputName && kind === "input"
          ).id;
          const output = devices.find(
            ({ label, kind, mixOutputRoles }) =>
              label.includes(route ? endpoint : "BlackHole 2ch") &&
              kind === "systemOutput" &&
              mixOutputRoles?.length === 2
          ).id;
          const create = async (name, ops, peaks) => {
            const surface = openMixEditor("add-mix");
            patchMix(surface, [{ op: "setName", name: `${prefix} ${name}` }, ...ops]);
            const preview = await waitFor(
              name,
              () => call(["measurement", "inspect"]),
              (reading) =>
                reading.topology?.channelCount === peaks.length && meetsPeaks(reading, peaks)
            );
            saved.push(saveMix(surface).savedId);
            return preview;
          };
          const appInput = await create(
            "Application and Input",
            [
              { op: "setFormat", format: "stereo" },
              { op: "setApplication", sourceId: left, enabled: true },
              { op: "setInputChannels", sourceId: input, channels: [1] },
              { op: "setRoute", sourceId: input, lane: "1", destination: "R" },
            ],
            [-20, -26]
          );
          const outputInput = await create(
            "Output and Input",
            [
              { op: "setFormat", format: "5.1" },
              { op: "setOutput", sourceId: output },
              { op: "setInputChannels", sourceId: input, channels: [1] },
              { op: "setRoute", sourceId: input, lane: "1", destination: "C" },
            ],
            [-20, -26, -26, null, null, null]
          );
          deviceCombinations = {
            appInput: appInput.levels.channels,
            outputInput: outputInput.levels.channels,
          };
        }
        let phase;
        if (process.argv.includes("--phase")) {
          const phaseNames = [`${prefix} Phase A`, `${prefix} Phase B`];
          for (const [index, name] of phaseNames.entries()) {
            const path = join(scratch, `phase-${index}.wav`);
            await synthesizeSignal(path, {
              seconds: 25,
              freqHz: 1000 + index,
              peakLDb: -4,
              peakRDb: -Infinity,
            });
            players.push(await createPlayer(name, path, endpoint, index + 2));
          }
          const inputs = await waitFor(
            "Phase fixtures were not discovered",
            () =>
              call(["device", "list"]).applications.filter(({ label }) =>
                phaseNames.includes(label)
              ),
            (applications) => applications.length === 2
          );
          const surface = openMixEditor("add-mix");
          patchMix(surface, [
            { op: "setName", name: `${prefix} Phase` },
            { op: "setFormat", format: "stereo" },
            ...inputs.map(({ id }) => ({ op: "setApplication", sourceId: id, enabled: true })),
          ]);
          const started = await waitFor(
            "Phase Mix did not preserve a peak above full scale",
            () => call(["measurement", "inspect"]),
            (reading) =>
              reading.topology?.channelCount === 2 &&
              Math.abs(reading.levels.truePeak.maxDbtp - 2.02) < 0.3
          );
          saved.push(saveMix(surface).savedId);
          const ended = await waitFor(
            "Phase Mix did not show the two tones cancelling",
            () => call(["measurement", "inspect"]),
            (reading) =>
              reading.levels.channels[0]?.peakDbfs < -19 &&
              reading.levels.channels[0]?.peakDbfs !== null
          );
          phase = {
            truePeakMaxDbtp: started.levels.truePeak.maxDbtp,
            cancellationPeakDbfs: ended.levels.channels[0].peakDbfs,
          };
        }
        console.log(
          JSON.stringify(
            {
              stereo: {
                topology: stereo.topology,
                peaks: stereo.levels.channels,
                loudness: stereo.loudness.integratedLufs,
              },
              restoredSession: restored.source.sessionGeneration,
              deviceCombinations,
              phase,
              groupedPlayback: groupedPlayback?.levels.channels,
              immersive: immersive.levels.channels.filter(({ peakDbfs }) => peakDbfs !== null),
              preview: {
                topology: surround.topology,
                peaks: surround.levels.channels,
                loudness: surround.loudness.integratedLufs,
              },
            },
            null,
            2
          )
        );
      } catch (error) {
        scenarioError = error;
        throw error;
      } finally {
        for (const player of players) stopPlayer(player, { keepLease: true });
        try {
          if (ownedSurface) {
            const ui = call(["ui", "inspect"]);
            if (ui.surfaces.some(({ surfaceId }) => surfaceId === ownedSurface)) {
              call(["ui", "cancel", ownedSurface, ...uiTokens(ui)]);
            }
          }
          if (saved.length && call(["inspect"]).transport.live.state === "running") {
            call(["transport", "live", "stop", "--expected-revision", revision()]);
          }
          for (const mix of saved) {
            call(["mix", "delete", mix, "--expected-revision", revision()]);
          }
        } catch (cleanupError) {
          if (!scenarioError) throw cleanupError;
          console.error("Mix fixture cleanup:", cleanupError.message);
        } finally {
          if (inputModule) execFileSync("pactl", ["unload-module", inputModule]);
          route?.release();
          if (previousInputDefault) {
            const current = execFileSync("pactl", ["get-default-source"], {
              encoding: "utf8",
            }).trim();
            if (current !== previousInputDefault) {
              execFileSync("pactl", ["set-default-source", previousInputDefault]);
            }
          }
        }
      }
    },
    { wait: process.argv.includes("--wait") }
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
