#!/usr/bin/env node
/** Exercise AX against a disposable native host; never target existing user windows. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const wrapper = join(root, "scripts/spike-macos-dock-reservation.mjs");
function probe(args, allowFailure = false) {
  const result = spawnSync(process.execPath, [wrapper, ...args], { encoding: "utf8", cwd: root });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) throw new Error(result.stdout + result.stderr);
  return { status: result.status, value: JSON.parse(result.stdout) };
}
assert.equal(
  probe(["status"]).value.trusted,
  true,
  "Grant PLVS Dock Probe Accessibility permission first"
);
const output = join(root, "artifacts/macos-dock-reservation", `run-${randomUUID()}`);
mkdirSync(output, { recursive: true });
const state = join(output, "host-state.json");
const control = join(output, "host-command.json");
const results = [];
const host = spawn(
  process.execPath,
  [wrapper, "test-host", "--state", state, "--control", control],
  {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  }
);
async function until(read, description) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
}
function readState() {
  try {
    return JSON.parse(readFileSync(state, "utf8"));
  } catch {
    return null;
  }
}
async function command(action) {
  const id = randomUUID();
  writeFileSync(control, JSON.stringify({ id, action }));
  return until(() => {
    const value = readState();
    return value?.command === id && value;
  }, action);
}
function matches(a, b) {
  return ["x", "y", "width", "height"].every((key) => Math.abs(a[key] - b[key]) <= 1);
}
async function hostMatches(frame) {
  return until(() => {
    const value = readState();
    return value && matches(value.frame, frame) && value;
  }, "native geometry");
}
let pid;
try {
  pid = (await until(readState, "host launch")).pid;
  const target = ["--pid", String(pid), "--window", "0"];
  for (const [edge, height] of [
    ["top", "56"],
    ["bottom", "160"],
  ]) {
    const before = await command("reset");
    const journal = join(output, `${edge}.json`);
    const applied = probe([
      "apply",
      ...target,
      "--edge",
      edge,
      "--height",
      height,
      "--journal",
      journal,
    ]).value;
    assert.equal(applied.phase, "applied");
    await hostMatches(applied.proposed);
    assert.ok(matches(before.frame, applied.before));
    probe(["restore", "--journal", journal]);
    await hostMatches(before.frame);
    results.push({ scenario: edge, passed: true, applied });
  }
  const compact = await command("compact");
  const planned = probe(["plan", ...target]).value;
  assert.ok(matches(compact.frame, planned.proposed), "Nonoverlapping window should stay in place");
  results.push({ scenario: "nonoverlapping", passed: true });

  await command("reset");
  const journal = join(output, "user-moved.json");
  probe(["apply", ...target, "--journal", journal]);
  const moved = await command("move");
  const refusal = probe(["restore", "--journal", journal], true);
  assert.equal(refusal.status, 1);
  assert.match(refusal.value.error, /Window moved, closed, or is ambiguous/);
  assert.ok(matches(readState().frame, moved.frame), "Restore must preserve the subsequent move");
  results.push({ scenario: "user-move-refusal", passed: true });

  await command("minimum");
  const minimumJournal = join(output, "minimum.json");
  const minimum = probe(["apply", ...target, "--journal", minimumJournal]).value;
  await hostMatches(minimum.observed);
  probe(["restore", "--journal", minimumJournal]);
  await hostMatches(minimum.before);
  results.push({ scenario: "minimum-size", phase: minimum.phase, applied: minimum });

  await command("minimize");
  await until(() => readState()?.minimized, "minimize completion");
  const minimized = probe(["plan", ...target], true);
  assert.equal(minimized.status, 1);
  // AppKit can expose a minimized window with a nonstandard subrole; either guard
  // must refuse it before writing geometry.
  assert.match(minimized.value.error, /Minimized windows|Only standard application windows/);
  results.push({ scenario: "minimized-refusal", passed: true });
  console.log(JSON.stringify({ ok: true, output, results }, null, 2));
} finally {
  writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
  if (pid) {
    writeFileSync(control, JSON.stringify({ id: randomUUID(), action: "quit" }));
    await until(() => host.exitCode !== null, "fixture exit").catch(() => {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* Already exited. */
      }
    });
  }
  // Only the wrapper and the fixture process it owns are involved in cleanup.
  if (host.exitCode === null) host.kill("SIGTERM");
}
