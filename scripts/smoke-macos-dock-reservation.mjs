#!/usr/bin/env node
/** Real React -> IPC -> native Dock avoidance against an owned disposable host. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = process.argv[2];
assert.ok(
  cli && process.env.PLVS_INSTANCE_ID,
  "Pass a development plvs-cli path and PLVS_INSTANCE_ID"
);
function call(args, instance = process.env.PLVS_INSTANCE_ID) {
  const result = spawnSync(cli, [...args, "--json"], {
    encoding: "utf8",
    cwd: root,
    env: { ...process.env, PLVS_INSTANCE_ID: instance },
  });
  if (result.error) throw result.error;
  const value = JSON.parse(result.stdout);
  if (!value.ok) throw new Error(JSON.stringify(value));
  return value.result;
}
call(["capabilities"]);
const initial = call(["inspect"]);
assert.equal(initial.dock.enabled, false, "Start from an undocked development workbench");
const second = process.env.PLVS_SECOND_INSTANCE_ID;
const secondInitial = second ? call(["inspect"], second) : null;
if (second)
  assert.equal(secondInitial.dock.enabled, false, "Second workbench must also be undocked");
const output = join(root, "artifacts/macos-dock-reservation", `integration-${randomUUID()}`);
mkdirSync(output, { recursive: true });
const statePath = join(output, "state.json");
const control = join(output, "control.json");
const results = [];
const host = spawn(
  process.execPath,
  [
    join(root, "scripts/spike-macos-dock-reservation.mjs"),
    "test-host",
    "--state",
    statePath,
    "--control",
    control,
  ],
  { cwd: root, stdio: ["ignore", "ignore", "inherit"] }
);
const read = () => {
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return null;
  }
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await pause(100);
  }
  throw new Error(`Timed out: ${label}; native state=${JSON.stringify(read())}`);
}
const matches = (a, b) =>
  ["x", "y", "width", "height"].every((key) => Math.abs(a[key] - b[key]) <= 1);
async function command(action) {
  const id = randomUUID();
  writeFileSync(control, JSON.stringify({ id, action }));
  return until(() => {
    const value = read();
    return value?.command === id && value;
  }, action);
}
function mutate(args, instance) {
  const snapshot = call(["inspect"], instance);
  return call([...args, "--expected-revision", String(snapshot.revision)], instance);
}
const enter = async (edge, height, reserve, instance) => {
  mutate(
    [
      "dock",
      "enter",
      "--edge",
      edge,
      "--height",
      String(height),
      "--reserve-space",
      String(reserve),
    ],
    instance
  );
  // The React strip may raise the requested height to its measured content minimum.
  await pause(1000);
  return call(["inspect"], instance).dock.height;
};
const exit = () => mutate(["dock", "exit"]);
async function frame(expected) {
  return until(() => read() && matches(read().frame, expected), "host frame");
}
try {
  await until(read, "host launch");
  for (const [edge, height] of [
    ["top", 68],
    ["bottom", 160],
  ]) {
    const before = (await command("reset")).frame;
    const appliedHeight = await enter(edge, height, true);
    const expected = {
      ...before,
      y: before.y + (edge === "top" ? appliedHeight : 0),
      height: before.height - appliedHeight,
    };
    await frame(expected);
    assert.equal(call(["inspect"]).dock.reserveSpace, true);
    exit();
    await frame(before);
    results.push({ scenario: edge, before, expected, passed: true });
  }
  const compact = (await command("compact")).frame;
  await enter("top", 68, true);
  await pause(1500);
  assert.ok(matches(read().frame, compact));
  exit();
  results.push({ scenario: "nonoverlapping", passed: true });

  const before = (await command("reset")).frame;
  const appliedHeight = await enter("top", 68, true);
  await frame({
    ...before,
    y: before.y + appliedHeight,
    height: before.height - appliedHeight,
  });
  const moved = (await command("compact")).frame;
  await pause(1500);
  exit();
  await frame(moved);
  results.push({ scenario: "preserve-user-change", passed: true });

  const minimum = (await command("minimum")).frame;
  await enter("top", 68, true);
  await pause(2000);
  assert.ok(matches(read().frame, minimum), "Failed shrink must undo its partial move");
  exit();
  await frame(minimum);
  results.push({ scenario: "minimum-size-rollback", passed: true });

  await command("reset");
  await command("minimize");
  await until(() => read()?.minimized, "minimize");
  const minimized = read().frame;
  await enter("bottom", 160, true);
  await pause(1500);
  assert.ok(matches(read().frame, minimized));
  exit();
  results.push({ scenario: "minimized", passed: true });
  await command("reset");
  if (second) {
    await enter("top", 68, true);
    for (const edge of ["top", "bottom"]) {
      await enter(edge, secondInitial.dock.height, true, second);
      assert.equal(call(["inspect"], second).dock.reserveSpace, false);
      assert.equal(call(["inspect"]).dock.reserveSpace, true);
      mutate(["dock", "exit"], second);
    }
    exit();
    results.push({ scenario: "display-ownership-both-edges", passed: true });
  }
  console.log(JSON.stringify({ ok: true, output, results }, null, 2));
} finally {
  // Restore the original Dock preference through the running business path.
  try {
    if (call(["inspect"]).dock.enabled) exit();
    await enter(initial.dock.edge, initial.dock.height, initial.dock.reserveSpace);
    exit();
  } finally {
    try {
      if (second) {
        if (call(["inspect"], second).dock.enabled) mutate(["dock", "exit"], second);
        mutate(
          [
            "dock",
            "enter",
            "--edge",
            secondInitial.dock.edge,
            "--height",
            String(secondInitial.dock.height),
            "--reserve-space",
            String(secondInitial.dock.reserveSpace),
          ],
          second
        );
        mutate(["dock", "exit"], second);
      }
    } finally {
      writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
      writeFileSync(control, JSON.stringify({ id: randomUUID(), action: "quit" }));
      await until(() => host.exitCode !== null, "host exit").catch(() => {
        const pid = read()?.pid;
        if (pid) {
          try {
            process.kill(pid, "SIGTERM");
          } catch {
            /* Exited already. */
          }
        }
      });
      if (host.exitCode === null) host.kill("SIGTERM");
    }
  }
}
