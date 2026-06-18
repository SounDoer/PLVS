import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(currentDir, "App.jsx"), "utf8");

function functionBodyAfter(marker) {
  const start = appSource.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const bodyStart = appSource.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < appSource.length; i += 1) {
    if (appSource[i] === "{") depth += 1;
    if (appSource[i] === "}") depth -= 1;
    if (depth === 0) return appSource.slice(bodyStart, i + 1);
  }
  throw new Error(`Could not parse function body for ${marker}`);
}

describe("App toolbar", () => {
  it("has a frontend IPC wrapper for dynamic loudness weights", () => {
    const commandsSource = readFileSync(join(currentDir, "ipc", "commands.js"), "utf8");
    expect(commandsSource).toContain("export function setLoudnessWeights(weights)");
    expect(commandsSource).toContain('return invoke("set_loudness_weights", { weights });');
  });

  it("exposes a setDialogueGating IPC wrapper", () => {
    const commandsSource = readFileSync(join(currentDir, "ipc", "commands.js"), "utf8");
    expect(commandsSource).toContain("export function setDialogueGating(enabled)");
  });

  it("uses a slightly larger device icon to match neighboring toolbar glyphs visually", () => {
    expect(appSource).toContain('<Volume2 className="size-4 shrink-0" />');
  });

  it("uses formatted audio device labels in both the picker and footer", () => {
    expect(appSource).toContain("formatAudioDeviceLabel(device.label)");
    expect(appSource).toContain("formatAudioDeviceLabel(deviceName)");
    expect(appSource).toContain("const footerDeviceLabel = deviceDisplay");
    expect(appSource).toContain("deviceDisplay.secondary || deviceDisplay.primary");
    expect(appSource).toContain("{footerDeviceLabel}");
    expect(appSource).not.toContain("title={label.full}");
    expect(appSource).not.toContain("title={deviceDisplay?.full}");
    expect(appSource).toContain("w-[min(28rem,92vw)]");
  });

  it("does not sync live vectorscope selection from snapshot display audio", () => {
    expect(appSource).toContain("if (!running || selectedOffset >= 0) return;");
    expect(appSource).toContain("updatePanelControls((current) => {");
    expect(appSource).toContain(
      "if (current.vectorscopePair.x === x && current.vectorscopePair.y === y) return current;"
    );
    expect(appSource).toContain("displayAudio?.vectorscopePairY,");
    expect(appSource).not.toContain(
      "vectorscopePairUi.x,\n    vectorscopePairUi.y,\n    updatePanelControls,"
    );
  });

  it("syncs restored channel controls to the backend while running", () => {
    expect(appSource).toContain('const lastSentVectorscopePairKeyRef = useRef("");');
    expect(appSource).toContain('const lastSentSpectrumChannelKeyRef = useRef("");');
    expect(appSource).toContain("void sendTrackedVectorscopePair(vectorscopePairUi);");
    expect(appSource).toContain("void sendTrackedSpectrumChannel(spectrumChannelUi);");
  });

  it("does not let stale live vectorscope frames overwrite pending app changes", () => {
    expect(appSource).toContain("const pendingVectorscopePairSyncRef = useRef(null);");
    expect(appSource).toContain("pendingVectorscopePairSyncRef.current = null;");
    expect(appSource).toContain(
      "pendingVectorscopePairSyncRef.current = { x: pair.x, y: pair.y };"
    );
    expect(appSource).toContain(
      "if (pendingPair && (pendingPair.x !== x || pendingPair.y !== y)) return;"
    );
  });

  it("sets the vectorscope backend pending guard before reading live frame pairs", () => {
    const backendSyncIndex = appSource.indexOf(
      "if (!running || !isTauri()) return;\n    const next = clampVectorscopePairToAvailable("
    );
    const liveSyncIndex = appSource.indexOf(
      "if (!running || selectedOffset >= 0) return;\n    const x = Number.isFinite(displayAudio?.vectorscopePairX)"
    );

    expect(backendSyncIndex).toBeGreaterThan(-1);
    expect(liveSyncIndex).toBeGreaterThan(-1);
    expect(backendSyncIndex).toBeLessThan(liveSyncIndex);
  });

  it("writes settings state through the settingsStore", () => {
    // Legacy-key stripping + read-merge-write now live in the settingsStore domain
    // (covered by src/persistence); App just routes its fields through it.
    expect(appSource).toContain("settingsStore.patch({");
    expect(appSource).toContain('themeId: appearance === "system" ? null : fixedThemeSelectValue,');
  });

  it("wires per-count channel label overrides into live label contexts", () => {
    expect(appSource).toContain("sanitizeChannelLabelOverrides");
    expect(appSource).toContain(
      "const [channelLabelOverrides, setChannelLabelOverrides] = useState({});"
    );
    expect(appSource).toContain(
      "const overrideLabels = useMemo(\n    () => (channelLabelOverride ? roleTokensToLabels(channelLabelOverride) : null),"
    );
    expect(appSource).toContain(
      'resolvedLayout: channelCount === 0 ? "stereo" : layoutResolution.resolved,'
    );
    expect(appSource).toContain("overrideLabels,");
    expect(appSource).toContain("setChannelLabelOverrides(sanitizeChannelLabelOverrides");
    expect(appSource).toContain("channelLabelOverrides,");
    expect(appSource).toContain("channelLabelTokens={channelLabelTokens}");
    expect(appSource).toContain("setChannelLabelToken={setChannelLabelToken}");
    expect(appSource).toContain("resetChannelLabels={resetChannelLabels}");
  });

  it("wires channel label overrides to loudness weights IPC", () => {
    expect(appSource).toContain("roleTokensToLoudnessWeights");
    expect(appSource).toContain("const loudnessWeights = useMemo(");
    expect(appSource).toContain("sendTrackedLoudnessWeights");
    expect(appSource).toContain("loudnessWeightsRef");
    expect(appSource).toContain("loudnessWeightsRef,");
  });

  it("derives dialogue gating from visible dialogue stats ids and sends it", () => {
    expect(appSource).toContain("const DIALOGUE_STAT_IDS");
    expect(appSource).toContain("setDialogueGating(dialogueGating)");
  });

  it("keeps capture running when Clear resets the measurement window", () => {
    const clearAllBody = functionBodyAfter("const clearAll = async () =>");

    expect(clearAllBody).toContain("resetTimer({ restart: running });");
    expect(clearAllBody).not.toContain("setRunning(false)");
  });

  it("keeps updatePanelControls identity stable to avoid a render loop on Start", () => {
    // Regression: when updatePanelControls depended on workspaceState.panelControls, its
    // identity changed on every dispatch. Effects listing it in their deps (vectorscope/
    // spectrum clamps, displayAudio sync) then looped into "Maximum update depth exceeded"
    // on Start, unmounting the tree (black screen) and tearing down the JS-created tray.
    // It must read latest values via refs and keep empty useCallback deps.
    expect(appSource).toContain("panelControlsRef.current = normalizedPanelControls;");
    expect(appSource).toContain(
      "setWorkspacePanelControlsRef.current = setWorkspacePanelControls;"
    );
    expect(appSource).toContain("const current = panelControlsRef.current;");
    expect(appSource).toContain("setWorkspacePanelControlsRef.current(next);");
    expect(appSource).not.toContain("[workspaceState.panelControls, setWorkspacePanelControls]");
  });

  it("renders a Presets toolbar popover with a Bookmark trigger", () => {
    expect(appSource).toMatch(/import\s*\{[^}]*\bBookmark\b[^}]*\}\s*from\s*"lucide-react"/);
    expect(appSource).toContain('tip="Presets"');
    expect(appSource).toContain("<PresetsPopoverContent");
  });

  it("renames the Layout & Modules tooltip to Modules", () => {
    expect(appSource).toContain('tip="Modules"');
    expect(appSource).not.toContain('tip="Layout & Modules"');
  });
});
