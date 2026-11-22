import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

function revisionToken(revision) {
  return ["--expected-revision", String(revision)];
}

function assertNear(actual, expected) {
  for (const [axis, value] of Object.entries(expected)) {
    assert.ok(
      Math.abs(actual?.[axis] - value) <= 1,
      `Expected ${axis}=${value}, got ${actual?.[axis]}.`
    );
  }
}

// Windows only: the process that owns the foreground window, i.e. where keyboard input goes.
const FOREGROUND_PROCESS = `Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class PlvsForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
}
"@
$process = 0
[void][PlvsForeground]::GetWindowThreadProcessId([PlvsForeground]::GetForegroundWindow(), [ref]$process)
$process`;

function foregroundProcess() {
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", FOREGROUND_PROCESS],
    {
      encoding: "utf8",
    }
  );
  assert.equal(result.status, 0, result.stderr);
  return Number(result.stdout.trim());
}

// An opaque, activated window over every display stands in for the user's foreground app.
const OCCLUDER = `Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'
$form.BackColor = 'Black'
$form.ShowInTaskbar = $false
$form.StartPosition = 'Manual'
$form.Bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$form.Add_Shown({ $form.Activate(); [Console]::Out.WriteLine('ready'); [Console]::Out.Flush() })
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 60000
$timer.Add_Tick({ $form.Close() })
$timer.Start()
[System.Windows.Forms.Application]::Run($form)`;

async function withOccluder(run) {
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-STA", "-Command", OCCLUDER],
    {
      stdio: ["ignore", "pipe", "inherit"],
    }
  );
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("The occluding window did not open.")),
        30_000
      );
      child.stdout.on("data", (chunk) => {
        if (!String(chunk).includes("ready")) return;
        clearTimeout(timer);
        resolve();
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`The occluding window exited early (${code}).`));
      });
    });
    // Give WebView2's native occlusion tracking time to mark PLVS as covered.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    return await run(child.pid);
  } finally {
    child.kill();
  }
}

export async function runWindowContract({ invoke, until, restart, steps, screenshotPath }) {
  const inspect = () => invoke(["window", "inspect"]);
  const initial = inspect();
  const capabilities = invoke(["capabilities"]);
  const canMinimize = capabilities.features.window.minimize === true;
  assert.equal(capabilities.methods.includes("window.minimize"), canMinimize);
  assert.equal(initial.form, "normal");
  assert.equal(initial.visible, true);
  assert.equal(initial.minimized, canMinimize ? false : null);

  const action = (name, args = [], expectedRevision = inspect().revision, options) =>
    invoke(["window", name, ...args, ...revisionToken(expectedRevision)], options);
  const observe = (expected) => {
    const window = inspect();
    for (const [key, value] of Object.entries(expected)) assert.equal(window[key], value, key);
    return window;
  };
  const toSize = ({ width, height }) => ["--width", String(width), "--height", String(height)];
  const toPosition = (monitor, { x, y }) => [
    "--monitor",
    monitor,
    "--x",
    String(x),
    "--y",
    String(y),
  ];

  if (initial.maximized) action("unmaximize");
  const before = observe({ maximized: false });
  const { minimum, maximum } = capabilities.features.window.resize;
  const canMove = capabilities.features.window.move !== false;
  assert.equal(capabilities.methods.includes("window.move"), canMove);
  const smaller = (dimension) => Math.max(minimum, Math.min(maximum, Math.floor(dimension) - 96));
  const size = { width: smaller(before.size.width), height: smaller(before.size.height) };
  assert.ok(
    before.size.width - size.width > 1 || before.size.height - size.height > 1,
    "No smaller supported window size."
  );
  const sizeArgs = toSize(size);
  action("resize", sizeArgs, before.revision + 1, { expectedError: "revisionConflict" });
  assertNear(observe({ revision: before.revision }).size, before.size);
  const beforeApp = invoke(["inspect"]);
  assert.equal(action("resize", sizeArgs).changed, true);
  const resized = observe({});
  const resizedApp = invoke(["inspect"]);
  if (resizedApp.preset.dirty !== beforeApp.preset.dirty) {
    assert.ok(resizedApp.revision > beforeApp.revision);
  }
  assertNear(resized.size, size);
  if (canMove) assertNear(resized.position, before.position);
  else assert.equal(resized.position, null);
  assert.equal(action("resize", sizeArgs).changed, false);
  steps.push("verify guarded resize, unchanged position, and idempotent resize");

  if (!canMove) {
    action(
      "move",
      toPosition(resized.monitor ?? "unavailable", { x: 16, y: 16 }),
      resized.revision,
      {
        expectedError: "controlUnavailable",
      }
    );
    assertNear(observe({ position: null, revision: resized.revision }).size, size);
    steps.push(
      "verify the desktop backend withholds positioning and refuses a move without mutation"
    );
  } else {
    const { monitor, position, workArea } = resized;
    assert.ok(
      monitor && position && workArea,
      "Window inspection did not identify its current monitor."
    );
    // The shrink leaves room to move away from the work-area origin even on one display.
    const offset = { x: Math.abs(position.x) <= 1 ? 16 : 0, y: Math.abs(position.y) <= 1 ? 16 : 0 };
    const move = toPosition(monitor, offset);
    action("move", toPosition("plvs-acceptance-missing-monitor", offset), resized.revision, {
      expectedError: "monitorNotFound",
    });
    assertNear(observe({ monitor }).position, position);
    assert.equal(action("move", move).changed, true);
    await restart();
    const moved = observe({ monitor });
    assertNear(moved.position, offset);
    assertNear(moved.size, size);
    assert.equal(action("move", move).changed, false);
    steps.push("verify monitor selection, preserved size, and position after immediate restart");
  }

  for (const [name, expected] of [
    ["maximize", { maximized: true }],
    ["unmaximize", { maximized: false }],
    ["minimize", { minimized: true }],
    ["hide", { visible: false }],
  ]) {
    if (name === "minimize" && !canMinimize) {
      const { revision } = inspect();
      action(name, [], revision, { expectedError: "controlUnavailable" });
      observe({ minimized: null, revision, visible: true });
      steps.push("verify the desktop backend refuses a minimize it cannot confirm");
      continue;
    }
    assert.equal(action(name).changed, true);
    observe(expected);
    assert.equal(action(name).changed, false);
    if (name === "minimize" && screenshotPath && process.platform !== "linux") {
      // Capture reveals a window only when its WebView cannot draw (docs/agent-control/visual.md).
      // WebKit stops drawing a minimized window; WebView2's CapturePreview still renders it.
      const restores = process.platform === "darwin";
      const capture = invoke(["visual", "screenshot", "--target", "main", "--out", screenshotPath]);
      assert.ok(capture.artifact.width > 0 && capture.artifact.height > 0);
      observe({ visible: true, minimized: !restores });
      steps.push(
        restores
          ? "verify a screenshot restores a minimized window without window show"
          : "verify a minimized window is captured in place"
      );
      if (restores) {
        action("minimize");
        observe(expected);
      }
    } else if (name === "minimize" && screenshotPath) {
      steps.push("skip minimized capture: Wayland gives a client no way to restore its window");
    }
    if (name === "minimize") {
      action("show");
      await until(() => !observe({ visible: true }).minimized, "restoring the minimized window");
    }
  }
  action("maximize", [], inspect().revision, { expectedError: "windowHidden" });
  assert.equal(action("show").changed, true);
  observe({ visible: true, minimized: canMinimize ? false : null });
  assert.equal(action("show").changed, false);
  steps.push("verify maximize, restore, hide, and show");

  if (screenshotPath && process.platform === "win32") {
    await withOccluder(async (occluder) => {
      const before = foregroundProcess();
      const capture = invoke([
        "visual",
        "screenshot",
        "--target",
        "main",
        "--out",
        screenshotPath.replace(/\.png$/, "-covered.png"),
      ]);
      assert.ok(capture.artifact.width > 0 && capture.artifact.height > 0);
      assert.equal(foregroundProcess(), before, "Capture moved keyboard focus to another window.");
      steps.push(
        before === occluder
          ? "verify a fully covered window is captured while the covering app keeps keyboard focus"
          : "verify a fully covered window is captured without moving keyboard focus (cover not foreground)"
      );
    });
  }
}

export async function runWorkbenchContract({ invoke, instances, until, steps, firstInstance }) {
  const inspect = (instance) => invoke(["ui", "inspect"], { instance });
  const members = () =>
    instances()
      .map(({ instanceId }) => instanceId)
      .sort();
  const assertMembers = (expected) => assert.deepEqual(members(), [...expected].sort());
  const open = async () => {
    const { revision } = inspect(firstInstance);
    const result = invoke(["workbench", "open", ...revisionToken(revision)], {
      instance: firstInstance,
    });
    const sibling = result.instanceId;
    assert.notEqual(sibling, firstInstance);
    assert.equal(result.revision, revision);
    const ui = await until(
      () => invoke(["ui", "inspect"], { instance: sibling, allowUnavailable: true }),
      "the opened workbench frontend"
    );
    assert.equal(ui.workbench.instanceId, sibling);
    assert.equal(ui.workbench.workspaceId, result.workspaceId);
    assertMembers([firstInstance, sibling]);
    return sibling;
  };

  assertMembers([firstInstance]);
  const second = await open();
  invoke(["ui", "inspect"], { instance: null, expectedError: "instanceSelectionRequired" });
  const primary = inspect(firstInstance);
  assert.equal(primary.workbench.instanceId, firstInstance);
  assert.notEqual(primary.workbench.workspaceId, inspect(second).workbench.workspaceId);
  steps.push("verify two workbenches are independently addressable and require explicit selection");

  const { revision } = inspect(second);
  invoke(["workbench", "quit", ...revisionToken(revision + 1)], {
    instance: second,
    expectedError: "revisionConflict",
  });
  assertMembers([firstInstance, second]);
  assert.deepEqual(
    invoke(["workbench", "quit", ...revisionToken(revision)], { instance: second }),
    {
      revision,
      accepted: true,
      scope: "workbench",
    }
  );
  await until(() => !members().includes(second), "the selected workbench to quit");
  assertMembers([firstInstance]);
  assert.equal(invoke(["ui", "inspect"], { instance: null }).workbench.instanceId, firstInstance);
  steps.push("verify quitting the selected workbench leaves the other reachable");

  const third = await open();
  assert.notEqual(third, second);
  const current = inspect(firstInstance).revision;
  assert.deepEqual(
    invoke(["workbench", "quit-all", ...revisionToken(current)], { instance: firstInstance }),
    {
      revision: current,
      accepted: true,
      scope: "all",
    }
  );
  await until(() => members().length === 0, "all isolated workbenches to quit");
  steps.push("verify Quit All acknowledges the command and removes both workbenches");
}
