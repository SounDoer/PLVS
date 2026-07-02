import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(currentDir, "App.jsx"), "utf8");
const appHeaderPath = join(currentDir, "components", "AppHeader.jsx");
const appHeaderSource = existsSync(appHeaderPath) ? readFileSync(appHeaderPath, "utf8") : "";
const toolbarSource = `${appSource}\n${appHeaderSource}`;

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

  it("exposes dialogue VAD IPC wrappers", () => {
    const commandsSource = readFileSync(join(currentDir, "ipc", "commands.js"), "utf8");
    expect(commandsSource).toContain("export function setDialogueGating(enabled)");
    expect(commandsSource).toContain("export function setDialogueVadEngine(engine)");
    expect(commandsSource).toContain('invoke("set_dialogue_vad_engine"');
  });

  it("uses a slightly larger device icon to match neighboring toolbar glyphs visually", () => {
    expect(toolbarSource).toContain('<Volume2 className="size-4 shrink-0" />');
  });

  it("uses a short toolbar label for devices", () => {
    expect(toolbarSource).toContain('tip="Devices"');
    expect(toolbarSource).toMatch(/>\s*Devices\s*<\/p>/);
    expect(toolbarSource).not.toContain('tip="Audio Device"');
    expect(toolbarSource).not.toMatch(/>\s*Audio Device\s*<\/p>/);
  });

  it("uses formatted audio device labels in both the picker and footer", () => {
    expect(toolbarSource).toContain("formatAudioDeviceLabel(device.label)");
    expect(appSource).toContain("formatAudioDeviceLabel(deviceName)");
    expect(appSource).toContain("const footerDeviceLabel = deviceDisplay");
    expect(appSource).toContain("deviceDisplay.secondary || deviceDisplay.primary");
    expect(appSource).toContain("{footerDeviceLabel}");
    expect(toolbarSource).not.toContain("title={label.full}");
    expect(appSource).not.toContain("title={deviceDisplay?.full}");
    expect(toolbarSource).toContain("w-auto max-w-[92vw]");
  });

  it("does not sync live vectorscope selection from snapshot display audio", () => {
    expect(appSource).not.toContain("const x = Number.isFinite(displayAudio?.vectorscopePairX)");
    expect(appSource).not.toContain("displayAudio?.vectorscopePairY,");
  });

  it("syncs restored analysis controls through the aggregate request set", () => {
    expect(appSource).toContain("deriveAnalysisRequests(workspaceState)");
    expect(appSource).toContain("setAnalysisRequests(analysisRequests)");
    expect(appSource).not.toContain("sendTrackedVectorscopePair");
    expect(appSource).not.toContain("sendTrackedSpectrumChannel");
  });

  it("does not keep a frame-to-controls pending vectorscope guard in per-instance mode", () => {
    expect(appSource).not.toContain("pendingVectorscopePairSyncRef");
    expect(appSource).toContain("setAnalysisRequests(analysisRequests)");
  });

  it("routes realtime analysis results through request-keyed maps", () => {
    const spectrumSource = readFileSync(
      join(currentDir, "components", "panels", "SpectrumPanel.jsx"),
      "utf8"
    );
    const vectorscopeSource = readFileSync(
      join(currentDir, "components", "panels", "VectorscopePanel.jsx"),
      "utf8"
    );

    expect(spectrumSource).toContain("spectrumRequestKeyFromControls(panelControls)");
    expect(spectrumSource).toContain("displayAudio?.spectrumResultsByKey?.[spectrumKey]");
    expect(vectorscopeSource).toContain("vectorscopeRequestKeyFromControls(panelControls)");
    expect(vectorscopeSource).toContain("displayAudio?.vectorscopeResultsByKey?.[vectorscopeKey]");
  });

  it("keeps settings persistence behind useSettings", () => {
    expect(appSource).not.toContain('from "./persistence/index.js"');
    expect(appSource).toContain("} = useSettings({ onClearRef });");
    expect(appSource).toContain("channelLabelOverrides,");
    expect(appSource).toContain("setChannelLabelOverrides,");
  });

  it("wires per-count channel label overrides into live label contexts", () => {
    expect(appSource).toContain(
      "const overrideLabels = useMemo(\n    () => (channelLabelOverride ? roleTokensToLabels(channelLabelOverride) : null),"
    );
    expect(appSource).toContain(
      'resolvedLayout: channelCount === 0 ? "stereo" : layoutResolution.resolved,'
    );
    expect(appSource).toContain("overrideLabels,");
    expect(appSource).toContain("channelLabelOverrides,");
    expect(appSource).toContain("setChannelLabelOverrides((prev) =>");
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
    expect(appSource).toContain("workspaceState.panelOrder.some((panelId) => {");
    expect(appSource).toContain('if (panel?.moduleId !== "stats") return false;');
    expect(appSource).toContain("getPanelControls(workspaceState, panelId)");
    expect(appSource).not.toContain(
      "() => normalizedPanelControls.statsVisibleIds.some((id) => DIALOGUE_STAT_IDS.includes(id))"
    );
    const syncStart = appSource.indexOf("dialogueGatingRef.current = dialogueGating;");
    expect(syncStart).toBeGreaterThan(-1);
    const syncEnd = appSource.indexOf("}, [dialogueGating]);", syncStart);
    expect(syncEnd).toBeGreaterThan(syncStart);
    const syncBody = appSource.slice(syncStart, syncEnd);

    expect(syncBody).toContain("setDialogueGating(dialogueGating)");
    expect(syncBody).not.toContain("!running");
    expect(appSource).toContain("const dialogueVadEngine = useMemo(() => {");
    expect(appSource).toContain(
      "return controls.dialogueVadEngine ?? DEFAULT_DIALOGUE_VAD_ENGINE;"
    );
    expect(appSource).toContain("dialogueVadEngineRef.current = dialogueVadEngine;");
    expect(appSource).toContain("setDialogueVadEngine(dialogueVadEngine)");
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
    expect(toolbarSource).toMatch(/import\s*\{[^}]*\bBookmark\b[^}]*\}\s*from\s*"lucide-react"/);
    expect(toolbarSource).toContain('tip="Presets"');
    expect(toolbarSource).toContain("<PresetsPopoverContent");
  });

  it("renders a Focus View toolbar popover with active state", () => {
    expect(toolbarSource).toMatch(/import\s*\{[^}]*\bFocus\b[^}]*\}\s*from\s*"lucide-react"/);
    expect(toolbarSource).toContain('tip="Views"');
    expect(toolbarSource).toContain("<FocusViewPopoverContent");
    expect(toolbarSource).toContain("pinned={pinned}");
    expect(toolbarSource).toContain("setPinned={setPinned}");
    expect(appSource).toContain("const focusViewActive =");
    expect(appSource).toContain("panelOpacity < 100");
    expect(toolbarSource).toContain('className={focusViewActive ? "text-foreground" : undefined}');
  });

  it("places Focus View before Presets in the toolbar", () => {
    expect(toolbarSource.indexOf('tip="Views"')).toBeLessThan(
      toolbarSource.indexOf('tip="Presets"')
    );
  });

  it("moves the Pin toolbar control into Focus View", () => {
    expect(appSource).not.toMatch(/import\s*\{[^}]*\bPin\b[^}]*\}\s*from\s*"lucide-react"/);
    expect(appSource).not.toMatch(/import\s*\{[^}]*\bPinOff\b[^}]*\}\s*from\s*"lucide-react"/);
    expect(appSource).not.toContain('tip={pinned ? "Unpin" : "Pin"}');
  });

  it("wires Focus View shell overlay hot zones and Escape reveal", () => {
    expect(appSource).toContain("SHELL_INNER_FOCUS");
    expect(toolbarSource).toContain("SHELL_HEADER_OVERLAY");
    expect(appSource).toContain("SHELL_FOOTER_OVERLAY");
    expect(appSource).toContain("SHELL_TOP_REVEAL_HOT_ZONE");
    expect(appSource).toContain("SHELL_BOTTOM_REVEAL_HOT_ZONE");
    expect(appSource).toContain('e.key === "Escape" && autoHideControls && !editable');
    expect(appSource).toContain("showFocusControls");
  });

  it("suppresses the native WebView context menu globally", () => {
    expect(appSource).toContain("preventNativeContextMenu");
    expect(appSource).toContain('window.addEventListener("contextmenu", preventNativeContextMenu)');
    expect(appSource).toContain(
      'window.removeEventListener("contextmenu", preventNativeContextMenu)'
    );
  });

  it("keeps auto-hidden controls mounted while toolbar popovers are open", () => {
    expect(appSource).toContain(
      "const [focusControlsHeld, setFocusControlsHeld] = useState(false);"
    );
    expect(appSource).toContain("if (focusControlsHeld) return;");
    expect(appSource).toContain("const holdFocusControls = useCallback((open) => {");
    expect(appSource).toContain("const releaseFocusControlsHold = useCallback(() => {");
    expect(appSource).toContain("holdFocusControls(true);");
    expect(appSource).toContain("onPointerUp={releaseFocusControlsHold}");
    expect(appSource).toContain('window.addEventListener("pointerup", releaseAfterDrag');
    expect(appSource).toContain("focusControlsDragTimerRef.current = window.setTimeout");
    expect(toolbarSource).toContain(
      "onOpenChange={autoHideControls ? holdFocusControls : undefined}"
    );
  });

  it("uses shared footer status classes", () => {
    expect(appSource).toContain("FOOTER_LABEL");
    expect(appSource).toContain("FOOTER_VALUE");
    expect(appSource).toContain("FOOTER_DIVIDER");
    expect(appSource).not.toContain('className="text-[10px] tracking-[0.06em]');
    expect(appSource).not.toContain('className="mx-3.5 h-3 w-px shrink-0 bg-border"');
    expect(appSource).not.toContain(
      'className="min-w-0 truncate text-xs text-primary hover:underline"'
    );
    expect(appSource).not.toContain('cn(FOOTER_VALUE, "text-foreground")');
    expect(appSource).not.toContain(
      'FOOTER_VALUE,\n                  deviceDisplay ? "text-foreground"'
    );
  });

  it("keeps the Presets toolbar icon in the default muted state", () => {
    expect(appSource).not.toContain('className={presets.activeId ? "text-foreground" : undefined}');
  });

  it("renames the Layout & Modules tooltip to Modules", () => {
    expect(toolbarSource).toContain('tip="Modules"');
    expect(toolbarSource).not.toContain('tip="Layout & Modules"');
  });

  it("exposes file analysis probing through the frontend IPC wrapper", () => {
    const commandsSource = readFileSync(join(currentDir, "ipc", "commands.js"), "utf8");
    expect(commandsSource).toContain("export function probeFileAnalysis(path)");
    expect(commandsSource).toContain('return invoke("file_analysis_probe", { path });');
  });

  it("exposes file analysis start and stop through frontend IPC wrappers", () => {
    const commandsSource = readFileSync(join(currentDir, "ipc", "commands.js"), "utf8");
    expect(commandsSource).toContain(
      "export async function startFileAnalysis({ path, probe, onFrame })"
    );
    expect(commandsSource).toContain(
      'await invoke("file_analysis_start", { path, probe, onFrame: onAudio });'
    );
    expect(commandsSource).toContain("export function stopFileAnalysis()");
    expect(commandsSource).toContain('return invoke("file_analysis_stop");');
  });

  it("clears active presets on manual window bounds changes", () => {
    const eventsSource = readFileSync(join(currentDir, "ipc", "events.js"), "utf8");
    expect(eventsSource).toContain("export async function onWindowBoundsChanged");
    expect(eventsSource).toContain('listen("window-bounds-changed"');
    expect(appSource).toContain("onWindowBoundsChanged(() => {");
    expect(appSource).toContain("presets.clearActive();");
    expect(appSource).toContain("suppressPresetDivergenceUntilRef");
  });

  it("renders the source-aware transport cluster instead of separate status and transport controls", () => {
    expect(existsSync(appHeaderPath)).toBe(true);

    expect(appSource).toContain('import { AppHeader } from "./components/AppHeader.jsx";');
    expect(appSource).toContain("<AppHeader");
    expect(appSource).not.toContain(
      'import { SourceTransportCluster } from "./components/SourceTransportCluster.jsx";'
    );
    expect(appHeaderSource).toContain(
      'import { SourceTransportCluster } from "./SourceTransportCluster.jsx";'
    );
    expect(appHeaderSource).toContain("<SourceTransportCluster");
    expect(toolbarSource).not.toContain("<StatusPill");
    expect(toolbarSource).not.toContain("<TransportButton");
  });

  it("derives transport state from source mode and session state", () => {
    expect(appSource).toContain('const [sourceMode, setSourceMode] = useState("live");');
    expect(appSource).toContain("deriveSourceTransportState({");
    expect(appSource).toContain("sourceMode,");
    expect(appSource).toContain("latestTimestampMs");
    expect(appSource).toContain("elapsedMs: elapsedMsRef.current");
  });

  it("exposes file analysis events through frontend event wrappers", () => {
    const eventsSource = readFileSync(join(currentDir, "ipc", "events.js"), "utf8");
    expect(eventsSource).toContain("export function onFileAnalysisProgress(handler)");
    expect(eventsSource).toContain('listen("file-analysis-progress"');
    expect(eventsSource).toContain("export function onFileAnalysisCompleted(handler)");
    expect(eventsSource).toContain('listen("file-analysis-completed"');
    expect(eventsSource).toContain("export function onFileAnalysisError(handler)");
    expect(eventsSource).toContain('listen("file-analysis-error"');
  });

  it("opens files through the dialog plugin wrapper", () => {
    const dialogSource = readFileSync(join(currentDir, "ipc", "fileDialog.js"), "utf8");
    expect(dialogSource).toContain('from "@tauri-apps/plugin-dialog"');
    expect(dialogSource).toContain("export async function pickMediaFile()");
    expect(appSource).toContain("pickMediaFile");
  });

  it("wires file analysis hook, drop overlay, and summary into App", () => {
    expect(appSource).toContain("useFileAnalysisEngine({");
    expect(appSource).toContain('<FileDropOverlay active={sourceMode === "file"}');
    expect(appSource).toContain("<FileAnalysisSummary");
    expect(appSource).toContain("createInitialFileHistory()");
    expect(appSource).toContain("setFileRunRequest");
    expect(appSource).toContain("activeFileSession");
    expect(appSource).toContain("analyzingFileSession");
    expect(appSource).toContain("updateFileSession");
  });
});
