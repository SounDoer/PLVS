import { useMemo } from "react";
import { LoudnessProfileEditor } from "../components/LoudnessProfileEditor.jsx";
import { ThemePreview } from "../components/theme-editor/ThemePreview.jsx";
import { DockStrip } from "../dock/DockStrip.jsx";
import { LoudnessProfilePreviewProvider } from "../hooks/LoudnessProfileContext.jsx";
import { compileTheme } from "../theme/compileTheme.js";
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
import { buildCommunityPreviewFixtureValues } from "./fixture.js";

const noop = () => {};

function FixedProviders({ fixture, profile, children }) {
  const values = useMemo(() => buildCommunityPreviewFixtureValues(fixture), [fixture]);
  const historyData = useMemo(
    () => ({ ...values.historyData, referenceLufs: profile?.referenceLufs ?? null }),
    [values.historyData, profile]
  );
  return (
    <LoudnessProfilePreviewProvider document={profile}>
      <FrameDataProvider value={values.frameData}>
        <HistoryDataProvider value={historyData}>
          <MetricsDataProvider value={values.metricsData}>
            <PanelChromeProvider value={{ compactPanels: false }}>{children}</PanelChromeProvider>
          </MetricsDataProvider>
        </HistoryDataProvider>
      </FrameDataProvider>
    </LoudnessProfilePreviewProvider>
  );
}

function ProfileSummary({ document }) {
  const draft = useMemo(
    () => ({ editingId: "community-preview", document, dirty: false, stale: false }),
    [document]
  );
  return (
    <LoudnessProfileEditor
      draft={draft}
      onEdit={noop}
      onSave={noop}
      onCancel={noop}
      pos={{ x: 120, y: 20 }}
      onMove={noop}
    />
  );
}

function StatsExample({ plan }) {
  const profile = plan.item.document;
  const state = useMemo(() => singlePanelState("stats"), []);
  return (
    <FixedProviders fixture={plan.fixture} profile={profile}>
      <WorkspacePreviewProvider state={state}>
        <DragProvider onDrop={noop}>
          <div className="flex h-screen w-screen bg-card text-card-foreground">
            <SplitLayout />
          </div>
        </DragProvider>
      </WorkspacePreviewProvider>
    </FixedProviders>
  );
}

function profileForPreset(plan) {
  const id = plan.item.document.loudnessProfile.dependencyId;
  return id === null
    ? null
    : plan.dependencies.find((dependency) => dependency.id === id)?.document;
}

function compilePreset(plan) {
  return portableToStoredPreset(plan.item.document, "community-preview", {
    resolveDependencyId: (id) => id,
  });
}

function WorkspaceExample({ plan, state: stateOverride, profile: profileOverride }) {
  const preset = useMemo(() => (stateOverride ? null : compilePreset(plan)), [plan, stateOverride]);
  const state = stateOverride ?? preset;
  const profile = profileOverride === undefined ? profileForPreset(plan) : profileOverride;
  return (
    <FixedProviders fixture={plan.fixture} profile={profile}>
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

function DockExample({ plan }) {
  const preset = useMemo(() => compilePreset(plan), [plan]);
  const profile = profileForPreset(plan);
  const dock = preset.dock;
  const panels = dock.panelOrder.map((id) => dock.panelsById[id]);
  return (
    <FixedProviders fixture={plan.fixture} profile={profile}>
      <DockStrip
        panels={panels}
        controls={{
          controlsByPanelId: dock.controlsByPanelId,
          sourceTransportState: {
            chromeState: "ready",
            sourceLabel: "FILE",
            statusLabel: "00:15",
            actionLabel: "START",
            actionKind: "start",
            primaryActionDisabled: true,
          },
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

function themeStyle(plan) {
  const stored = portableToStoredTheme(plan.theme.document, "custom-community-preview");
  return Object.fromEntries(Object.entries(compileTheme(stored).css));
}

function ThemeSemanticExample({ plan }) {
  const stored = useMemo(
    () => portableToStoredTheme(plan.theme.document, "custom-community-preview"),
    [plan]
  );
  return <ThemePreview draft={stored} onClose={noop} />;
}

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

function ThemeProductExample({ plan, sceneId }) {
  const moduleId =
    sceneId === "spectrogram-heatmap" ? "spectrogram" : sceneId.replace(/-file$/, "");
  const normalizedModuleId =
    moduleId === "level-meter" ? "levelMeter" : moduleId === "stereo-map" ? "stereo-map" : moduleId;
  const state =
    sceneId === "workspace-file" ? DEFAULT_WORKSPACE_STATE : singlePanelState(normalizedModuleId);
  const syntheticPlan = {
    fixture: plan.fixture,
    item: { document: null },
    dependencies: [],
  };
  return (
    <div style={themeStyle(plan)} className="h-screen w-screen">
      <WorkspaceExample plan={syntheticPlan} state={state} profile={null} />
    </div>
  );
}

export function CommunityPreviewApp({ plan, asset }) {
  if (asset.renderer === "loudness-profile-summary") {
    return <ProfileSummary document={plan.item.document} />;
  }
  if (asset.renderer === "loudness-profile-stats") return <StatsExample plan={plan} />;
  if (asset.renderer === "preset-workspace") return <WorkspaceExample plan={plan} />;
  if (asset.renderer === "preset-dock") return <DockExample plan={plan} />;
  if (asset.renderer === "semantic-gallery") return <ThemeSemanticExample plan={plan} />;
  if (asset.renderer === "product-gallery") {
    return <ThemeProductExample plan={plan} sceneId={asset.sceneId} />;
  }
  throw new Error(`Unsupported Community preview renderer: ${asset.renderer}.`);
}
