import assert from "node:assert/strict";

export async function runTrayContract({
  invoke,
  instances,
  until,
  steps,
  firstInstance,
  screenshotPath,
}) {
  const inspect = () => invoke(["tray", "inspect"]);
  const tokens = ({ revision, uiGeneration }) => [
    "--expected-revision",
    String(revision),
    "--expected-ui-generation",
    String(uiGeneration),
  ];
  const action = (name, item, state = inspect(), options) =>
    invoke(["tray", name, ...(item ? ["--item", item] : []), ...tokens(state)], options);
  const initial = await until(
    () => invoke(["tray", "inspect"], { allowUnavailable: true }),
    "the owning Workbench's Tray"
  );
  const supportsPanel = process.platform !== "linux";
  assert.equal(initial.presentation, supportsPanel ? "panel" : "native");
  assert.equal(invoke(["capabilities"]).features.tray.panel, supportsPanel);

  const owner = `workbench:${firstInstance}`;
  const source = initial.items.find(({ key }) => key === `${owner}:source`);
  const preset = initial.items.find(({ key }) => key === `${owner}:preset`);
  const automatic = source.items.find(({ text }) => text === "Automatic");
  assert.equal(automatic.checked, true);
  assert.ok(preset);
  assert.equal(initial.visible, supportsPanel ? false : null);

  if (supportsPanel) {
    const root = action("open");
    assert.equal(root.visible, true);
    const openedSource = action("open", source.key);
    assert.equal(openedSource.navigation.pickerKey, source.key);
    action("activate", automatic.key, root, { expectedError: "uiGenerationConflict" });
    assert.equal(action("activate", automatic.key).visible, true);
    const group = source.items.find(({ kind }) => kind === "group");
    if (group) assert.deepEqual(action("open", group.key).navigation.groupKeys, [group.key]);
    const captured = invoke([
      "visual",
      "screenshot",
      "--target",
      "tray",
      ...tokens(inspect()),
      "--out",
      screenshotPath,
    ]);
    assert.equal(captured.target.kind, "tray");
    assert.ok(captured.artifact.width > 400 && captured.artifact.height > 0);
    assert.equal(action("open", preset.key).navigation.pickerKey, preset.key);
    assert.equal(action("activate", `${owner}:window`).visible, true);
    assert.equal(invoke(["window", "inspect"]).visible, false);
    assert.equal(action("activate", `${owner}:window`).visible, true);
    assert.equal(invoke(["window", "inspect"]).visible, true);
    assert.equal(action("close").visible, false);
    invoke(["visual", "screenshot", "--target", "tray", "--out", screenshotPath], {
      expectedError: "targetUnavailable",
    });
    action("open");
    assert.equal(action("activate", `${owner}:settings`).visible, false);
    await until(
      () => invoke(["ui", "inspect"]).surfaces.find(({ kind }) => kind === "settings"),
      "Settings opened from the Tray"
    );
    steps.push(
      "open both Tray pickers, verify screenshot and stale tokens, toggle visibility and open Settings"
    );
  } else {
    action("open", source.key, initial, { expectedError: "controlUnavailable" });
    invoke(["visual", "screenshot", "--target", "tray", "--out", screenshotPath], {
      expectedError: "targetUnavailable",
    });
    steps.push("inspect the Linux host menu and confirm the custom panel is unavailable");
  }

  const revision = invoke(["window", "inspect"]).revision;
  invoke(["window", "hide", "--expected-revision", String(revision)]);
  const hidden = invoke(["window", "inspect"]);
  assert.equal(hidden.visible, false);
  assert.equal(
    invoke(["window", "locate", "--expected-revision", String(hidden.revision)]).visible,
    true
  );
  assert.equal(invoke(["window", "inspect"]).visible, true);
  steps.push("hide and locate the Workbench through Window Control");

  if (supportsPanel) {
    action("open");
    assert.equal(action("activate", "app:new-workbench").visible, false);
  } else {
    invoke(["workbench", "open", "--expected-revision", String(invoke(["inspect"]).revision)]);
  }
  const peer = await until(
    () => instances().find(({ instanceId }) => instanceId !== firstInstance),
    "a second Workbench"
  );
  const branchKey = `workbench:${peer.instanceId}`;
  const branch = await until(
    () => inspect().items.find(({ key }) => key === branchKey),
    "Tray menu for the second Workbench"
  );
  assert.ok(branch.items.some(({ key }) => key === `${branchKey}:locate`));
  if (supportsPanel) {
    assert.equal(action("open", branchKey).navigation.branchKey, branchKey);
    assert.equal(action("activate", `${branchKey}:locate`).visible, true);
    assert.equal(action("close").visible, false);
  }
  const peerWindow = await until(
    () => invoke(["window", "inspect"], { instance: peer.instanceId, allowUnavailable: true }),
    "Agent Control in the second Workbench"
  );
  invoke(["window", "locate", "--expected-revision", String(peerWindow.revision)], {
    instance: peer.instanceId,
  });
  invoke(["tray", "inspect"], { instance: peer.instanceId, expectedError: "controlUnavailable" });
  const peerRevision = invoke(["inspect"], { instance: peer.instanceId }).revision;
  invoke(["workbench", "quit", "--expected-revision", String(peerRevision)], {
    instance: peer.instanceId,
  });
  await until(() => instances().length === 1, "the second Workbench exits");
  steps.push("verify Tray ownership, peer branch Locate, and per-Workbench Window Control");
}
