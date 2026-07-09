import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(currentDir, "App.jsx"), "utf8");
const appHeaderPath = join(currentDir, "components", "AppHeader.jsx");
const appHeaderSource = existsSync(appHeaderPath) ? readFileSync(appHeaderPath, "utf8") : "";
const toolbarSource = `${appSource}\n${appHeaderSource}`;

describe("App toolbar", () => {
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
    expect(appSource).toContain("loudnessWeightsRef={loudnessWeightsRef}");
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

  it("wires Focus View shell overlay hot zones and Escape reveal", () => {
    expect(appSource).toContain("SHELL_INNER_FOCUS");
    expect(toolbarSource).toContain("SHELL_HEADER_OVERLAY");
    expect(appSource).toContain("SHELL_FOOTER_OVERLAY");
    expect(appSource).toContain("SHELL_TOP_REVEAL_HOT_ZONE");
    expect(appSource).toContain("SHELL_BOTTOM_REVEAL_HOT_ZONE");
    expect(appSource).toContain('e.key === "Escape" && autoHideControls && !editable');
    expect(appSource).toContain("showFocusControls");
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

  it("marks active presets dirty on manual window bounds changes", () => {
    const eventsSource = readFileSync(join(currentDir, "ipc", "events.js"), "utf8");
    expect(eventsSource).toContain("export async function onWindowBoundsChanged");
    expect(eventsSource).toContain('listen("window-bounds-changed"');
    expect(appSource).toContain("onWindowBoundsChanged(() => {");
    expect(appSource).toContain("presets.markDirty();");
    expect(appSource).toContain("suppressPresetDivergenceUntilRef");
  });
});
