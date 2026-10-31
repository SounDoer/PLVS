import { normalizePanelPresentation } from "../lib/panelPresentation.js";
import { useMemo, useState } from "react";
import { AppShell } from "../components/AppShell.jsx";
import { ThemePreview } from "../components/theme-editor/ThemePreview.jsx";
import { DockStrip } from "../dock/DockStrip.jsx";
import { LoudnessProfilePreviewProvider } from "../hooks/LoudnessProfileContext.jsx";
import { createStarterProfile } from "../lib/loudnessProfileCatalog.js";
import { deriveSourceTransportState } from "../lib/sourceTransportState.js";
import { DEFAULT_FOCUS_VIEW } from "../lib/focusView.js";
import { portableToStoredTheme } from "../theme/portableTheme.js";
import { portableToStoredPreset } from "../transfer/portablePreset.js";
import {
  FrameDataProvider,
  HistoryDataProvider,
  MetricsDataProvider,
  PanelChromeProvider,
} from "../workspace/AudioDataContext.jsx";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
import { DragProvider } from "../workspace/DragContext.jsx";
import { SplitLayout } from "../workspace/SplitLayout.jsx";
import { WorkspacePreviewProvider } from "../workspace/WorkspaceContext.jsx";
import { buildSharesetsPreviewFixtureValues } from "./fixture.js";
import { MULTICHANNEL_MONITORING_PRESET } from "./multichannelMonitoringPreset.js";
import { DEFAULT_PRESET_NAME } from "../lib/defaultPreset.js";

const noop = () => {};

/**
 * Optional inputs used by the homepage renderer; Sharesets assets never pass them, and the empty
 * scene reproduces their output exactly.
 * @typedef {{
 *   snapshotOffsetSec?: number,
 *   elapsedMs?: number,
 *   sourceLabel?: string,
 *   deviceLabel?: string,
 *   fullShell?: boolean,
 * }} PreviewScene
 */
const EMPTY_SCENE = /** @type {PreviewScene} */ (Object.freeze({}));

/** Transport state for a LIVE session, at the final frame or at a Snapshot offset. */
function liveTransportState(fixture, snapshot, scene) {
  const elapsedMs = scene.elapsedMs ?? fixture.clock.durationMs;
  const offsetSec = scene.snapshotOffsetSec ?? (snapshot ? 0 : -1);
  return deriveSourceTransportState({
    sourceMode: "live",
    running: true,
    elapsedMs,
    selectedOffset: offsetSec,
    selectedSnapshotTimeMs: offsetSec >= 0 ? elapsedMs - offsetSec * 1000 : undefined,
  });
}

function FixedProviders({
  fixture,
  profile,
  snapshot = false,
  snapshotOffsetSec = undefined,
  presentation = undefined,
  docked = false,
  children,
}) {
  const values = useMemo(
    () => buildSharesetsPreviewFixtureValues(fixture, { snapshot, snapshotOffsetSec }),
    [fixture, snapshot, snapshotOffsetSec]
  );
  const historyData = useMemo(
    () => ({ ...values.historyData, referenceLufs: profile?.referenceLufs ?? null }),
    [values.historyData, profile]
  );
  return (
    <LoudnessProfilePreviewProvider document={profile}>
      <FrameDataProvider value={values.frameData}>
        <HistoryDataProvider value={historyData}>
          <MetricsDataProvider value={values.metricsData}>
            <PanelChromeProvider
              value={{
                ...normalizePanelPresentation(presentation)[docked ? "dock" : "workspace"],
                docked,
              }}
            >
              {children}
            </PanelChromeProvider>
          </MetricsDataProvider>
        </HistoryDataProvider>
      </FrameDataProvider>
    </LoudnessProfilePreviewProvider>
  );
}

function profileForPreset(plan) {
  const id = plan.item.document.loudnessProfile.dependencyId;
  return id === null
    ? null
    : plan.dependencies.find((dependency) => dependency.id === id)?.document;
}

function compilePreset(plan) {
  return portableToStoredPreset(plan.item.document, "sharesets-preview", {
    resolveDependencyId: (id) => id,
  });
}

function previewLibrary(profile) {
  return /** @type {import("../hooks/LoudnessProfileContext.jsx").LoudnessProfileApi} */ (
    /** @type {Partial<import("../hooks/LoudnessProfileContext.jsx").LoudnessProfileApi>} */ ({
      active: "preview",
      document: profile,
      profiles: profile ? [profile] : [],
      referenceLufs: profile?.referenceLufs ?? null,
      draft: null,
      draftBlocksLibraryActions: false,
      beginCreate: noop,
      beginEdit: noop,
      removeProfile: noop,
      select: noop,
      selectOff: noop,
      reorderProfiles: noop,
    })
  );
}

const PREVIEW_PRESETS = {
  list: [{ id: "sharesets-preview-default-preset", name: DEFAULT_PRESET_NAME }],
  activeId: "sharesets-preview-default-preset",
  dirty: false,
  blocked: false,
  save: noop,
  apply: noop,
  update: noop,
  rename: noop,
  remove: noop,
  reorder: noop,
};

function FullWorkspaceExample({
  fixture,
  profile,
  snapshot,
  state,
  presetName = DEFAULT_PRESET_NAME,
  scene = EMPTY_SCENE,
}) {
  const snapshotOffsetSec = scene.snapshotOffsetSec;
  const values = useMemo(
    () => buildSharesetsPreviewFixtureValues(fixture, { snapshot, snapshotOffsetSec }),
    [fixture, snapshot, snapshotOffsetSec]
  );
  const historyData = useMemo(
    () => ({ ...values.historyData, referenceLufs: profile?.referenceLufs ?? null }),
    [values.historyData, profile]
  );
  const sourceTransportState = useMemo(
    () => liveTransportState(fixture, snapshot, scene),
    [fixture, snapshot, scene]
  );
  const deviceLabel = scene.deviceLabel ?? "Preview Audio";
  const [openMenu, setOpenMenu] = useState(null);
  const loudnessProfile = useMemo(() => previewLibrary(profile), [profile]);
  const shellHandlers = useMemo(
    () => ({
      hideFocusControlsNow: noop,
      hideFocusControlsLater: noop,
      showFocusControls: noop,
      handleWindowDrag: noop,
      releaseFocusControlsHold: noop,
    }),
    []
  );
  const headerProps = {
    autoHideControls: false,
    onPointerEnter: noop,
    onPointerLeave: noop,
    onPointerDown: noop,
    onPointerUp: noop,
    onPointerCancel: noop,
    sourceTransportState,
    notice: null,
    sourceMode: "live",
    onSourceModeChange: noop,
    onSourceTransportAction: noop,
    onClear: noop,
    clearDisabled: false,
    isTauriApp: true,
    onOpenFile: noop,
    audioDevices: [{ id: "sharesets-preview-audio", label: deviceLabel }],
    audioOutputs: [{ id: "sharesets-preview-audio", label: deviceLabel }],
    audioInputs: [],
    captureApplications: [],
    safeAudioDeviceId: "sharesets-preview-audio",
    setCaptureDeviceId: noop,
    openMenu,
    onMenuOpenChange: (menu, open) =>
      setOpenMenu((current) => (open ? menu : current === menu ? null : current)),
    focusView: DEFAULT_FOCUS_VIEW,
    pinned: false,
    setPinned: noop,
    setAutoHideControls: noop,
    setCompactPanels: noop,
    setBorderless: noop,
    surfaceOpacity: 100,
    setSurfaceOpacity: noop,
    glassEnabled: false,
    setGlassEnabled: noop,
    showDock: true,
    dockEdge: null,
    onDockChange: noop,
    dockDisabled: false,
    presets: PREVIEW_PRESETS,
    loudnessProfile,
    loudnessProfileStats: null,
    onExportLibraryItem: noop,
    setSettingsOpen: noop,
  };

  return (
    <LoudnessProfilePreviewProvider document={profile}>
      <WorkspacePreviewProvider state={state}>
        <AppShell
          frameData={values.frameData}
          historyData={historyData}
          metricsData={values.metricsData}
          runtimeEnginesProps={null}
          fileDropProps={null}
          focusView={DEFAULT_FOCUS_VIEW}
          focusControlsVisible
          shellHandlers={shellHandlers}
          headerProps={headerProps}
          showFileAnalysisResult={false}
          fileSummaryProps={null}
          panelChromeData={
            normalizePanelPresentation(state?.panelPresentation, state?.focusView).workspace
          }
          footer={{
            sourceLabel: scene.sourceLabel ?? "Preview Audio",
            loudnessProfileName: profile?.name ?? null,
            activePresetName: presetName,
          }}
        />
      </WorkspacePreviewProvider>
    </LoudnessProfilePreviewProvider>
  );
}

/** @param {{ plan: any, state?: any, profile?: any, snapshot?: boolean, fullShell?: boolean, presetName?: string, scene?: PreviewScene }} props */
function WorkspaceExample({
  plan,
  state: stateOverride,
  profile: profileOverride,
  snapshot = false,
  fullShell = false,
  presetName,
  scene = EMPTY_SCENE,
}) {
  const preset = useMemo(() => (stateOverride ? null : compilePreset(plan)), [plan, stateOverride]);
  const state = stateOverride ?? preset;
  const profile = profileOverride === undefined ? profileForPreset(plan) : profileOverride;
  if (fullShell) {
    return (
      <FullWorkspaceExample
        fixture={plan.fixture}
        profile={profile}
        snapshot={snapshot}
        state={state}
        presetName={presetName}
        scene={scene}
      />
    );
  }
  return (
    <FixedProviders
      fixture={plan.fixture}
      profile={profile}
      snapshot={snapshot}
      snapshotOffsetSec={scene.snapshotOffsetSec}
      presentation={normalizePanelPresentation(state?.panelPresentation, state?.focusView)}
    >
      <WorkspacePreviewProvider state={state}>
        <DragProvider onDrop={noop}>
          <div className="flex h-screen w-screen bg-background text-foreground">
            <SplitLayout />
          </div>
        </DragProvider>
      </WorkspacePreviewProvider>
    </FixedProviders>
  );
}

function DockExample({ plan, scene = EMPTY_SCENE }) {
  const preset = useMemo(() => compilePreset(plan), [plan]);
  const profile = profileForPreset(plan);
  const dock = preset.dock;
  const panels = dock.panelOrder.map((id) => dock.panelsById[id]);
  const sourceTransportState = liveTransportState(plan.fixture, false, scene);
  return (
    <FixedProviders
      fixture={plan.fixture}
      profile={profile}
      snapshotOffsetSec={scene.snapshotOffsetSec}
      presentation={preset.panelPresentation}
      docked
    >
      <DockStrip
        panels={panels}
        controls={{
          sharedFrequencyViewport: preset.axisViewports?.frequency,
          controlsByPanelId: dock.controlsByPanelId,
          sourceTransportState,
        }}
        edge={dock.edge}
        height={dock.height}
        heightResizeDisabled
        panelSizesById={dock.panelSizesById}
        panelResizeDisabled
      />
    </FixedProviders>
  );
}

function ThemeSemanticExample({ plan }) {
  const stored = useMemo(
    () => portableToStoredTheme(plan.theme.document, "custom-sharesets-preview"),
    [plan]
  );
  return <ThemePreview draft={stored} onClose={noop} />;
}

/**
 * @param {string} moduleId
 */
function singlePanelState(moduleId) {
  const panel = DEFAULT_WORKSPACE_STATE.panelsById[moduleId];
  return {
    ...DEFAULT_WORKSPACE_STATE,
    tree: { type: "leaf", tabs: [moduleId], activeTab: moduleId },
    panelsById: { [moduleId]: panel },
    panelOrder: [moduleId],
    panelControlsById: {
      [moduleId]: DEFAULT_WORKSPACE_STATE.panelControlsById[moduleId],
    },
  };
}

function ThemeProductExample({ plan, sceneId, scene }) {
  const moduleId =
    sceneId === "spectrogram-heatmap" ? "spectrogram" : sceneId.replace(/-file$/, "");
  const normalizedModuleId =
    moduleId === "level-meter" ? "levelMeter" : moduleId === "stereo-map" ? "stereo-map" : moduleId;
  const isWorkspace = sceneId === "workspace-file" || sceneId === "workspace-snapshot";
  const state = isWorkspace ? DEFAULT_WORKSPACE_STATE : singlePanelState(normalizedModuleId);
  const syntheticPlan = {
    fixture: plan.fixture,
    item: { document: null },
    dependencies: [],
  };
  const profile = useMemo(
    () => createStarterProfile(() => "sharesets-preview-default-profile"),
    []
  );
  return (
    <WorkspaceExample
      plan={syntheticPlan}
      state={state}
      profile={profile}
      snapshot={sceneId === "workspace-snapshot"}
      fullShell={isWorkspace}
      scene={scene}
    />
  );
}

function MultichannelMonitoringExample({ plan, fullShell, scene }) {
  const state = useMemo(
    () => portableToStoredPreset(MULTICHANNEL_MONITORING_PRESET, "multichannel-preview"),
    []
  );
  const syntheticPlan = {
    fixture: plan.multichannelFixture ?? plan.fixture,
    item: { document: null },
    dependencies: [],
  };
  return (
    <WorkspaceExample
      plan={syntheticPlan}
      state={state}
      profile={null}
      fullShell={fullShell}
      presetName="Multichannel Monitoring"
      scene={scene}
    />
  );
}

/** @param {{ plan: any, asset: any, scene?: PreviewScene }} props */
export function SharesetsPreviewApp({ plan, asset, scene = EMPTY_SCENE }) {
  if (asset.renderer === "preset-workspace") {
    const fixture =
      asset.fixtureKey === "5.1" ? (plan.multichannelFixture ?? plan.fixture) : plan.fixture;
    return (
      <WorkspaceExample
        plan={{ ...plan, fixture }}
        fullShell={scene.fullShell === true}
        scene={scene}
      />
    );
  }
  if (asset.renderer === "preset-dock") return <DockExample plan={plan} scene={scene} />;
  if (asset.renderer === "semantic-gallery") return <ThemeSemanticExample plan={plan} />;
  if (
    asset.renderer === "multichannel-monitoring-prototype" ||
    asset.renderer === "multichannel-monitoring"
  ) {
    return (
      <MultichannelMonitoringExample
        plan={plan}
        fullShell={asset.surface === "theme"}
        scene={scene}
      />
    );
  }
  if (asset.renderer === "product-gallery") {
    return <ThemeProductExample plan={plan} sceneId={asset.sceneId} scene={scene} />;
  }
  throw new Error(`Unsupported Sharesets preview renderer: ${asset.renderer}.`);
}
