/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, useEffect, useState } from "react";
import { WorkspaceProvider, useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";
import { presetsStore, settingsStore, themesStore } from "../persistence/index.js";
import { getAdapter } from "../transfer/libraryAdapters.js";
import { listCustomThemes } from "../theme/customThemesRepo.js";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import { useThemeSettings } from "../hooks/useThemeSettings.js";
import { useCustomThemeSettings } from "../hooks/useCustomThemeSettings.js";
import { BlockingEditorsProvider } from "../hooks/BlockingEditorsContext.jsx";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
import { SceneOperationBlockedError } from "../lib/sceneOperations.js";
import { LoudnessProfileProvider, useLoudnessProfile } from "../hooks/LoudnessProfileContext.jsx";
import { useAgentControlBridge } from "./useAgentControlBridge.js";
import { presetWorkspaceView } from "../lib/presetWorkspaceView.js";
import { buildFileAnalysisReport } from "../lib/fileAnalysisReport.js";
import { commandEntriesForFamily, runningAppCommandEntries } from "./commandManifest.js";
import { canonicalManifestParams } from "./commandManifestTestFixtures.js";

const CLI_V1_FIXTURES = JSON.parse(
  readFileSync(join(cwd(), "shared", "cli-v1-envelope-fixtures.json"), "utf8")
);
const goldenResult = (id) => CLI_V1_FIXTURES.find((fixture) => fixture.id === id).envelope.result;

const adapter = vi.hoisted(() => ({
  handler: null,
  order: [],
  responses: [],
  unlisten: vi.fn(),
  listen: vi.fn(async (handler) => {
    adapter.order.push("listen");
    adapter.handler = handler;
    return adapter.unlisten;
  }),
  ready: vi.fn(async () => adapter.order.push("ready")),
  notReady: vi.fn(async () => adapter.order.push("not-ready")),
  respond: vi.fn(async (response) => adapter.responses.push(response)),
}));

vi.mock("../ipc/agentControlEvents.js", () => ({
  listenForAgentControlRequests: adapter.listen,
  announceAgentControlFrontendReady: adapter.ready,
  announceAgentControlFrontendNotReady: adapter.notReady,
  respondToAgentControlRequest: adapter.respond,
}));

const runtime = {
  available: true,
  appName: "PLVS Dev",
  appVersion: "0.14.5",
  identifier: "com.soundoer.plvs.dev",
  platform: "windows",
};

const publicSettings = {
  openAtLogin: false,
  closeBehavior: "ask",
  clearShortcut: { accelerator: "CmdOrCtrl+K", global: false },
  interfaceSize: "default",
  appearance: { mode: "system", themeId: null, resolvedThemeId: "plvs-dark" },
  historyRetentionSec: 3600,
  dialogueVadEngine: "firered",
  channelLabels: { channelCount: 2, mode: "auto", roles: ["L", "R"] },
};

const settingsContext = {
  autostartReady: true,
  clearShortcutReady: true,
  clearShortcutCapturing: false,
  themeOptions: [
    { id: "plvs-dark", name: "Dark", kind: "builtin" },
    { id: "plvs-light", name: "Light", kind: "builtin" },
  ],
  activeEditors: [],
  dialogueDetectionActive: false,
  sourceMode: "live",
};

const transport = {
  source: "live",
  live: {
    state: "stopped",
    requestedDeviceId: "default",
    resolvedDeviceId: null,
    startedAt: null,
    atLiveEdge: true,
    error: null,
  },
  files: { activeId: null, analyzingId: null, sessions: [] },
};

const dock = {
  supported: true,
  enabled: false,
  edge: "bottom",
  monitor: null,
  reserveSpace: true,
  height: 72,
  suspended: false,
  panelsById: { transport: { id: "transport", moduleId: "transport" } },
  panelOrder: ["transport"],
  panelSizesById: {},
  controlsByPanelId: {},
};

const DEVICE_OUTPUT_ID = "lb-0123456789abcdef0123456789abcdef";
const DEVICE_INPUT_ID = "cap-fedcba9876543210fedcba9876543210";
const deviceRows = [
  {
    id: DEVICE_OUTPUT_ID,
    label: "Speakers",
    kind: "systemOutput",
    direction: "output",
    loopback: true,
    sampleRateHz: 48_000,
    channelCount: 2,
  },
  {
    id: DEVICE_INPUT_ID,
    label: "Microphone",
    kind: "input",
    direction: "input",
    loopback: false,
    sampleRateHz: 48_000,
    channelCount: 2,
  },
];
const deviceSnapshot = {
  generation: 1,
  observedAt: "2026-09-07T10:12:40.000Z",
  automatic: {
    id: "default",
    label: "Automatic",
    available: true,
    resolved: { label: "Speakers", sampleRateHz: 48_000, channelCount: 2 },
  },
  devices: deviceRows,
  truncated: false,
  allDevices: deviceRows,
  signature: "device-fixture",
  requestedId: "default",
  migrationState: null,
  inventoryReady: true,
};
const deviceLiveStopped = { state: "stopped", transition: null, usingRequestedSelection: false };
const defaultView = {
  pinned: false,
  focusView: { autoHideControls: false, compactPanels: false, borderless: false },
  panelOpacity: 100,
  glassEnabled: false,
};

const MUTATION_METHODS = new Set([
  "workspace.applyLayout",
  "panel.update",
  "panel.reset",
  "axis.shared.update",
  "axis.shared.reset",
  "axis.panel.update",
  "axis.panel.reset",
  "preset.save",
  "preset.update",
  "preset.apply",
  "preset.rename",
  "preset.delete",
  "preset.reorder",
  "config.import",
  "settings.update",
  "view.update",
  "view.reset",
  "device.select",
  "transport.source.live",
  "transport.source.file",
  "transport.live.start",
  "transport.live.stop",
  "transport.live.clear",
  "transport.file.analyze",
  "transport.file.reanalyze",
  "transport.file.stop",
  "transport.file.select",
  "transport.file.remove",
  "transport.file.clear",
  "dock.enter",
  "dock.exit",
  "dock.layout.apply",
  "dock.panel.update",
  "dock.panel.reset",
  "preset.import",
  "theme.import",
  "theme.select",
  "theme.followSystem",
  "theme.create",
  "theme.update",
  "theme.rename",
  "theme.duplicate",
  "theme.delete",
  "theme.reorder",
  "loudnessProfile.import",
  "loudnessProfile.select",
  "loudnessProfile.create",
  "loudnessProfile.update",
  "loudnessProfile.rename",
  "loudnessProfile.delete",
  "loudnessProfile.reorder",
]);

/// A theme fixture has to survive Theme V2 validation: `normalizeThemeDocument` drops a bare
/// `{ id, name }` silently, so a pack built from one arrives with an empty `items` array.
function makeTheme(id, name) {
  return { ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]), id, name };
}

function seedThemeLibrary(themes) {
  getAdapter("themes").append(themes);
}

function readThemeLibrary() {
  return getAdapter("themes")
    .list()
    .map(({ id, name }) => ({ id, name }));
}

function request(method, params = {}, id = "req-1") {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params:
      MUTATION_METHODS.has(method) && params.expectedRevision === undefined
        ? { ...params, expectedRevision: 0 }
        : params,
  };
}

function Harness({
  enabled = true,
  flush = vi.fn(async () => {}),
  hasLoudnessReference = false,
  analysisContext = {},
  measurementContext = {},
  loudnessProfiles = [],
  loudnessProfilesFromStore = false,
  loudnessProfile = null,
  customThemes = null,
  themeState = null,
  themeControl = null,
  capturePresetSnapshot = async () => ({ tree: { type: "leaf" }, windowPinned: false }),
  assertPresetOperationAllowed = () => {},
  agentSettings = publicSettings,
  agentSettingsContext = settingsContext,
  applyAgentSettings,
  agentView = defaultView,
  agentViewContext = {},
  agentVisual = null,
  applyAgentView,
  agentTransport = transport,
  agentDock = dock,
  agentDockContext = {},
  executeAgentDock,
  controlledAgentSettings = false,
  executeAgentTransport,
  agentDevice = deviceSnapshot,
  agentDeviceLive = deviceLiveStopped,
  previewAgentDevice,
  commitAgentDevice,
  beginAgentDeviceRestart,
  deviceRuntimeUnavailable = false,
  onDeviceState = () => {},
  presets = { activeId: null, dirty: false },
  presetLibraryFromStore = false,
  applyPresetToWorkspace = false,
  presetApplyBarrier = null,
  exportConfiguration,
  importConfiguration,
  normalizeConfiguration,
  relaunchAfterConfigurationChange,
  onStore = () => {},
}) {
  const store = useWorkspaceStore();
  // A live library prop, so that a test needing the revision to see its own import gets one: with
  // a static prop the library signature effect can never fire. This stands in for App.jsx's chain
  // rather than reproducing it -- App.jsx reads `settings.customThemes` off `useSettings`, and the
  // hop out of `useThemeSettings` is exactly where `theme.import` once lost the update. That link
  // is covered by `hooks/useSettings.rtl.test.jsx`; do not read this harness as proof of it.
  const [subscribedThemes, setSubscribedThemes] = useState(() => listCustomThemes());
  useEffect(() => themesStore.subscribe(() => setSubscribedThemes(listCustomThemes())), []);
  // The same wiring for Presets, which `usePresets` gets from a `presetsStore` subscription. Off
  // by default: most tests here drive the Preset list through the controlled object below.
  const [subscribedPresets, setSubscribedPresets] = useState(() => presetsStore.read());
  useEffect(() => presetsStore.subscribe(() => setSubscribedPresets(presetsStore.read())), []);
  // And for Loudness Profiles, which `LoudnessProfileContext` keeps in sync with `plvs:settings`.
  // Off by default for the same reason as Presets: most tests pass the library as a static prop.
  const [subscribedProfiles, setSubscribedProfiles] = useState(() => getAdapter("loudness").list());
  useEffect(
    () => settingsStore.subscribe(() => setSubscribedProfiles(getAdapter("loudness").list())),
    []
  );
  const [presetState, setPresetState] = useState(presets);
  const [settingsState, setSettingsState] = useState(agentSettings);
  const [viewState, setViewState] = useState(agentView);
  const effectiveSettings = controlledAgentSettings ? agentSettings : settingsState;
  const [transportState, setTransportState] = useState(agentTransport);
  const [deviceState, setDeviceState] = useState(() => structuredClone(agentDevice));
  const [deviceLiveState, setDeviceLiveState] = useState(agentDeviceLive);
  const [dockState, setDockState] = useState(agentDock);
  useEffect(() => setDeviceState(structuredClone(agentDevice)), [agentDevice]);
  useEffect(() => setDeviceLiveState(agentDeviceLive), [agentDeviceLive]);
  onDeviceState({
    state: deviceState,
    live: deviceLiveState,
    setState: setDeviceState,
    setLive: setDeviceLiveState,
  });
  const controlledPresets = {
    ...presetState,
    ...(presetLibraryFromStore ? subscribedPresets : {}),
    rename: (id, name) =>
      setPresetState((current) => ({
        ...current,
        list: current.list.map((preset) => (preset.id === id ? { ...preset, name } : preset)),
      })),
    remove: (id) =>
      setPresetState((current) => ({
        ...current,
        list: current.list.filter((preset) => preset.id !== id),
        activeId: current.activeId === id ? null : current.activeId,
        dirty: current.activeId === id ? false : current.dirty,
      })),
    reorder: (ids) =>
      setPresetState((current) => {
        const byId = new Map(current.list.map((preset) => [preset.id, preset]));
        return { ...current, list: ids.map((id) => byId.get(id)) };
      }),
    captureSnapshot: capturePresetSnapshot,
    assertSceneOperationAllowed: assertPresetOperationAllowed,
    saveSnapshot: (name, snapshot) => {
      const preset = { id: "preset-new", name, ...snapshot };
      setPresetState((current) => ({
        list: [...current.list, preset],
        activeId: preset.id,
        dirty: false,
      }));
      return preset;
    },
    updateSnapshot: (id, snapshot) => {
      let updated = null;
      setPresetState((current) => ({
        list: current.list.map((preset) => {
          if (preset.id !== id) return preset;
          updated = { id, name: preset.name, ...snapshot };
          return updated;
        }),
        activeId: id,
        dirty: false,
      }));
      return updated;
    },
    activateSnapshot: (id) => {
      setPresetState((current) => ({ ...current, activeId: id, dirty: false }));
      return true;
    },
    applySnapshot: async (id) => {
      if (applyPresetToWorkspace) {
        const preset = presetState.list.find((entry) => entry.id === id);
        // What the real applySnapshot does: the Workspace it installs is the *migrated* view of
        // the Preset, never the stored record itself.
        if (preset) store.replaceWorkspace(presetWorkspaceView(preset));
      }
      if (presetApplyBarrier) await presetApplyBarrier;
      setPresetState((current) => ({ ...current, activeId: id, dirty: false }));
      return true;
    },
    preflightApplySnapshot: () => true,
  };
  onStore(store);
  const executeTransport =
    executeAgentTransport ??
    (async (method, params) => {
      if (method === "transport.source.file") {
        setTransportState((current) => ({ ...current, source: "file" }));
      } else if (method === "transport.source.live") {
        setTransportState((current) => ({ ...current, source: "live" }));
      } else if (method === "transport.live.start") {
        setTransportState((current) => ({
          ...current,
          source: "live",
          live: { ...current.live, state: "running", resolvedDeviceId: "device-1" },
        }));
      } else if (method === "transport.file.analyze" || method === "transport.file.reanalyze") {
        const sessionId = method === "transport.file.analyze" ? "file-new" : params.sessionId;
        setTransportState((current) => {
          const existing = current.files.sessions.find(({ id }) => id === sessionId);
          const session = {
            ...(existing ?? {
              id: sessionId,
              path: params.path,
              fileName: "test.wav",
            }),
            state: "analyzing",
            error: null,
          };
          return {
            ...current,
            source: "file",
            files: {
              activeId: sessionId,
              analyzingId: sessionId,
              sessions: [...current.files.sessions.filter(({ id }) => id !== sessionId), session],
            },
          };
        });
        return { sessionId };
      }
      return {};
    });
  const executeDock =
    executeAgentDock ??
    (async (_method, projected) => {
      setDockState(projected);
    });
  useAgentControlBridge({
    enabled,
    runtime,
    workspace: store.state,
    replaceWorkspace: store.replaceWorkspace,
    setPanelControlsForPanel: store.setPanelControlsForPanel,
    waitForWorkspacePersistenceEnqueue: store.waitForWorkspacePersistenceEnqueue,
    presets: controlledPresets,
    settings: effectiveSettings,
    settingsContext: agentSettingsContext,
    applySettings: applyAgentSettings ?? (async (next) => setSettingsState(next)),
    viewContext: {
      view: viewState,
      platform: "windows",
      docked: false,
      ...agentViewContext,
      applyView:
        applyAgentView ??
        (async (next) => {
          setViewState(next);
          setPresetState((current) => ({ ...current, dirty: true }));
        }),
    },
    visual: agentVisual,
    transport: transportState,
    transportContext: { docked: false },
    executeTransport,
    device: {
      snapshot: deviceState,
      live: deviceLiveState,
      runtimeUnavailable: deviceRuntimeUnavailable,
      previewSelection: previewAgentDevice
        ? (deviceId) => previewAgentDevice(deviceId, { setDeviceState, setDeviceLiveState })
        : async (deviceId) => {
            if (deviceId === "default") {
              return { label: "Speakers", sampleRateHz: 48_000, channels: 2 };
            }
            const match = deviceState.allDevices.find(({ id }) => id === deviceId);
            if (!match) throw new Error("device missing");
            return {
              label: match.label,
              sampleRateHz: match.sampleRateHz,
              channels: match.channelCount,
            };
          },
      commitSelection: commitAgentDevice
        ? (deviceId) => commitAgentDevice(deviceId, { setDeviceState, setDeviceLiveState })
        : async (deviceId) => setDeviceState((current) => ({ ...current, requestedId: deviceId })),
      beginRestart: beginAgentDeviceRestart
        ? () => beginAgentDeviceRestart({ setDeviceState, setDeviceLiveState })
        : () => {
            setDeviceLiveState((current) => ({
              ...current,
              state: "running",
              transition: null,
              usingRequestedSelection: true,
            }));
            return Promise.resolve();
          },
    },
    dock: dockState,
    dockContext: {
      platform: "windows",
      monitors: [],
      sourceMode: "live",
      activeEditors: [],
      ...agentDockContext,
    },
    executeDock,
    hasLoudnessReference,
    analysisContext,
    measurementContext,
    loudnessProfiles: loudnessProfilesFromStore ? subscribedProfiles : loudnessProfiles,
    loudnessProfile,
    customThemes: customThemes ?? subscribedThemes,
    theme: themeState ? { state: themeState, control: themeControl } : null,
    flush,
    ...(exportConfiguration ? { exportConfiguration } : {}),
    ...(importConfiguration ? { importConfiguration } : {}),
    ...(normalizeConfiguration ? { normalizeConfiguration } : {}),
    ...(relaunchAfterConfigurationChange ? { relaunchAfterConfigurationChange } : {}),
  });
  return null;
}

function ProfileHarness({ onProfile = () => {}, ...props }) {
  const loudnessProfile = useLoudnessProfile();
  onProfile(loudnessProfile);
  return <Harness {...props} loudnessProfile={loudnessProfile} presetLibraryFromStore />;
}

function mountWithProfiles(options = {}) {
  let store = null;
  let profile = null;
  const rendered = render(
    <WorkspaceProvider>
      <LoudnessProfileProvider>
        <ProfileHarness
          {...options}
          onStore={(next) => (store = next)}
          onProfile={(next) => (profile = next)}
        />
      </LoudnessProfileProvider>
    </WorkspaceProvider>
  );
  return {
    ...rendered,
    get store() {
      return store;
    },
    get profile() {
      return profile;
    },
  };
}

function ThemeHarness({ onTheme = () => {}, ...props }) {
  const themeSettings = useThemeSettings();
  const theme = useCustomThemeSettings({
    themeSettings,
    setSettingsOpen: vi.fn(),
    makeId: () => "custom-editor",
  });
  onTheme(theme);
  return (
    <Harness
      {...props}
      themeState={theme.themeControl.readState()}
      themeControl={theme.themeControl}
    />
  );
}

function mountWithThemes(options = {}) {
  let theme = null;
  const rendered = render(
    <WorkspaceProvider>
      <BlockingEditorsProvider>
        <ThemeHarness {...options} onTheme={(next) => (theme = next)} />
      </BlockingEditorsProvider>
    </WorkspaceProvider>
  );
  return {
    ...rendered,
    get theme() {
      return theme;
    },
  };
}

function mount(options = {}) {
  let store = null;
  const rendered = render(
    <WorkspaceProvider>
      <Harness {...options} onStore={(next) => (store = next)} />
    </WorkspaceProvider>
  );
  return {
    ...rendered,
    get store() {
      return store;
    },
  };
}

async function waitUntilReady() {
  await waitFor(() => expect(adapter.ready).toHaveBeenCalledTimes(1));
}

async function send(raw) {
  act(() => adapter.handler(raw));
  await waitFor(() =>
    expect(adapter.responses.some((response) => response.requestId === raw.id)).toBe(true)
  );
  return adapter.responses.find((response) => response.requestId === raw.id);
}

function createDeferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function visualControl(overrides = {}) {
  return {
    platformCapabilities: {
      platform: "windows",
      screenshot: {
        available: true,
        targets: ["main", "workspace", "panel", "dockHeader", "dockEditor"],
      },
      recording: { available: false, targets: [], audioSources: [], cursorModes: [] },
    },
    getRuntime: () => ({
      windowForm: "normal",
      sourceMode: "live",
      availableScreenshotTargets: ["main", "workspace", "panel"],
      availableAudioSources: ["none", "measuredSource"],
    }),
    settle: vi.fn(async (target, { expectedRevision, getRevision }) => {
      const revision = getRevision();
      if (expectedRevision !== undefined && revision !== expectedRevision) {
        throw {
          reason: "revisionConflict",
          details: { expectedRevision, currentRevision: revision },
        };
      }
      return {
        target,
        windowLabel: "main",
        rect: { x: 10, y: 20, width: 300, height: 200 },
        viewport: { width: 800, height: 600 },
        devicePixelRatio: 1.25,
        revision,
      };
    }),
    captureScreenshot: vi.fn(async () => ({
      artifactId: "art-1",
      kind: "screenshot",
      mediaType: "image/png",
      stagedPath: "C:\\private\\agent-artifacts\\art-1.png",
      width: 375,
      height: 250,
      bytes: 1234,
      sha256: "a".repeat(64),
      createdAt: "2026-09-07T12:00:00Z",
    })),
    startRecording: vi.fn(async ({ audio } = {}) => ({
      recordingId: `rec-${"a".repeat(32)}`,
      state: "recording",
      video: { width: 376, height: 250, fps: 30, codec: "h264" },
      audio: { source: audio ?? "none" },
      limits: { maxDurationSeconds: 60, maxArtifactBytes: 2147483648 },
    })),
    inspectRecording: vi.fn(async (recordingId) => ({
      recordingId,
      state: "recording",
      durationMs: 100,
      capturedFrames: 3,
      droppedFrames: 0,
      bytes: 1000,
    })),
    stopRecording: vi.fn(async (recordingId) => ({ recordingId, state: "stopping" })),
    updateRecordingGeometry: vi.fn(async () => {}),
    updateRecordingAudioState: vi.fn(async () => {}),
    subscribe: vi.fn(() => vi.fn()),
    setRecordingState: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  window.matchMedia = vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  adapter.handler = null;
  adapter.order.length = 0;
  adapter.responses.length = 0;
  adapter.unlisten.mockClear();
  adapter.listen.mockClear();
  adapter.ready.mockClear();
  adapter.notReady.mockClear();
  adapter.respond.mockClear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("useAgentControlBridge", () => {
  it("installs the listener before ready and withdraws readiness on unmount", async () => {
    const view = mount();
    await waitUntilReady();
    expect(adapter.order.slice(0, 2)).toEqual(["listen", "ready"]);

    view.unmount();
    expect(adapter.unlisten).toHaveBeenCalledTimes(1);
    expect(adapter.notReady).toHaveBeenCalledTimes(1);
  });

  it("routes every advertised manifest method through a concrete bridge path", async () => {
    const visual = visualControl({
      platformCapabilities: {
        platform: "windows",
        screenshot: {
          available: true,
          targets: ["main", "workspace", "panel", "dockHeader", "dockEditor"],
        },
        recording: {
          available: true,
          targets: ["main", "workspace"],
          audioSources: ["none", "measuredSource"],
          cursorModes: ["none", "visible"],
        },
      },
      inspectRecording: vi.fn(async (recordingId) => ({
        recordingId,
        state: "completed",
        artifact: { artifactId: "art-recording" },
      })),
    });
    mount({
      agentVisual: visual,
      exportConfiguration: () => ({}),
      importConfiguration: async () => {},
      normalizeConfiguration: (configuration) => configuration,
      relaunchAfterConfigurationChange: async () => {},
      measurementContext: {
        getLiveMeasurement: () => ({ generation: 1, record: { generation: 1, sequence: 1 } }),
        liveState: "stopped",
      },
    });
    await waitUntilReady();

    const capabilities = await send(request("app.capabilities", {}, "catalog-capabilities"));
    expect(capabilities.result.methods).toEqual(
      runningAppCommandEntries.map(({ wireMethod }) => wireMethod)
    );

    for (const [index, entry] of runningAppCommandEntries.entries()) {
      let response;
      try {
        response = await send(
          request(entry.wireMethod, canonicalManifestParams(entry), `catalog-${index}`)
        );
      } catch (error) {
        throw new Error(`No bridge response for ${entry.id}`, { cause: error });
      }
      expect(response, entry.id).toBeDefined();
      expect(response.error?.data?.reason, entry.id).not.toBe("methodNotFound");
      expect(response.error?.data?.reason, entry.id).not.toBe("unsupportedMethod");
    }

    const advertised = new Set(capabilities.result.methods);
    advertised.add("orphan.command");
    expect(advertised).not.toEqual(
      new Set(runningAppCommandEntries.map(({ wireMethod }) => wireMethod))
    );
  }, 30_000);

  describe("Visual Capture", () => {
    it("describes runtime availability and returns screenshot metadata without mutating state", async () => {
      const visual = visualControl();
      const measurementContext = {
        getLiveMeasurement: () => ({ generation: 7, record: { sequence: 412 } }),
      };
      const view = mount({ agentVisual: visual, measurementContext });
      await waitUntilReady();
      const beforeWorkspace = view.store.state;

      const capabilities = await send(request("app.capabilities", {}, "visual-capabilities"));
      expect(capabilities.result.features.visual).toEqual({ screenshot: true, recording: false });
      expect(capabilities.result.methods).toEqual(
        expect.arrayContaining(["visual.describe", "visual.screenshot"])
      );
      const described = await send(request("visual.describe", {}, "visual-describe"));
      expect(described.result).toMatchObject({
        revision: 0,
        platform: "windows",
        screenshot: { available: true, format: "png" },
        recording: { available: false },
        runtime: {
          windowForm: "normal",
          availableScreenshotTargets: ["main", "workspace", "panel"],
        },
      });

      const screenshot = await send(
        request(
          "visual.screenshot",
          { target: { kind: "workspace" }, expectedRevision: 0 },
          "visual-shot"
        )
      );
      expect(visual.settle).toHaveBeenCalledWith(
        { kind: "workspace" },
        expect.objectContaining({ expectedRevision: 0, signal: expect.any(AbortSignal) })
      );
      expect(visual.captureScreenshot).toHaveBeenCalledWith({
        windowLabel: "main",
        rect: { x: 10, y: 20, width: 300, height: 200 },
        viewport: { width: 800, height: 600 },
        devicePixelRatio: 1.25,
      });
      expect(screenshot.result).toMatchObject({
        revision: 0,
        measurement: { generation: 7, sequence: 412 },
        artifact: { artifactId: "art-1", kind: "screenshot", mediaType: "image/png" },
        target: { kind: "workspace" },
      });
      expect(view.store.state).toBe(beforeWorkspace);
      const after = await send(request("app.capabilities", {}, "visual-after"));
      expect(after.result.revision).toBe(0);
    });

    it("rejects a currently unavailable semantic target before settlement", async () => {
      const visual = visualControl({
        getRuntime: () => ({
          windowForm: "dock",
          sourceMode: "live",
          availableScreenshotTargets: ["main"],
          availableAudioSources: ["none"],
        }),
      });
      mount({ agentVisual: visual });
      await waitUntilReady();

      const response = await send(
        request("visual.screenshot", { target: { kind: "workspace" } }, "visual-unavailable")
      );

      expect(response.error).toMatchObject({ data: { reason: "targetUnavailable" } });
      expect(visual.settle).not.toHaveBeenCalled();
      expect(visual.captureScreenshot).not.toHaveBeenCalled();
    });

    it.each([
      ["panelNotFound", "settle"],
      ["panelNotVisible", "settle"],
      ["revisionConflict", "settle"],
      ["renderNotSettled", "settle"],
      ["captureFailed", "capture"],
      ["artifactWriteFailed", "capture"],
    ])("maps %s to a stable public failure without an artifact", async (reason, stage) => {
      const visual = visualControl();
      if (stage === "settle") {
        visual.settle.mockRejectedValueOnce({ reason });
      } else {
        visual.captureScreenshot.mockRejectedValueOnce({ reason });
      }
      mount({ agentVisual: visual });
      await waitUntilReady();
      const response = await send(
        request("visual.screenshot", { target: { kind: "main" } }, `visual-${reason}`)
      );
      expect(response.error).toMatchObject({ data: { reason } });
      if (stage === "settle") expect(visual.captureScreenshot).not.toHaveBeenCalled();
    });

    it("keeps screenshot work outside the mutation queue and rejects a concurrent capture", async () => {
      const firstSettlement = createDeferred();
      const visual = visualControl({ settle: vi.fn(() => firstSettlement.promise) });
      mount({ agentVisual: visual });
      await waitUntilReady();

      act(() =>
        adapter.handler(request("visual.screenshot", { target: { kind: "main" } }, "visual-first"))
      );
      await waitFor(() => expect(visual.settle).toHaveBeenCalledTimes(1));
      const busy = await send(
        request("visual.screenshot", { target: { kind: "workspace" } }, "visual-busy")
      );
      expect(busy.error).toMatchObject({ data: { reason: "captureBusy" } });

      const inspection = await send(request("app.inspect", {}, "during-visual"));
      expect(inspection.result.revision).toBe(0);

      firstSettlement.resolve({
        windowLabel: "main",
        rect: { x: 0, y: 0, width: 800, height: 600 },
        viewport: { width: 800, height: 600 },
        devicePixelRatio: 1,
        revision: 0,
      });
      await waitFor(() =>
        expect(adapter.responses.some(({ requestId }) => requestId === "visual-first")).toBe(true)
      );
    });

    it("cancels an owned screenshot settlement when the bridge unmounts", async () => {
      let observedSignal;
      const visual = visualControl({
        settle: vi.fn((_target, { signal }) => {
          observedSignal = signal;
          return new Promise((_, reject) => {
            signal.addEventListener("abort", () => reject({ reason: "captureFailed" }), {
              once: true,
            });
          });
        }),
      });
      const view = mount({ agentVisual: visual });
      await waitUntilReady();
      act(() =>
        adapter.handler(
          request("visual.screenshot", { target: { kind: "main" } }, "visual-unmount")
        )
      );
      await waitFor(() => expect(observedSignal).toBeInstanceOf(AbortSignal));
      view.unmount();
      expect(observedSignal.aborted).toBe(true);
      expect(visual.captureScreenshot).not.toHaveBeenCalled();
    });

    it("defaults Live recording to measured source and forwards resize privately", async () => {
      const recordingId = `rec-${"a".repeat(32)}`;
      let publishGeometry;
      const visual = visualControl({
        platformCapabilities: {
          platform: "windows",
          screenshot: { available: true, targets: ["main", "workspace"] },
          recording: {
            available: true,
            targets: ["main", "workspace"],
            audioSources: ["none", "measuredSource"],
            cursorModes: ["none", "visible"],
          },
        },
        subscribe: vi.fn((_target, onGeometry) => {
          publishGeometry = onGeometry;
          return vi.fn();
        }),
      });
      mount({ agentVisual: visual });
      await waitUntilReady();

      const capabilities = await send(request("app.capabilities", {}, "recording-capabilities"));
      expect(capabilities.result.features.visual.recording).toBe(true);
      expect(capabilities.result.methods).toEqual(
        expect.arrayContaining([
          "visual.recording.start",
          "visual.recording.inspect",
          "visual.recording.wait",
          "visual.recording.stop",
        ])
      );
      const response = await send(
        request(
          "visual.recording.start",
          { target: { kind: "workspace" }, fps: 30, maxDurationSeconds: 5 },
          "recording-start"
        )
      );
      expect(visual.startRecording).toHaveBeenCalledWith({
        windowLabel: "main",
        rect: { x: 10, y: 20, width: 300, height: 200 },
        viewport: { width: 800, height: 600 },
        devicePixelRatio: 1.25,
        fps: 30,
        maxDurationSeconds: 5,
        audio: "measuredSource",
        cursor: "none",
        sourceMode: "live",
        audioState: "liveStopped",
      });
      expect(response.result.recording).toMatchObject({
        recordingId,
        state: "recording",
        target: { kind: "workspace" },
        startedRevision: 0,
        audio: { source: "measuredSource" },
      });
      act(() =>
        publishGeometry({
          rect: { x: 1, y: 2, width: 400, height: 300 },
          viewport: { width: 900, height: 700 },
        })
      );
      await waitFor(() =>
        expect(visual.updateRecordingGeometry).toHaveBeenCalledWith({
          recordingId,
          rect: { x: 1, y: 2, width: 400, height: 300 },
          viewport: { width: 900, height: 700 },
        })
      );
      expect(visual.setRecordingState).toHaveBeenCalledWith("recording");
    });

    it("defaults File recording to none and rejects explicit measured-source audio", async () => {
      const visual = visualControl({
        platformCapabilities: {
          platform: "windows",
          screenshot: { available: true, targets: ["main"] },
          recording: {
            available: true,
            targets: ["main"],
            audioSources: ["none", "measuredSource"],
            cursorModes: ["none", "visible"],
          },
        },
        getRuntime: () => ({
          windowForm: "normal",
          sourceMode: "file",
          availableScreenshotTargets: ["main"],
          availableAudioSources: ["none"],
        }),
      });
      mount({ agentVisual: visual });
      await waitUntilReady();

      const started = await send(
        request(
          "visual.recording.start",
          { target: { kind: "main" }, cursor: "visible" },
          "file-default-audio"
        )
      );
      expect(started.result.recording.audio).toEqual({ source: "none" });
      expect(visual.startRecording).toHaveBeenCalledWith(
        expect.objectContaining({
          audio: "none",
          cursor: "visible",
          sourceMode: "file",
          audioState: "sourceModeFile",
        })
      );

      visual.startRecording.mockClear();
      const rejected = await send(
        request(
          "visual.recording.start",
          { target: { kind: "main" }, audio: "measuredSource" },
          "file-measured-audio"
        )
      );
      expect(rejected.error).toMatchObject({ data: { reason: "audioUnavailable" } });
      expect(visual.startRecording).not.toHaveBeenCalled();
    });

    it("falls back to silent Live recording when the platform has no measured audio", async () => {
      const visual = visualControl({
        platformCapabilities: {
          platform: "macos",
          screenshot: { available: true, targets: ["main"] },
          recording: {
            available: true,
            targets: ["main"],
            audioSources: ["none"],
            cursorModes: ["none", "visible"],
          },
        },
        getRuntime: () => ({
          windowForm: "normal",
          sourceMode: "live",
          availableScreenshotTargets: ["main"],
          availableAudioSources: ["none"],
        }),
      });
      mount({ agentVisual: visual });
      await waitUntilReady();

      const response = await send(
        request("visual.recording.start", { target: { kind: "main" } }, "mac-silent-default")
      );
      expect(response.result.recording.audio).toEqual({ source: "none" });
      expect(visual.startRecording).toHaveBeenCalledWith(
        expect.objectContaining({ audio: "none", sourceMode: "live" })
      );
    });

    it("keeps recording wait outside the mutation queue and returns terminal correlation metadata", async () => {
      const recordingId = `rec-${"b".repeat(32)}`;
      const inspected = createDeferred();
      const visual = visualControl({
        platformCapabilities: {
          platform: "windows",
          screenshot: { available: true, targets: ["main"] },
          recording: {
            available: true,
            targets: ["main"],
            audioSources: ["none"],
            cursorModes: ["none", "visible"],
          },
        },
        inspectRecording: vi.fn(() => inspected.promise),
      });
      mount({ agentVisual: visual });
      await waitUntilReady();
      act(() =>
        adapter.handler(
          request("visual.recording.wait", { recordingId, timeoutMs: 1000 }, "recording-wait")
        )
      );
      await waitFor(() => expect(visual.inspectRecording).toHaveBeenCalled());
      const inspection = await send(request("app.inspect", {}, "during-recording-wait"));
      expect(inspection.result.revision).toBe(0);
      inspected.resolve({ recordingId, state: "completed", artifact: { artifactId: "art-2" } });
      await waitFor(() =>
        expect(adapter.responses.some(({ requestId }) => requestId === "recording-wait")).toBe(true)
      );
      const response = adapter.responses.find(({ requestId }) => requestId === "recording-wait");
      expect(response.result).toMatchObject({
        outcome: "terminal",
        revision: 0,
        recording: { recordingId, state: "completed", endedRevision: 0 },
      });
      expect(visual.setRecordingState).toHaveBeenCalledWith(null);
    });

    it("requests idempotent stop and returns the finalized recording", async () => {
      const recordingId = `rec-${"c".repeat(32)}`;
      const visual = visualControl({
        platformCapabilities: {
          platform: "windows",
          screenshot: { available: true, targets: ["main"] },
          recording: {
            available: true,
            targets: ["main"],
            audioSources: ["none"],
            cursorModes: ["none", "visible"],
          },
        },
        inspectRecording: vi.fn(async () => ({
          recordingId,
          state: "completed",
          artifact: { artifactId: "art-3" },
        })),
      });
      mount({ agentVisual: visual });
      await waitUntilReady();
      const response = await send(
        request("visual.recording.stop", { recordingId }, "recording-stop")
      );
      expect(visual.stopRecording).toHaveBeenCalledWith(recordingId);
      expect(response.result.recording).toMatchObject({
        recordingId,
        state: "completed",
        endedRevision: 0,
      });
    });
  });

  describe("Device Control", () => {
    it("handles every advertised Device query with bounded public state", async () => {
      mount();
      await waitUntilReady();
      const capabilities = await send(request("app.capabilities"));
      for (const { wireMethod: method } of commandEntriesForFamily("device")) {
        expect(capabilities.result.methods).toContain(method);
      }

      const listed = await send(request("device.list", {}, "device-list"));
      expect(listed.result).toMatchObject({
        revision: 0,
        generation: 1,
        automatic: { id: "default", available: true },
        devices: [
          { id: DEVICE_OUTPUT_ID, kind: "systemOutput" },
          { id: DEVICE_INPUT_ID, kind: "input" },
        ],
        truncated: false,
      });
      expect(listed.result).not.toHaveProperty("allDevices");
      expect(listed.result).not.toHaveProperty("signature");

      const inspected = await send(request("device.inspect", {}, "device-inspect"));
      expect(inspected.result).toMatchObject({
        revision: 0,
        generation: 1,
        selection: { requestedId: "default", mode: "automatic", available: true },
        live: { running: false, transition: null, usingRequestedSelection: false },
      });
    });

    it("selects an exact stopped device after two preflight checks and advances revision once", async () => {
      const preview = vi.fn(async () => ({
        label: "Microphone",
        sampleRateHz: 48_000,
        channels: 2,
      }));
      const commit = vi.fn(async (deviceId, { setDeviceState }) => {
        setDeviceState((current) => ({ ...current, requestedId: deviceId }));
      });
      mount({ previewAgentDevice: preview, commitAgentDevice: commit });
      await waitUntilReady();
      const selected = await send(
        request("device.select", {
          deviceId: DEVICE_INPUT_ID,
          expectedGeneration: 1,
        })
      );
      expect(preview).toHaveBeenCalledTimes(2);
      expect(commit).toHaveBeenCalledOnce();
      expect(selected.result).toMatchObject({
        dryRun: false,
        revision: 1,
        generation: 1,
        changed: true,
        effects: [],
        warnings: [],
        plan: { from: "default", to: DEVICE_INPUT_ID, restartLive: false },
        state: {
          selection: { requestedId: DEVICE_INPUT_ID, mode: "exact", available: true },
          live: { running: false },
        },
      });
      const transportAfter = await send(request("transport.inspect", {}, "transport-after-device"));
      expect(transportAfter.result.live.state).toBe("stopped");
      expect(transportAfter.result.files.sessions).toEqual([]);
    });

    it("dry-runs a running switch without confirmation or mutation", async () => {
      const preview = vi.fn(async () => ({}));
      const commit = vi.fn();
      const beginRestart = vi.fn();
      mount({
        agentDeviceLive: {
          state: "running",
          transition: null,
          usingRequestedSelection: true,
        },
        previewAgentDevice: preview,
        commitAgentDevice: commit,
        beginAgentDeviceRestart: beginRestart,
      });
      await waitUntilReady();
      const response = await send(
        request("device.select", {
          deviceId: DEVICE_INPUT_ID,
          expectedGeneration: 1,
          dryRun: true,
        })
      );
      expect(response.result).toMatchObject({
        dryRun: true,
        revision: 0,
        changed: true,
        effects: ["measurementRestart"],
        confirmationsRequired: ["allowMeasurementRestart"],
        state: { live: { running: true, usingRequestedSelection: true } },
      });
      expect(preview).toHaveBeenCalledOnce();
      expect(commit).not.toHaveBeenCalled();
      expect(beginRestart).not.toHaveBeenCalled();
    });

    it("treats a running exact no-op as side-effect free", async () => {
      const selected = { ...structuredClone(deviceSnapshot), requestedId: DEVICE_INPUT_ID };
      const preview = vi.fn();
      const commit = vi.fn();
      const beginRestart = vi.fn();
      mount({
        agentDevice: selected,
        agentDeviceLive: {
          state: "running",
          transition: null,
          usingRequestedSelection: true,
        },
        previewAgentDevice: preview,
        commitAgentDevice: commit,
        beginAgentDeviceRestart: beginRestart,
      });
      await waitUntilReady();
      const response = await send(
        request("device.select", { deviceId: DEVICE_INPUT_ID, expectedGeneration: 1 })
      );
      expect(response.result).toMatchObject({
        revision: 0,
        changed: false,
        effects: [],
        warnings: [],
      });
      expect(preview).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
      expect(beginRestart).not.toHaveBeenCalled();
    });

    it("waits for real running restart readiness before success", async () => {
      const ready = createDeferred();
      const beginRestart = vi.fn(() => ready.promise);
      mount({
        agentDeviceLive: {
          state: "running",
          transition: null,
          usingRequestedSelection: true,
        },
        beginAgentDeviceRestart: beginRestart,
      });
      await waitUntilReady();
      const raw = request(
        "device.select",
        {
          deviceId: DEVICE_INPUT_ID,
          expectedGeneration: 1,
          allowMeasurementRestart: true,
        },
        "device-ready"
      );
      act(() => adapter.handler(raw));
      await waitFor(() => expect(beginRestart).toHaveBeenCalledOnce());
      expect(adapter.responses.some(({ requestId }) => requestId === raw.id)).toBe(false);
      ready.resolve();
      await waitFor(() =>
        expect(adapter.responses.some(({ requestId }) => requestId === raw.id)).toBe(true)
      );
      const response = adapter.responses.find(({ requestId }) => requestId === raw.id);
      expect(response.result).toMatchObject({
        revision: 1,
        changed: true,
        effects: ["measurementRestart"],
      });
    });

    it("rejects stale revision, stale generation, missing IDs, and transition before mutation", async () => {
      const preview = vi.fn();
      const commit = vi.fn();
      mount({ previewAgentDevice: preview, commitAgentDevice: commit });
      await waitUntilReady();
      const cases = [
        [
          { deviceId: DEVICE_INPUT_ID, expectedRevision: 9, expectedGeneration: 1 },
          "revisionConflict",
        ],
        [{ deviceId: DEVICE_INPUT_ID, expectedGeneration: 9 }, "deviceInventoryChanged"],
        [{ deviceId: "cap-missing", expectedGeneration: 1 }, "deviceNotFound"],
      ];
      for (const [params, code] of cases) {
        const response = await send(request("device.select", params, `device-${code}`));
        expect(response.error.data.reason).toBe(code);
      }
      expect(preview).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
    });

    it("requires confirmation before preflight or mutation while Live is running", async () => {
      const preview = vi.fn();
      const commit = vi.fn();
      mount({
        agentDeviceLive: {
          state: "running",
          transition: null,
          usingRequestedSelection: true,
        },
        previewAgentDevice: preview,
        commitAgentDevice: commit,
      });
      await waitUntilReady();
      const response = await send(
        request("device.select", { deviceId: DEVICE_INPUT_ID, expectedGeneration: 1 })
      );
      expect(response.error.data.reason).toBe("confirmationRequired");
      expect(preview).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
    });

    it("refuses unavailable Automatic while running and an existing restart transition", async () => {
      const unavailable = {
        ...structuredClone(deviceSnapshot),
        requestedId: DEVICE_INPUT_ID,
        automatic: { id: "default", label: "Automatic", available: false, resolved: null },
      };
      const commit = vi.fn();
      mount({
        agentDevice: unavailable,
        agentDeviceLive: {
          state: "running",
          transition: null,
          usingRequestedSelection: true,
        },
        commitAgentDevice: commit,
      });
      await waitUntilReady();
      const unavailableResponse = await send(
        request(
          "device.select",
          {
            deviceId: "default",
            expectedGeneration: 1,
            allowMeasurementRestart: true,
          },
          "automatic-running"
        )
      );
      expect(unavailableResponse.error.data.reason).toBe("deviceUnavailable");
      expect(commit).not.toHaveBeenCalled();

      cleanup();
      adapter.handler = null;
      adapter.responses.length = 0;
      adapter.ready.mockClear();
      mount({
        agentDeviceLive: {
          state: "running",
          transition: "restarting",
          usingRequestedSelection: false,
        },
        commitAgentDevice: commit,
      });
      await waitUntilReady();
      const transition = await send(
        request("device.select", { deviceId: DEVICE_INPUT_ID, expectedGeneration: 1 })
      );
      expect(transition.error.data.reason).toBe("transitionInProgress");
      expect(commit).not.toHaveBeenCalled();
    });

    it("persists for a selected File session without modifying it", async () => {
      const fileTransport = {
        ...structuredClone(transport),
        source: "file",
        files: {
          activeId: "file-1",
          analyzingId: null,
          sessions: [
            { id: "file-1", path: "C:/audio.wav", fileName: "audio.wav", state: "complete" },
          ],
        },
      };
      mount({ agentTransport: fileTransport });
      await waitUntilReady();
      const response = await send(
        request("device.select", { deviceId: DEVICE_INPUT_ID, expectedGeneration: 1 })
      );
      expect(response.result).toMatchObject({ changed: true, effects: [] });
      const after = await send(request("transport.inspect", {}, "file-after-device"));
      expect(after.result).toMatchObject({
        source: "file",
        files: { activeId: "file-1", analyzingId: null },
      });
    });

    it("rechecks generation after preview and fails a hotplug race before restart or commit", async () => {
      const commit = vi.fn();
      const beginRestart = vi.fn();
      const secondPreview = createDeferred();
      const preview = vi.fn().mockResolvedValueOnce({}).mockReturnValueOnce(secondPreview.promise);
      let owner;
      mount({
        previewAgentDevice: preview,
        commitAgentDevice: commit,
        beginAgentDeviceRestart: beginRestart,
        onDeviceState: (next) => (owner = next),
      });
      await waitUntilReady();
      const raw = request(
        "device.select",
        { deviceId: DEVICE_INPUT_ID, expectedGeneration: 1 },
        "hotplug-race"
      );
      act(() => adapter.handler(raw));
      await waitFor(() => expect(preview).toHaveBeenCalledTimes(2));
      act(() =>
        owner.setState((current) => ({
          ...current,
          generation: 2,
          devices: current.devices.filter(({ id }) => id !== DEVICE_INPUT_ID),
          allDevices: current.allDevices.filter(({ id }) => id !== DEVICE_INPUT_ID),
        }))
      );
      secondPreview.resolve({});
      await waitFor(() =>
        expect(adapter.responses.some(({ requestId }) => requestId === raw.id)).toBe(true)
      );
      const response = adapter.responses.find(({ requestId }) => requestId === raw.id);
      expect(response.error.data.reason).toBe("deviceInventoryChanged");
      expect(commit).not.toHaveBeenCalled();
      expect(beginRestart).not.toHaveBeenCalled();
    });

    it("allows unavailable Automatic only while stopped and returns its warning", async () => {
      const unavailable = {
        ...structuredClone(deviceSnapshot),
        requestedId: DEVICE_INPUT_ID,
        automatic: { id: "default", label: "Automatic", available: false, resolved: null },
      };
      const preview = vi.fn(async () => {
        throw new Error("no default output");
      });
      mount({ agentDevice: unavailable, previewAgentDevice: preview });
      await waitUntilReady();
      const response = await send(
        request("device.select", { deviceId: "default", expectedGeneration: 1 })
      );
      expect(response.result).toMatchObject({
        changed: true,
        warnings: ["automaticCurrentlyUnavailable"],
        state: { selection: { requestedId: "default", available: false } },
      });
    });

    it("reports persistence and restart failures with committed state", async () => {
      const persistence = vi.fn(async (deviceId, { setDeviceState }) => {
        setDeviceState((current) => ({ ...current, requestedId: deviceId }));
        const error = new Error("disk full");
        error.stateCommitted = true;
        throw error;
      });
      mount({ commitAgentDevice: persistence });
      await waitUntilReady();
      const persisted = await send(
        request("device.select", { deviceId: DEVICE_INPUT_ID, expectedGeneration: 1 })
      );
      expect(persisted.error.data).toMatchObject({
        reason: "persistenceFailed",
        details: { stateCommitted: true, revision: 1 },
      });

      cleanup();
      adapter.handler = null;
      adapter.responses.length = 0;
      adapter.ready.mockClear();
      const failedRestart = vi.fn(async ({ setDeviceLiveState }) => {
        setDeviceLiveState({ state: "error", transition: null, usingRequestedSelection: false });
        throw new Error("device busy");
      });
      mount({
        agentDeviceLive: {
          state: "running",
          transition: null,
          usingRequestedSelection: true,
        },
        beginAgentDeviceRestart: failedRestart,
      });
      await waitUntilReady();
      const restarted = await send(
        request("device.select", {
          deviceId: DEVICE_INPUT_ID,
          expectedGeneration: 1,
          allowMeasurementRestart: true,
        })
      );
      expect(restarted.error.data).toMatchObject({
        reason: "deviceStartFailed",
        details: {
          stateCommitted: true,
          revision: 1,
          state: { selection: { requestedId: DEVICE_INPUT_ID }, live: { running: false } },
        },
      });
    });

    it("separates GUI selection revision from inventory generation changes", async () => {
      let owner;
      mount({ onDeviceState: (next) => (owner = next) });
      await waitUntilReady();
      act(() => owner.setState((current) => ({ ...current, generation: 2 })));
      const hotplug = await send(request("device.list", {}, "hotplug"));
      expect(hotplug.result).toMatchObject({ revision: 0, generation: 2 });

      act(() => owner.setState((current) => ({ ...current, requestedId: DEVICE_INPUT_ID })));
      const gui = await send(request("device.inspect", {}, "gui-selection"));
      expect(gui.result).toMatchObject({
        revision: 1,
        generation: 2,
        selection: { requestedId: DEVICE_INPUT_ID },
      });
    });
  });

  it("attaches one listener when StrictMode re-runs the effect mid-installation", async () => {
    // StrictMode tears the first effect run down and starts a second on the same component, so
    // both runs share every ref. The first run's listener resolves after the second has already
    // reset the shared liveness flag, and it must still withdraw itself — leaving it attached
    // delivered every request twice, which silently ran a non-idempotent command such as
    // `preset save` two times while reporting one result.
    const installs = [];
    const deferred = (handler) =>
      new Promise((resolve) => {
        const stop = vi.fn();
        installs.push({ handler, stop, settle: () => resolve(stop) });
      });
    adapter.listen.mockImplementationOnce(deferred).mockImplementationOnce(deferred);

    render(
      <StrictMode>
        <WorkspaceProvider>
          <Harness onStore={() => {}} />
        </WorkspaceProvider>
      </StrictMode>
    );
    await waitFor(() => expect(installs).toHaveLength(2));

    installs[0].settle();
    installs[1].settle();

    await waitFor(() => expect(installs[0].stop).toHaveBeenCalledTimes(1));
    expect(installs[1].stop).not.toHaveBeenCalled();
    // Only the surviving run announces readiness.
    await waitFor(() => expect(adapter.ready).toHaveBeenCalledTimes(1));
  });

  it("does not mount for an unavailable runtime or an accessory surface", async () => {
    mount({ enabled: false });
    await Promise.resolve();
    expect(adapter.listen).not.toHaveBeenCalled();
    expect(adapter.ready).not.toHaveBeenCalled();
  });

  it("keeps capabilities independent from the latest inspect revision", async () => {
    const view = mount();
    await waitUntilReady();
    const initialTree = view.store.state.tree;

    const capabilities = await send(request("app.capabilities", {}, "cap"));
    expect(capabilities.result).toMatchObject({
      appVersion: "0.14.5",
      protocolVersion: 1,
      revision: 0,
      methods: expect.arrayContaining(["app.capabilities", "app.wait"]),
      features: {},
    });
    expect(capabilities.result).not.toHaveProperty("cliVersion");
    expect(capabilities.result).not.toHaveProperty("revisions");
    const first = await send(request("app.inspect", {}, "inspect-1"));
    expect(first.result).toMatchObject(goldenResult("query.appInspect"));
    expect(first.result.revision).toBe(0);
    expect(first.result.appearance).toEqual({
      mode: "system",
      selectedThemeId: null,
      resolvedThemeId: "plvs-dark",
    });
    expect(first.result.loudnessProfile).toEqual({ activeId: null });
    expect(first.result.view).toEqual(defaultView);
    expect(first.result).not.toHaveProperty("revisions");
    expect(view.store.state.tree).toBe(initialTree);

    act(() => view.store.setTree({ type: "leaf", tabs: ["spectrum"], activeTab: "spectrum" }));
    const second = await send(request("app.inspect", {}, "inspect-2"));
    expect(second.result.revision).toBe(1);
    expect(second.result.workspace.layout).toEqual({ type: "panel", panelId: "spectrum" });
  });

  it("lists and describes Modules before a Panel instance exists", async () => {
    mount({
      analysisContext: { channelCount: 6 },
      hasLoudnessReference: true,
    });
    await waitUntilReady();

    const listed = await send(request("module.list", {}, "module-list"));
    expect(listed.result).toMatchObject({
      revision: 0,
      modules: expect.arrayContaining([
        { moduleId: "spectrum", title: "Spectrum" },
        { moduleId: "waveform", title: "Waveform" },
      ]),
    });

    const described = await send(
      request("module.describe", { moduleId: "spectrum" }, "module-describe")
    );
    expect(described.result).toMatchObject({
      revision: 0,
      schemaBasis: "defaultControls",
      context: {
        channelTopology: { status: "detected", channelCount: 6 },
        hasLoudnessReference: true,
      },
      module: {
        moduleId: "spectrum",
        title: "Spectrum",
        layout: {
          hardMinimumWidth: 32,
          hardMinimumHeight: 36,
          unit: "logicalPx",
        },
        axisKinds: ["frequency"],
        defaultControls: expect.any(Object),
        controlsSchema: expect.any(Object),
      },
    });

    const missing = await send(
      request("module.describe", { moduleId: "missing" }, "module-missing")
    );
    expect(missing.error).toMatchObject({
      data: { reason: "moduleNotFound", path: "$.params.moduleId" },
    });
  });

  it("describes and inspects the retained LIVE measurement without changing revision", async () => {
    const getLiveMeasurement = vi.fn(() => ({
      generation: 3,
      record: {
        generation: 3,
        sequence: 7,
        elapsedMs: 1200,
        receivedAtMs: Date.now(),
        loudnessLayout: "stereo",
        loudnessLayoutKnown: true,
        dialogueActive: false,
        audio: {
          peakDb: [-4, -5],
          rmsDb: [-18, -19],
          truePeakL: -3,
          truePeakR: -4,
          tpMax: -1,
          momentary: -18,
          shortTerm: -19,
          integrated: -20,
          mMax: -14,
          stMax: -16,
          lra: 5,
          correlation: -Infinity,
          sideToMidDb: -Infinity,
          vectorscopePairX: 0,
          vectorscopePairY: 1,
          dialogueIntegrated: -Infinity,
          dialogueLra: 0,
          dialoguePercent: null,
          dialogueActiveNow: false,
        },
      },
    }));
    mount({
      measurementContext: {
        getLiveMeasurement,
        getChannelLabels: () => ["Left", "Right"],
        liveState: "running",
        vectorscopeRequests: [],
        dialogueActive: false,
      },
    });
    await waitUntilReady();

    const description = await send(request("measurement.describe", {}, "measurement-describe"));
    const first = await send(request("measurement.inspect", {}, "measurement-first"));
    const second = await send(request("measurement.inspect", {}, "measurement-second"));

    expect(description.result).toMatchObject({
      revision: 0,
      schemaVersion: 1,
      source: "live",
      freshnessThresholdMs: 2000,
    });
    expect(first.result).toMatchObject({
      revision: 0,
      source: { kind: "live", state: "running", sessionGeneration: 3 },
      sample: { sequence: 7, elapsedMs: 1200, freshness: "fresh" },
      topology: { channelLabels: ["Left", "Right"] },
      levels: { channels: [{ peakDbfs: -4 }, { peakDbfs: -5 }] },
      stereo: { pair: null, correlation: null, sideToMidDb: null },
      dialogue: { active: false },
    });
    expect(first.result.unavailable["stereo.correlation"]).toBe("analysisInactive");
    expect(second.result.revision).toBe(0);
    expect(getLiveMeasurement).toHaveBeenCalledTimes(2);
  });

  it("returns no-sample Measurement inspection as a successful query", async () => {
    mount({
      measurementContext: {
        getLiveMeasurement: () => ({ generation: 4, record: null }),
        liveState: "stopped",
      },
    });
    await waitUntilReady();
    const response = await send(request("measurement.inspect", {}, "measurement-empty"));
    expect(response.error).toBeUndefined();
    expect(response.result).toMatchObject({
      revision: 0,
      source: { state: "stopped", sessionGeneration: 4 },
      sample: { sequence: null, freshness: "unavailable" },
    });
  });

  it("waits for a different published LIVE measurement outside the command queue", async () => {
    let live = { generation: 3, record: null };
    const listeners = new Set();
    const measurementContext = {
      getLiveMeasurement: () => live,
      subscribeLiveMeasurement: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getChannelLabels: () => ["Left", "Right"],
      liveState: "running",
      vectorscopeRequests: [],
      dialogueActive: false,
    };
    mount({ measurementContext });
    await waitUntilReady();

    const waitRequest = request(
      "measurement.wait",
      { afterGeneration: 3, timeoutMs: 1000 },
      "measurement-wait"
    );
    act(() => adapter.handler(waitRequest));
    const inspection = await send(request("measurement.inspect", {}, "inspect-during-measurement"));
    expect(inspection.result.sample.sequence).toBeNull();

    live = {
      generation: 3,
      record: {
        generation: 3,
        sequence: 1,
        elapsedMs: 10,
        receivedAtMs: Date.now(),
        loudnessLayout: "stereo",
        loudnessLayoutKnown: true,
        dialogueActive: false,
        audio: { peakDb: [-4, -5], rmsDb: [-18, -19] },
      },
    };
    act(() => {
      for (const listener of listeners) listener(live);
    });

    await waitFor(() =>
      expect(adapter.responses.some(({ requestId }) => requestId === waitRequest.id)).toBe(true)
    );
    expect(
      adapter.responses.find(({ requestId }) => requestId === waitRequest.id).result
    ).toMatchObject({
      outcome: "sample",
      matchedImmediately: false,
      measurement: {
        revision: 0,
        source: { sessionGeneration: 3 },
        sample: { sequence: 1 },
      },
    });
  });

  it("does not satisfy measurement.wait with a generation clear that has no sample", async () => {
    let live = { generation: 2, record: null };
    const listeners = new Set();
    mount({
      measurementContext: {
        getLiveMeasurement: () => live,
        subscribeLiveMeasurement: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        liveState: "stopped",
      },
    });
    await waitUntilReady();
    const waitRequest = request(
      "measurement.wait",
      { afterGeneration: 2, timeoutMs: 100 },
      "measurement-clear"
    );
    act(() => adapter.handler(waitRequest));
    live = { generation: 3, record: null };
    act(() => {
      for (const listener of listeners) listener(live);
    });

    await waitFor(() =>
      expect(adapter.responses.some(({ requestId }) => requestId === waitRequest.id)).toBe(true)
    );
    expect(
      adapter.responses.find(({ requestId }) => requestId === waitRequest.id).error
    ).toMatchObject({
      code: -32071,
      data: {
        reason: "timeout",
        details: {
          afterGeneration: 2,
          afterSequence: null,
          currentGeneration: 3,
          currentSequence: null,
          liveState: "stopped",
        },
      },
    });
  });

  it("returns immediately when the published measurement identity already differs", async () => {
    mount({
      measurementContext: {
        getLiveMeasurement: () => ({
          generation: 4,
          record: {
            generation: 4,
            sequence: 2,
            elapsedMs: 20,
            receivedAtMs: Date.now(),
            loudnessLayout: "mono",
            loudnessLayoutKnown: true,
            dialogueActive: false,
            audio: { peakDb: [-3], rmsDb: [-12] },
          },
        }),
        liveState: "running",
      },
    });
    await waitUntilReady();

    const response = await send(
      request(
        "measurement.wait",
        { afterGeneration: 3, afterSequence: 1, timeoutMs: 1000 },
        "measurement-immediate"
      )
    );
    expect(response.result).toMatchObject({
      outcome: "sample",
      matchedImmediately: true,
      measurement: {
        source: { sessionGeneration: 4 },
        sample: { sequence: 2 },
      },
    });
  });

  it("waits for bounded measurement predicates and resets a broken hold", async () => {
    const record = (sequence, integrated) => ({
      generation: 5,
      sequence,
      elapsedMs: sequence * 10,
      receivedAtMs: Date.now(),
      loudnessLayout: "stereo",
      loudnessLayoutKnown: true,
      dialogueActive: false,
      audio: { peakDb: [-12, -13], rmsDb: [-24, -25], integrated },
    });
    let live = { generation: 5, record: record(1, -20) };
    const listeners = new Set();
    mount({
      measurementContext: {
        getLiveMeasurement: () => live,
        subscribeLiveMeasurement: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        liveState: "running",
      },
    });
    await waitUntilReady();

    const immediate = await send(
      request(
        "measurement.waitUntil",
        {
          predicate: { kind: "metricAvailable", metric: "loudness.integratedLufs" },
          timeoutMs: 500,
        },
        "predicate-immediate"
      )
    );
    expect(immediate.result).toMatchObject({
      outcome: "condition",
      matchedImmediately: true,
      measurement: { sample: { sequence: 1 } },
    });

    const held = request(
      "measurement.waitUntil",
      {
        predicate: {
          kind: "metricThreshold",
          metric: "loudness.integratedLufs",
          operator: "atOrAbove",
          value: -24,
          holdMs: 80,
        },
        timeoutMs: 500,
      },
      "predicate-held"
    );
    act(() => adapter.handler(held));
    await new Promise((resolve) => setTimeout(resolve, 25));
    live = { generation: 5, record: record(2, -30) };
    act(() => {
      for (const listener of listeners) listener(live);
    });
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(adapter.responses.some(({ requestId }) => requestId === held.id)).toBe(false);

    live = { generation: 5, record: record(3, -20) };
    act(() => {
      for (const listener of listeners) listener(live);
    });
    await waitFor(() =>
      expect(adapter.responses.some(({ requestId }) => requestId === held.id)).toBe(true)
    );
    expect(adapter.responses.find(({ requestId }) => requestId === held.id).result).toMatchObject({
      outcome: "condition",
      matchedImmediately: false,
      measurement: { sample: { sequence: 3 } },
    });
  });

  it("describes, inspects, dry-runs, and commits the focused View resource", async () => {
    const flush = vi.fn(async () => {});
    mount({ flush, presets: { activeId: "preset-1", dirty: false } });
    await waitUntilReady();

    const described = await send(request("view.describe", {}, "view-describe"));
    expect(described.result).toMatchObject({
      revision: 0,
      view: defaultView,
      runtime: { windowPresentation: { state: "active", owner: "view" } },
      availability: { glassEnabled: { writable: false, reason: "platformUnsupported" } },
      schema: { panelOpacity: { type: "integer", minimum: 0, maximum: 100 } },
    });

    const dryRun = await send(
      request(
        "view.update",
        { patch: { pinned: true, focusView: { compactPanels: true } }, dryRun: true },
        "view-dry-run"
      )
    );
    expect(dryRun.result).toMatchObject({
      dryRun: true,
      revision: 0,
      changed: true,
      effects: ["alwaysOnTop", "compactPanels"],
      state: {
        view: { pinned: true, focusView: { compactPanels: true } },
        preset: { activeId: "preset-1", dirty: true },
      },
    });
    const unchanged = await send(request("view.inspect", {}, "view-after-dry-run"));
    expect(unchanged.result).toMatchObject({ revision: 0, view: defaultView });

    const committed = await send(
      request("view.update", { patch: { pinned: true, panelOpacity: 82 } }, "view-update")
    );
    expect(committed.error).toBeUndefined();
    expect(committed.result).toMatchObject({
      dryRun: false,
      revision: 1,
      changed: true,
      effects: ["alwaysOnTop", "panelOpacity"],
      state: {
        view: { pinned: true, panelOpacity: 82 },
        preset: { activeId: "preset-1", dirty: true },
      },
    });
    expect(flush).toHaveBeenCalledTimes(1);
    const inspected = await send(request("view.inspect", {}, "view-after-update"));
    expect(inspected.result).toMatchObject({
      revision: 1,
      view: { pinned: true, panelOpacity: 82 },
    });
  });

  it("enforces View validation and platform availability before applying", async () => {
    const applyAgentView = vi.fn();
    mount({ applyAgentView });
    await waitUntilReady();

    const invalid = await send(
      request("view.update", { patch: { panelOpacity: 80.5 } }, "view-invalid")
    );
    expect(invalid.error).toMatchObject({
      code: -32602,
      data: {
        reason: "invalidView",
        details: { issues: [{ code: "invalidRange", path: "$.panelOpacity" }] },
      },
    });
    const unavailable = await send(
      request("view.update", { patch: { glassEnabled: true } }, "view-unavailable")
    );
    expect(unavailable.error).toMatchObject({
      code: -32012,
      data: { reason: "controlUnavailable", details: { reason: "platformUnsupported" } },
    });
    expect(applyAgentView).not.toHaveBeenCalled();
  });

  it("allows View reset to clear stale Glass state on an unsupported platform", async () => {
    mount({ agentView: { ...defaultView, pinned: true, glassEnabled: true } });
    await waitUntilReady();
    const response = await send(request("view.reset", {}, "view-reset"));
    expect(response.error).toBeUndefined();
    expect(response.result).toMatchObject({
      revision: 1,
      changed: true,
      state: { view: defaultView },
    });
  });

  it("reports View native application failure without committing public state", async () => {
    const failure = Object.assign(new Error("native failed"), {
      rollback: "completed",
      partial: false,
      changed: [],
    });
    mount({ applyAgentView: vi.fn(async () => Promise.reject(failure)) });
    await waitUntilReady();
    const response = await send(
      request("view.update", { patch: { pinned: true } }, "view-native-failure")
    );
    expect(response.error).toMatchObject({
      code: -32050,
      data: {
        reason: "applicationFailed",
        details: { partial: false, rollback: "completed", changed: [], revision: 0 },
      },
    });
    const inspected = await send(request("view.inspect", {}, "view-after-native-failure"));
    expect(inspected.result).toMatchObject({ revision: 0, view: defaultView });
  });

  it("lists and describes saved Presets through public shapes", async () => {
    const stored = {
      id: "preset-1",
      name: "Mixing",
      ...DEFAULT_WORKSPACE_STATE,
      loudnessProfileActive: "off",
    };
    mount({
      presets: { list: [stored], activeId: "preset-1", dirty: true },
    });
    await waitUntilReady();

    const listed = await send(request("preset.list", {}, "preset-list"));
    const described = await send(
      request("preset.describe", { presetId: "preset-1" }, "preset-describe")
    );

    expect(listed.result).toEqual({
      revision: 0,
      presets: [{ id: "preset-1", name: "Mixing" }],
      activeId: "preset-1",
      dirty: true,
    });
    expect(described.result).toMatchObject({
      revision: 0,
      preset: {
        id: "preset-1",
        name: "Mixing",
        workspace: { layout: expect.any(Object), panels: expect.any(Array) },
        window: { bounds: null },
        loudnessProfile: { activeId: null },
      },
    });
  });

  it("inspects and describes focused Settings with an independent revision", async () => {
    mount();
    await waitUntilReady();

    const inspected = await send(request("settings.inspect", {}, "settings-inspect"));
    const described = await send(request("settings.describe", {}, "settings-describe"));

    expect(inspected.result).toMatchObject({
      revision: 0,
      settings: publicSettings,
      availability: { openAtLogin: { writable: true, reason: null } },
    });
    expect(inspected.result).not.toHaveProperty("schema");
    expect(described.result).toMatchObject({
      revision: 0,
      settings: publicSettings,
      schema: {
        historyRetentionSec: { type: "enum", current: 3600, unit: "s" },
      },
    });
  });

  it("inspects the focused Transport lifecycle", async () => {
    mount();
    await waitUntilReady();
    const response = await send(request("transport.inspect", {}, "transport-inspect"));
    expect(response.result).toEqual({ revision: 0, ...transport });
  });

  it("inspects and describes Dock against the Workspace revision", async () => {
    mount();
    await waitUntilReady();
    const inspected = await send(request("dock.inspect", {}, "dock-inspect"));
    const described = await send(request("dock.describe", {}, "dock-describe"));
    expect(inspected.result).toMatchObject({
      revision: 0,
      supported: true,
      enabled: false,
      panels: [{ id: "transport", moduleId: "transport" }],
    });
    expect(inspected.result).not.toHaveProperty("presetsRevision");
    expect(described.result).toMatchObject({
      revision: 0,
      supported: true,
      height: { min: 56, max: 160 },
    });
  });

  it("preserves the monitorNotFound reason from Dock validation", async () => {
    mount({
      agentDockContext: {
        monitors: [{ id: "monitor-1", name: "Display 1" }],
        monitorInventoryReady: true,
      },
    });
    await waitUntilReady();

    const response = await send(
      request("dock.enter", { monitor: "missing" }, "dock-monitor-missing")
    );

    expect(response.error).toMatchObject({
      data: {
        reason: "monitorNotFound",
        details: { issues: [expect.objectContaining({ code: "monitorNotFound" })] },
      },
    });
  });

  it("atomically replaces the Dock layout and settles on Workspace revision", async () => {
    mount();
    await waitUntilReady();
    const response = await send(
      request(
        "dock.layout.apply",
        { layout: { panels: [{ key: "meter", moduleId: "levelMeter", controls: {} }] } },
        "dock-layout"
      )
    );
    expect(response.result).toMatchObject({
      revision: 1,
      dryRun: false,
      changed: true,
      createdPanels: { meter: "levelMeter" },
      state: {
        dock: { panels: [{ id: "levelMeter", moduleId: "levelMeter" }] },
        preset: { activeId: null, dirty: false },
      },
    });
    expect(response.result).not.toHaveProperty("dock");
    expect(response.result).not.toHaveProperty("preset");
  });

  it("truthfully previews and no-ops Dock mutations", async () => {
    const executeDock = vi.fn(async () => {});
    const flush = vi.fn(async () => {});
    mount({ executeAgentDock: executeDock, flush });
    await waitUntilReady();

    const noOp = await send(request("dock.exit", {}, "dock-exit-no-op"));
    const dryRun = await send(request("dock.enter", { dryRun: true }, "dock-enter-dry-run"));

    expect(noOp.result).toMatchObject({
      revision: 0,
      dryRun: false,
      changed: false,
      state: { dock: { enabled: false } },
    });
    expect(dryRun.result).toMatchObject({
      revision: 0,
      dryRun: true,
      changed: true,
      state: { dock: { enabled: true } },
    });
    expect(executeDock).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });

  it("reports the observable Dock state when native execution fails", async () => {
    mount({ executeAgentDock: vi.fn(async () => Promise.reject(new Error("native refused"))) });
    await waitUntilReady();

    const transportChanged = await send(
      request("transport.source.file", { expectedRevision: 0 }, "transport-before-dock-failure")
    );
    expect(transportChanged.result.revision).toBe(1);

    const response = await send(
      request("dock.enter", { expectedRevision: 1 }, "dock-native-failure")
    );

    expect(response.error).toMatchObject({
      code: -32050,
      data: {
        reason: "applicationFailed",
        details: {
          stage: "execution",
          partial: false,
          changed: ["dock.enabled"],
          revision: 1,
          dock: { enabled: false },
        },
      },
    });
  });

  it("reports a committed Dock mutation when persistence fails", async () => {
    const flush = vi.fn(async () => Promise.reject(new Error("disk full")));
    mount({ flush });
    await waitUntilReady();

    const response = await send(
      request(
        "dock.layout.apply",
        { layout: { panels: [{ key: "meter", moduleId: "levelMeter", controls: {} }] } },
        "dock-persistence-failure"
      )
    );

    expect(response.error).toMatchObject({
      code: -32030,
      data: {
        reason: "persistenceFailed",
        details: {
          stage: "persistence",
          partial: true,
          changed: ["dock.panels"],
          revision: 1,
          dock: { panels: [{ id: "levelMeter" }] },
        },
      },
    });
  });

  it("applies a Transport source mutation and settles on its revision", async () => {
    mount();
    await waitUntilReady();

    const response = await send(
      request("transport.source.file", { expectedRevision: 0 }, "transport-source-file")
    );

    expect(response.result).toMatchObject({
      dryRun: false,
      revision: 1,
      changed: true,
      effects: [],
      warnings: [],
      state: { transport: { source: "file" } },
    });
  });

  it("does not execute a Transport dry-run", async () => {
    const executeTransport = vi.fn(async () => {});
    mount({ executeAgentTransport: executeTransport });
    await waitUntilReady();

    const response = await send(
      request("transport.source.file", { dryRun: true }, "transport-source-file-dry")
    );

    expect(response.result).toMatchObject({
      dryRun: true,
      revision: 0,
      changed: true,
      state: { transport: { source: "file" } },
    });
    expect(executeTransport).not.toHaveBeenCalled();
  });

  it("reports completed Transport actions with their final state", async () => {
    mount();
    await waitUntilReady();

    const response = await send(
      request("transport.live.start", { expectedRevision: 0 }, "transport-start")
    );

    expect(response.result).toMatchObject({
      action: "transport.live.start",
      status: "completed",
      revision: 1,
      state: {
        transport: {
          source: "live",
          live: { state: "running", resolvedDeviceId: "device-1" },
        },
      },
    });
    expect(response.result).toMatchObject(goldenResult("action.transportLiveStart"));
    expect(response.result).not.toHaveProperty("changed");
    expect(response.result).not.toHaveProperty("dryRun");
  });

  it.each([
    ["transport.file.analyze", { path: "C:\\audio\\test.wav", expectedRevision: 0 }, transport],
    [
      "transport.file.reanalyze",
      { sessionId: "file-1", expectedRevision: 0 },
      {
        ...transport,
        source: "file",
        files: {
          activeId: "file-1",
          analyzingId: null,
          sessions: [
            {
              id: "file-1",
              path: "C:\\audio\\test.wav",
              fileName: "test.wav",
              state: "complete",
              error: null,
            },
          ],
        },
      },
    ],
  ])("reports accepted status for asynchronous %s", async (method, params, initialTransport) => {
    mount({ agentTransport: initialTransport });
    await waitUntilReady();

    const response = await send(request(method, params, `${method}-accepted`));

    expect(response.result).toMatchObject({
      action: method,
      status: "accepted",
      revision: 1,
    });
  });

  it("rejects stale Transport mutations before execution", async () => {
    const executeTransport = vi.fn(async () => {});
    mount({ executeAgentTransport: executeTransport });
    await waitUntilReady();

    const response = await send(
      request("transport.live.stop", { expectedRevision: 3 }, "transport-conflict")
    );

    expect(response.error).toMatchObject({
      code: -32004,
      data: {
        reason: "revisionConflict",
        path: "$.params.expectedRevision",
        details: { expectedRevision: 3, currentRevision: 0 },
      },
    });
    expect(executeTransport).not.toHaveBeenCalled();
  });

  it("reports Transport execution failures at the global revision", async () => {
    mount({
      executeAgentTransport: vi.fn(async () => Promise.reject(new Error("device refused"))),
      presets: {
        list: [{ id: "preset-1", name: "Mixing" }],
        activeId: null,
        dirty: false,
      },
    });
    await waitUntilReady();

    const renamed = await send(
      request(
        "preset.rename",
        { presetId: "preset-1", name: "Final Mix", expectedRevision: 0 },
        "preset-before-transport-failure"
      )
    );
    expect(renamed.result.revision).toBe(1);

    const response = await send(
      request("transport.live.start", { expectedRevision: 1 }, "transport-execution-failure")
    );

    expect(response.error).toMatchObject({
      data: {
        reason: "applicationFailed",
        details: { revision: 1 },
      },
    });
  });

  it("updates Settings atomically and returns its final state", async () => {
    const flush = vi.fn(async () => {});
    mount({ flush });
    await waitUntilReady();

    const response = await send(
      request(
        "settings.update",
        {
          patch: { closeBehavior: "tray", interfaceSize: "large" },
          expectedRevision: 0,
        },
        "settings-update"
      )
    );

    expect(response.result).toMatchObject({
      dryRun: false,
      revision: 1,
      changed: true,
      state: {
        settings: { closeBehavior: "tray", interfaceSize: "large" },
        availability: { openAtLogin: { writable: true, reason: null } },
      },
      effects: [],
      warnings: [],
    });
    expect(response.result).not.toHaveProperty("settings");
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("rejects Appearance through Settings without applying or persisting it", async () => {
    const apply = vi.fn(async () => {});
    const flush = vi.fn(async () => {});
    mount({ applyAgentSettings: apply, flush });
    await waitUntilReady();

    const response = await send(
      request(
        "settings.update",
        { patch: { appearance: { mode: "fixed", themeId: "plvs-light" } }, expectedRevision: 0 },
        "settings-appearance-removed"
      )
    );

    expect(response.error).toMatchObject({
      code: -32602,
      data: {
        reason: "invalidSettings",
        details: {
          issues: [expect.objectContaining({ code: "unknownControl", path: "$.appearance" })],
        },
      },
    });
    expect(apply).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });

  it("reports Settings application failures at the global revision", async () => {
    const view = mount({
      applyAgentSettings: vi.fn(async () => Promise.reject(new Error("setting refused"))),
    });
    await waitUntilReady();

    act(() => view.store.setTree({ type: "leaf", tabs: ["spectrum"], activeTab: "spectrum" }));
    const inspected = await send(request("app.inspect", {}, "workspace-before-settings-failure"));
    expect(inspected.result.revision).toBe(1);

    const response = await send(
      request(
        "settings.update",
        { patch: { interfaceSize: "large" }, expectedRevision: 1 },
        "settings-application-failure"
      )
    );

    expect(response.error).toMatchObject({
      data: {
        reason: "applicationFailed",
        details: { revision: 1 },
      },
    });
  });

  it("previews a required Settings restart without demanding confirmation", async () => {
    mount({
      agentSettingsContext: { ...settingsContext, dialogueDetectionActive: true },
    });
    await waitUntilReady();

    const response = await send(
      request(
        "settings.update",
        { patch: { dialogueVadEngine: "silero" }, dryRun: true },
        "settings-restart-dry"
      )
    );

    expect(response.result).toMatchObject({
      dryRun: true,
      revision: 0,
      changed: true,
      effects: ["measurementRestart"],
      confirmation: { requiredFlag: "allowMeasurementRestart" },
      state: { settings: { dialogueVadEngine: "silero" } },
    });
  });

  it("does not count initial Settings capability hydration as a revision", async () => {
    const view = mount({
      agentSettingsContext: {
        ...settingsContext,
        autostartReady: false,
        clearShortcutReady: false,
      },
    });
    await waitUntilReady();
    view.rerender(
      <WorkspaceProvider>
        <Harness
          agentSettings={{ ...publicSettings, openAtLogin: true }}
          agentSettingsContext={{
            ...settingsContext,
            autostartReady: true,
            clearShortcutReady: true,
          }}
          controlledAgentSettings
        />
      </WorkspaceProvider>
    );
    const inspected = await send(request("settings.inspect", {}, "settings-hydrated"));
    expect(inspected.result.revision).toBe(0);
  });

  it.each([
    [
      "autostart",
      { autostartReady: false, clearShortcutReady: true },
      { interfaceSize: "large" },
      { interfaceSize: "large" },
    ],
    [
      "clear shortcut",
      { autostartReady: true, clearShortcutReady: false },
      { closeBehavior: "tray" },
      { closeBehavior: "tray" },
    ],
  ])(
    "tracks ordinary Settings while %s capability hydration is unavailable",
    async (capability, readiness, patch, expectedSettings) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const flush = vi.fn(async () => {});
        mount({
          flush,
          agentSettingsContext: { ...settingsContext, ...readiness },
        });
        await vi.waitFor(() => expect(adapter.ready).toHaveBeenCalledTimes(1));
        const waitRequest = request(
          "app.wait",
          { afterRevision: 0, timeoutMs: 1000 },
          `settings-${capability}-wait`
        );
        const updateRequest = request(
          "settings.update",
          { patch, expectedRevision: 0 },
          `settings-${capability}-update`
        );

        act(() => adapter.handler(waitRequest));
        act(() => adapter.handler(updateRequest));
        await vi.waitFor(
          () =>
            expect(adapter.responses.some(({ requestId }) => requestId === updateRequest.id)).toBe(
              true
            ),
          { timeout: 7000 }
        );

        const response = adapter.responses.find(({ requestId }) => requestId === updateRequest.id);
        expect(response?.error).toBeUndefined();
        expect(response?.result).toMatchObject({
          revision: 1,
          changed: true,
          state: { settings: expectedSettings },
        });
        expect(
          adapter.responses.find(({ requestId }) => requestId === waitRequest.id)?.result
        ).toEqual({
          outcome: "changed",
          matchedImmediately: false,
          revision: 1,
        });
        expect(flush).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it("waits outside the command queue until the global revision changes", async () => {
    const view = mount();
    await waitUntilReady();
    const waitRequest = request("app.wait", { afterRevision: 0, timeoutMs: 1000 }, "wait-change");
    act(() => adapter.handler(waitRequest));

    const inspected = await send(request("app.inspect", {}, "inspect-during-wait"));
    expect(inspected.result.revision).toBe(0);
    act(() => view.store.setTree({ type: "leaf", tabs: ["spectrum"], activeTab: "spectrum" }));
    await waitFor(() =>
      expect(adapter.responses.some(({ requestId }) => requestId === "wait-change")).toBe(true)
    );
    expect(adapter.responses.find(({ requestId }) => requestId === "wait-change").result).toEqual({
      outcome: "changed",
      matchedImmediately: false,
      revision: 1,
    });
    expect(
      adapter.responses.find(({ requestId }) => requestId === "wait-change").result
    ).toMatchObject(goldenResult("wait.changed"));
  });

  it("releases a revision waiter immediately when its client disconnects", async () => {
    mount();
    await waitUntilReady();
    act(() => adapter.handler(request("app.wait", { afterRevision: 0, timeoutMs: 100 }, "gone")));
    act(() => adapter.handler({ type: "cancel", requestId: "gone" }));

    for (let index = 0; index < 4; index += 1) {
      act(() =>
        adapter.handler(
          request("app.wait", { afterRevision: 0, timeoutMs: 100 }, `remaining-${index}`)
        )
      );
    }

    await waitFor(() =>
      expect(
        adapter.responses.filter(({ requestId }) => requestId.startsWith("remaining-"))
      ).toHaveLength(4)
    );
    expect(adapter.responses.find(({ requestId }) => requestId === "gone")).toBeUndefined();
    expect(
      adapter.responses.filter(({ requestId }) => requestId.startsWith("remaining-"))
    ).toSatisfy((responses) => responses.every(({ error }) => error?.data?.reason === "timeout"));
  });

  it("refuses a fifth concurrent revision waiter with waitLimitReached", async () => {
    mount();
    await waitUntilReady();
    for (let index = 0; index < 4; index += 1) {
      act(() =>
        adapter.handler(
          request("app.wait", { afterRevision: 0, timeoutMs: 1000 }, `active-${index}`)
        )
      );
    }

    const response = await send(
      request("app.wait", { afterRevision: 0, timeoutMs: 1000 }, "over-limit")
    );

    expect(response.error).toMatchObject({
      code: -32070,
      data: { reason: "waitLimitReached" },
    });
  });

  it("shares the four-request limit between revision and measurement waits", async () => {
    mount({
      measurementContext: {
        getLiveMeasurement: () => ({ generation: 0, record: null }),
        subscribeLiveMeasurement: () => () => {},
        liveState: "stopped",
      },
    });
    await waitUntilReady();
    for (let index = 0; index < 3; index += 1) {
      act(() =>
        adapter.handler(
          request("app.wait", { afterRevision: 0, timeoutMs: 1000 }, `shared-app-${index}`)
        )
      );
    }
    act(() =>
      adapter.handler(
        request("measurement.wait", { afterGeneration: 0, timeoutMs: 1000 }, "shared-measurement")
      )
    );

    const response = await send(
      request("app.wait", { afterRevision: 0, timeoutMs: 1000 }, "shared-over-limit")
    );
    expect(response.error).toMatchObject({
      code: -32070,
      data: { reason: "waitLimitReached" },
    });
  });

  it("returns a timeout error with the current global revision", async () => {
    mount();
    await waitUntilReady();
    const response = await send(
      request("app.wait", { afterRevision: 0, timeoutMs: 100 }, "wait-timeout")
    );
    expect(response.error).toMatchObject({
      code: -32071,
      data: {
        reason: "timeout",
        details: { afterRevision: 0, currentRevision: 0 },
      },
    });
  });

  it("returns stable Preset missing-target errors", async () => {
    mount();
    await waitUntilReady();

    const missing = await send(
      request("preset.describe", { presetId: "missing" }, "preset-missing")
    );

    expect(missing.error).toMatchObject({
      code: -32020,
      data: { reason: "presetNotFound", path: "$.params.presetId" },
    });
  });

  it("renames, reorders, and deletes Presets with revision and persistence settlement", async () => {
    const flush = vi.fn(async () => {});
    const first = { id: "preset-1", name: "Mixing" };
    const second = { id: "preset-2", name: "Mastering" };
    mount({
      flush,
      presets: { list: [first, second], activeId: "preset-1", dirty: true },
    });
    await waitUntilReady();

    const renamed = await send(
      request(
        "preset.rename",
        { presetId: "preset-1", name: "  Final Mix  ", expectedRevision: 0 },
        "preset-rename"
      )
    );
    const reorderDryRun = await send(
      request(
        "preset.reorder",
        { presetIds: ["preset-2", "preset-1"], dryRun: true, expectedRevision: 1 },
        "preset-reorder-dry"
      )
    );
    const deleted = await send(
      request("preset.delete", { presetId: "preset-1", expectedRevision: 1 }, "preset-delete")
    );
    const listed = await send(request("preset.list", {}, "preset-list-after-delete"));

    expect(renamed.result).toMatchObject({
      dryRun: false,
      changed: true,
      state: {
        preset: { id: "preset-1", name: "Final Mix" },
        presets: { activeId: "preset-1", dirty: true },
      },
      revision: 1,
      warnings: [],
    });
    expect(renamed.result).not.toHaveProperty("presetState");
    expect(reorderDryRun.result).toMatchObject({
      dryRun: true,
      changed: true,
      state: {
        presets: {
          activeId: "preset-1",
          dirty: true,
          presetIds: ["preset-2", "preset-1"],
        },
      },
      revision: 1,
    });
    expect(deleted.result).toMatchObject({
      deletedPreset: { id: "preset-1", name: "Final Mix" },
      changed: true,
      state: { presets: { activeId: null, dirty: false } },
      revision: 2,
    });
    expect(listed.result.presets).toEqual([{ id: "preset-2", name: "Mastering" }]);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("keeps invalid and no-op Preset library mutations side-effect free", async () => {
    const flush = vi.fn(async () => {});
    mount({
      flush,
      presets: { list: [{ id: "preset-1", name: "Mixing" }], activeId: null, dirty: false },
    });
    await waitUntilReady();

    const noOp = await send(
      request("preset.rename", { presetId: "preset-1", name: " Mixing " }, "preset-rename-noop")
    );
    const invalid = await send(
      request("preset.reorder", { presetIds: ["missing"] }, "preset-reorder-invalid")
    );

    expect(noOp.result).toMatchObject({
      changed: false,
      revision: 0,
      state: {
        preset: { id: "preset-1", name: "Mixing" },
        presets: { activeId: null, dirty: false },
      },
    });
    expect(invalid.error).toMatchObject({
      code: -32602,
      data: {
        reason: "invalidPreset",
        details: { issues: [expect.objectContaining({ code: "invalidPermutation" })] },
      },
    });
    expect(flush).not.toHaveBeenCalled();
  });

  it("saves a captured scene and previews an update without allocating or persisting", async () => {
    const flush = vi.fn(async () => {});
    const snapshot = { tree: { type: "leaf", tabs: [] }, windowPinned: true };
    mount({
      flush,
      capturePresetSnapshot: vi.fn(async () => snapshot),
      presets: { list: [], activeId: null, dirty: false },
    });
    await waitUntilReady();

    const saved = await send(
      request(
        "preset.save",
        {
          name: "  New Mix  ",
          expectedRevision: 0,
        },
        "preset-save"
      )
    );
    const updateDryRun = await send(
      request(
        "preset.update",
        {
          presetId: "preset-new",
          expectedRevision: 1,
          dryRun: true,
        },
        "preset-update-dry"
      )
    );

    expect(saved.result).toMatchObject({
      dryRun: false,
      changed: true,
      state: {
        preset: { id: "preset-new", name: "New Mix" },
        presets: { activeId: "preset-new", dirty: false },
      },
      revision: 1,
    });
    expect(updateDryRun.result).toMatchObject({
      dryRun: true,
      changed: false,
      state: {
        preset: { id: "preset-new", name: "New Mix" },
        presets: { activeId: "preset-new", dirty: false },
      },
      revision: 1,
    });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("preserves structured blocking-editor refusals for Preset capture", async () => {
    const flush = vi.fn(async () => {});
    mount({
      flush,
      assertPresetOperationAllowed: (operation) => {
        throw new SceneOperationBlockedError(operation, ["theme"]);
      },
      presets: { list: [], activeId: null, dirty: false },
    });
    await waitUntilReady();

    const response = await send(request("preset.save", { name: "Blocked" }, "preset-save-blocked"));

    expect(response.error).toMatchObject({
      code: -32040,
      data: {
        reason: "editorActive",
        details: { operation: "preset.save", editors: ["theme"] },
      },
    });
    expect(flush).not.toHaveBeenCalled();
  });

  it.each([
    ["preset.save", { name: "Late Blocked" }],
    ["preset.update", { presetId: "preset-1" }],
    ["preset.apply", { presetId: "preset-1" }],
  ])("refuses %s when a blocking editor opens during scene capture", async (method, params) => {
    const flush = vi.fn(async () => {});
    const snapshot = createDeferred();
    const capturePresetSnapshot = vi.fn(() => snapshot.promise);
    let editorOpen = false;
    const view = mount({
      flush,
      capturePresetSnapshot,
      assertPresetOperationAllowed: (operation) => {
        if (editorOpen) throw new SceneOperationBlockedError(operation, ["theme"]);
      },
      applyPresetToWorkspace: true,
      presets: {
        list: [
          {
            id: "preset-1",
            name: "Mix",
            ...DEFAULT_WORKSPACE_STATE,
            windowPinned: true,
          },
        ],
        activeId: null,
        dirty: false,
      },
    });
    await waitUntilReady();
    const beforePresets = await send(request("preset.list", {}, `${method}-before`));
    const beforeWorkspace = JSON.stringify(view.store.state);
    const raw = request(method, params, `${method}-late-blocked`);

    act(() => adapter.handler(raw));
    await waitFor(() => expect(capturePresetSnapshot).toHaveBeenCalledTimes(1));
    editorOpen = true;
    await act(async () => {
      snapshot.resolve({
        ...DEFAULT_WORKSPACE_STATE,
        tree: { type: "leaf", tabs: ["captured"] },
        windowPinned: false,
      });
    });
    await waitFor(() =>
      expect(adapter.responses.some(({ requestId }) => requestId === raw.id)).toBe(true)
    );

    const response = adapter.responses.find(({ requestId }) => requestId === raw.id);
    expect(response.error).toMatchObject({
      code: -32040,
      data: {
        reason: "editorActive",
        details: { operation: method, editors: ["theme"] },
      },
    });
    const afterPresets = await send(request("preset.list", {}, `${method}-after`));
    expect(afterPresets.result).toEqual(beforePresets.result);
    expect(JSON.stringify(view.store.state)).toBe(beforeWorkspace);
    expect(flush).not.toHaveBeenCalled();
  });

  it("fails one command instead of the channel when a commit is never observed", async () => {
    // A settlement predicate that never matches used to hang forever, and because commands share
    // one serialized queue every later command hung behind it - the control channel was dead until
    // the app restarted. The backstop turns that into a single stated failure.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // Resolves without ever moving Dock state, so the settlement can never match.
      mount({ executeAgentDock: vi.fn(async () => {}) });
      await vi.waitFor(() => expect(adapter.ready).toHaveBeenCalledTimes(1));

      act(() => adapter.handler(request("dock.enter", { edge: "top" }, "dock-stuck")));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });

      const response = adapter.responses.find(({ requestId }) => requestId === "dock-stuck");
      expect(response?.error).toMatchObject({
        code: -32031,
        data: { reason: "commitNotObserved", details: { stateCommitted: true } },
      });

      // The queue moved on rather than staying blocked behind it.
      act(() => adapter.handler(request("app.inspect", {}, "after-stuck")));
      await vi.waitFor(() =>
        expect(adapter.responses.some(({ requestId }) => requestId === "after-stuck")).toBe(true)
      );
      const after = adapter.responses.find(({ requestId }) => requestId === "after-stuck");
      expect(after.error).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies a Preset whose stored controls no longer match the migrated Workspace", async () => {
    // A Preset saved before a control existed stores a different `panelControlsById` than the one
    // applying it produces, because applying migrates. Waiting for the live Workspace to equal the
    // *stored* record therefore never settled, and since commands share one serialized queue that
    // hung every later command until the app restarted.
    const flush = vi.fn(async () => {});
    const stale = {
      id: "preset-1",
      name: "Saved Long Ago",
      ...DEFAULT_WORKSPACE_STATE,
      panelControlsById: { spectrum: { spectrumSpeedPercent: 40, removedLegacyControl: 7 } },
    };
    // The Preset really does differ from what applying it yields, or the test proves nothing.
    expect(JSON.stringify(presetWorkspaceView(stale).panelControlsById)).not.toBe(
      JSON.stringify(stale.panelControlsById)
    );

    const view = mount({
      flush,
      applyPresetToWorkspace: true,
      capturePresetSnapshot: vi.fn(async () => ({
        ...DEFAULT_WORKSPACE_STATE,
        windowPinned: false,
      })),
      presets: { list: [stale], activeId: null, dirty: false },
    });
    await waitUntilReady();

    const response = await send(request("preset.apply", { presetId: "preset-1" }, "preset-stale"));

    expect(response.error).toBeUndefined();
    expect(response.result).toMatchObject({
      dryRun: false,
      state: { preset: { id: "preset-1" } },
    });
    expect(flush).toHaveBeenCalled();

    // The channel is still usable: a hung settlement used to block everything behind it.
    const after = await send(request("app.inspect", {}, "after-stale-apply"));
    expect(after.error).toBeUndefined();
    expect(view.store.state.panelControlsById.spectrum.spectrumSpeedPercent).toBe(40);
  });

  it("applies a matching Preset by associating it without replacing the Workspace", async () => {
    const flush = vi.fn(async () => {});
    const snapshot = { tree: { type: "leaf", tabs: [] }, windowPinned: true };
    mount({
      flush,
      capturePresetSnapshot: vi.fn(async () => snapshot),
      presets: {
        list: [{ id: "preset-1", name: "Mix", ...snapshot }],
        activeId: null,
        dirty: false,
      },
    });
    await waitUntilReady();

    const response = await send(
      request(
        "preset.apply",
        {
          presetId: "preset-1",
          expectedRevision: 0,
        },
        "preset-apply"
      )
    );

    expect(response.error).toBeUndefined();
    expect(response.result).toMatchObject({
      dryRun: false,
      changed: true,
      state: {
        preset: { id: "preset-1", name: "Mix" },
        presets: { activeId: "preset-1", dirty: false },
      },
      revision: 1,
    });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("publishes one revision after all staggered Preset Apply commits settle", async () => {
    const flush = vi.fn(async () => {});
    const presetApplyBarrier = createDeferred();
    const target = {
      id: "preset-1",
      name: "Target",
      ...DEFAULT_WORKSPACE_STATE,
      tree: { type: "leaf", tabs: ["spectrum"], activeTab: "spectrum" },
    };
    const view = mount({
      flush,
      applyPresetToWorkspace: true,
      presetApplyBarrier: presetApplyBarrier.promise,
      capturePresetSnapshot: vi.fn(async () => ({
        ...DEFAULT_WORKSPACE_STATE,
        windowPinned: false,
      })),
      presets: { list: [target], activeId: null, dirty: false },
    });
    await waitUntilReady();
    const applyRequest = request(
      "preset.apply",
      { presetId: "preset-1", expectedRevision: 0 },
      "staggered-preset-apply"
    );
    act(() => {
      adapter.handler(applyRequest);
    });
    await waitFor(() => expect(view.store.state.tree).toEqual(target.tree));

    act(() => {
      adapter.handler(
        request("app.wait", { afterRevision: 0, timeoutMs: 1000 }, "wait-preset-apply")
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      adapter.responses.find(({ requestId }) => requestId === "wait-preset-apply")
    ).toBeUndefined();

    await act(async () => {
      presetApplyBarrier.resolve();
    });
    await waitFor(() =>
      expect(
        adapter.responses.some(({ requestId }) => requestId === "staggered-preset-apply")
      ).toBe(true)
    );
    await waitFor(() =>
      expect(adapter.responses.some(({ requestId }) => requestId === "wait-preset-apply")).toBe(
        true
      )
    );
    const applied = adapter.responses.find(
      ({ requestId }) => requestId === "staggered-preset-apply"
    );
    const waited = adapter.responses.find(({ requestId }) => requestId === "wait-preset-apply");

    expect(applied.result.revision).toBe(1);
    expect(waited.result).toEqual({
      outcome: "changed",
      matchedImmediately: false,
      revision: 1,
    });
    expect(view.store.state.tree).toEqual(target.tree);
    expect(applied.result.state.presets).toMatchObject({
      activeId: "preset-1",
      dirty: false,
    });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("previews Preset resource fallbacks", async () => {
    const target = {
      id: "preset-1",
      name: "Mix",
      tree: { type: "leaf", tabs: [] },
      windowPinned: true,
      loudnessProfileActive: "profile:deleted",
      dock: { enabled: true, monitor: "missing-monitor" },
    };
    mount({
      capturePresetSnapshot: vi.fn(async () => ({ tree: target.tree, windowPinned: true })),
      presets: { list: [target], activeId: null, dirty: false },
      agentDockContext: {
        monitors: [{ id: "monitor-1", name: "Display 1" }],
        fallbackMonitor: "monitor-1",
        monitorInventoryReady: true,
      },
    });
    await waitUntilReady();

    const response = await send(
      request("preset.apply", { presetId: "preset-1", dryRun: true }, "preset-fallback-dry")
    );

    expect(response.result.warnings).toEqual([
      { code: "loudnessProfileUnavailable", requested: "deleted", effective: null },
      { code: "dockMonitorUnavailable", requested: "missing-monitor", effective: "monitor-1" },
    ]);
  });

  it("does not advance the public revision for transient fullscreen state", async () => {
    const view = mount();
    await waitUntilReady();

    act(() => view.store.setFullscreen("spectrum"));
    const inspected = await send(request("app.inspect", {}, "inspect-fullscreen"));

    expect(inspected.result.revision).toBe(0);
  });

  it("reports Loudness reference availability from the active Profile", async () => {
    mount({ hasLoudnessReference: true });
    await waitUntilReady();

    const inspected = await send(request("app.inspect", {}, "inspect-reference"));
    const loudness = inspected.result.workspace.panels.find(({ id }) => id === "loudness");

    expect(loudness.controls.layers).toEqual(["momentary", "shortTerm", "reference"]);
  });

  it("reports panel analysis against the current channel topology", async () => {
    const view = mount({ analysisContext: { channelCount: 4 } });
    await waitUntilReady();
    act(() => {
      view.store.setPanelControlsForPanel("spectrum", {
        ...view.store.state.panelControlsById.spectrum,
        spectrumChannel: { type: "pair", x: 0, y: 3 },
      });
    });

    const inspected = await send(request("app.inspect", {}, "inspect-analysis"));
    const spectrum = inspected.result.workspace.panels.find(({ id }) => id === "spectrum");

    expect(spectrum.analysis).toEqual({ status: "active" });
  });

  it("describes one live panel with its dynamic public control schema", async () => {
    mount({ analysisContext: { channelCount: 6 }, hasLoudnessReference: false });
    await waitUntilReady();

    const response = await send(
      request("panel.describe", { panelId: "loudness" }, "describe-panel")
    );

    expect(response.result).toMatchObject({
      revision: 0,
      panel: {
        id: "loudness",
        moduleId: "loudness",
        controls: { layers: ["momentary", "shortTerm"] },
      },
      schema: {
        type: "object",
        patchMode: "merge",
        properties: {
          layers: { options: ["momentary", "shortTerm"] },
        },
      },
    });
  });

  it("returns panelNotFound when describing an unknown panel", async () => {
    mount();
    await waitUntilReady();

    const response = await send(
      request("panel.describe", { panelId: "missing" }, "describe-missing")
    );

    expect(response.error).toMatchObject({
      code: -32010,
      data: { reason: "panelNotFound", path: "$.params.panelId" },
    });
  });

  it("describes and inspects Axis Control without mutating Workspace state", async () => {
    const view = mount({
      analysisContext: { timeMaxWindowSec: 3600, timeMaxOffsetSec: 3540 },
    });
    await waitUntilReady();
    const initialState = view.store.state;

    const described = await send(request("axis.describe", {}, "axis-describe"));
    const inspected = await send(request("axis.inspect", {}, "axis-inspect"));

    expect(described.result).toMatchObject({
      revision: 0,
      schema: {
        time: { properties: { windowSec: { maximum: 3600 } } },
      },
      shared: { frequency: { minHz: 20, maxHz: 20000 } },
    });
    expect(inspected.result).toMatchObject({
      revision: 0,
      shared: { time: { windowSec: 60, offsetSec: 0 } },
      panels: expect.any(Array),
    });
    expect(inspected.result).not.toHaveProperty("schema");
    expect(view.store.state).toBe(initialState);
  });

  it("updates a shared axis as one durable Workspace mutation", async () => {
    const flush = vi.fn(async () => {});
    const presets = { activeId: "preset-1", dirty: false };
    const view = mount({ flush, presets });
    await waitUntilReady();

    const response = await send(
      request(
        "axis.shared.update",
        {
          kind: "frequency",
          range: { minHz: 200, maxHz: 5000 },
          expectedRevision: 0,
        },
        "axis-shared-update"
      )
    );

    expect(response.result).toMatchObject({
      dryRun: false,
      revision: 1,
      changed: true,
      warnings: [],
      state: {
        axis: { shared: { frequency: { minHz: 200, maxHz: 5000 } } },
        preset: { activeId: "preset-1", dirty: true },
      },
    });
    expect(response.result).not.toHaveProperty("axis");
    expect(response.result).not.toHaveProperty("preset");
    expect(response.result).not.toHaveProperty("persisted");
    expect(view.store.state.axisViewports.frequency).toEqual({ min: 200, max: 5000 });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("dry-runs a panel unlink and rejects a linked local range atomically", async () => {
    const flush = vi.fn(async () => {});
    const view = mount({ flush });
    await waitUntilReady();
    const initialState = view.store.state;

    const dryRun = await send(
      request(
        "axis.panel.update",
        {
          panelId: "spectrum",
          kind: "frequency",
          patch: { linked: false, range: { minHz: 200, maxHz: 5000 } },
          dryRun: true,
        },
        "axis-panel-dry"
      )
    );
    const invalid = await send(
      request(
        "axis.panel.update",
        {
          panelId: "spectrum",
          kind: "frequency",
          patch: { range: { minHz: 200, maxHz: 5000 } },
        },
        "axis-panel-invalid"
      )
    );

    expect(dryRun.result).toMatchObject({
      dryRun: true,
      revision: 0,
      changed: true,
      state: {
        axis: {
          panels: expect.arrayContaining([
            expect.objectContaining({
              id: "spectrum",
              axes: expect.objectContaining({
                frequency: expect.objectContaining({ linked: false }),
              }),
            }),
          ]),
        },
      },
    });
    expect(invalid.error).toMatchObject({
      code: -32602,
      data: {
        reason: "invalidAxis",
        details: { issues: [expect.objectContaining({ code: "rangeWhileLinked" })] },
      },
    });
    expect(view.store.state).toBe(initialState);
    expect(flush).not.toHaveBeenCalled();
  });

  it("resets panel and shared axes and returns stable target errors", async () => {
    const flush = vi.fn(async () => {});
    const view = mount({ flush });
    await waitUntilReady();
    act(() => {
      view.store.replaceWorkspace({
        ...view.store.state,
        axisViewports: {
          ...view.store.state.axisViewports,
          frequency: { min: 200, max: 5000 },
        },
        panelControlsById: {
          ...view.store.state.panelControlsById,
          spectrum: {
            ...view.store.state.panelControlsById.spectrum,
            linkFrequencyViewport: false,
            spectrumXMinFreq: 1000,
            spectrumXMaxFreq: 8000,
          },
        },
      });
    });
    flush.mockClear();

    const panelReset = await send(
      request(
        "axis.panel.reset",
        { panelId: "spectrum", kind: "frequency", expectedRevision: 1 },
        "axis-panel-reset"
      )
    );
    const sharedReset = await send(
      request("axis.shared.reset", { kind: "frequency", expectedRevision: 2 }, "axis-shared-reset")
    );
    const unavailable = await send(
      request(
        "axis.panel.reset",
        { panelId: "levelMeter", kind: "frequency", expectedRevision: 3 },
        "axis-unavailable"
      )
    );

    expect(panelReset.result.changed).toBe(true);
    expect(sharedReset.result.state.axis.shared.frequency).toEqual({ minHz: 20, maxHz: 20000 });
    expect(unavailable.error).toMatchObject({
      code: -32012,
      data: { reason: "axisUnavailable", path: "$.params.kind" },
    });
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("returns one structured error for invalid or unsupported requests", async () => {
    mount();
    await waitUntilReady();
    const response = await send(request("unknown.method", {}, "bad"));
    expect(response).toEqual({
      requestId: "bad",
      error: expect.objectContaining({
        code: -32601,
        data: expect.objectContaining({ reason: "methodNotFound" }),
      }),
    });
    expect(adapter.respond).toHaveBeenCalledTimes(1);
  });

  it("dry-runs with planned IDs without mutation or persistence", async () => {
    const flush = vi.fn(async () => {});
    const view = mount({ flush });
    await waitUntilReady();
    const initialState = view.store.state;
    const response = await send(
      request(
        "workspace.applyLayout",
        {
          dryRun: true,
          expectedRevision: 0,
          layout: { type: "panel", key: "map", moduleId: "stereo-map" },
        },
        "dry"
      )
    );

    expect(response.result).toMatchObject({
      revision: 0,
      dryRun: true,
      changed: true,
      state: { workspace: { layout: { type: "panel", panelId: "stereo-map" } } },
      createdPanels: { map: "stereo-map" },
    });
    expect(response.result).not.toHaveProperty("persisted");
    expect(view.store.state).toBe(initialState);
    expect(flush).not.toHaveBeenCalled();
  });

  it("updates panel controls atomically and returns the complete persisted panel", async () => {
    const flush = vi.fn(async () => {});
    const view = mount({ flush });
    await waitUntilReady();

    const response = await send(
      request(
        "panel.update",
        {
          panelId: "levelMeter",
          expectedRevision: 0,
          patch: { mode: "rms", playbackMax: true },
        },
        "panel-update"
      )
    );

    expect(response.result).toMatchObject({
      dryRun: false,
      revision: 1,
      changed: true,
      warnings: [],
      state: {
        panel: {
          id: "levelMeter",
          moduleId: "levelMeter",
          controls: { mode: "rms", playbackMax: true },
        },
        preset: { activeId: null, dirty: false },
      },
    });
    expect(response.result).not.toHaveProperty("panel");
    expect(response.result).not.toHaveProperty("preset");
    expect(response.result).not.toHaveProperty("persisted");
    expect(view.store.state.panelControlsById.levelMeter).toMatchObject({
      levelMeterMode: "rms",
      levelMeterPlaybackMax: true,
    });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("dry-runs a panel update without changing revision, state, or persistence", async () => {
    const flush = vi.fn(async () => {});
    const view = mount({ flush });
    await waitUntilReady();
    const initialState = view.store.state;

    const response = await send(
      request(
        "panel.update",
        { panelId: "levelMeter", dryRun: true, patch: { mode: "rms" } },
        "panel-dry"
      )
    );

    expect(response.result).toMatchObject({
      dryRun: true,
      revision: 0,
      changed: true,
      state: { panel: { controls: { mode: "rms" } } },
    });
    expect(response.result).toMatchObject(goldenResult("mutation.panelDryRun"));
    expect(view.store.state).toBe(initialState);
    expect(flush).not.toHaveBeenCalled();
  });

  it("returns all panel validation issues without partial mutation", async () => {
    const flush = vi.fn(async () => {});
    const view = mount({ flush });
    await waitUntilReady();
    const initialControls = view.store.state.panelControlsById.levelMeter;

    const response = await send(
      request(
        "panel.update",
        {
          panelId: "levelMeter",
          patch: { unknown: true, mode: "vu", playbackMax: "yes" },
        },
        "panel-invalid"
      )
    );

    expect(response.error).toMatchObject({
      data: {
        reason: "invalidControls",
        path: "$.params.patch",
        details: {
          issues: [
            expect.objectContaining({ code: "unknownControl", path: "$.unknown" }),
            expect.objectContaining({ code: "invalidEnum", path: "$.mode" }),
            expect.objectContaining({ code: "invalidType", path: "$.playbackMax" }),
          ],
        },
      },
    });
    expect(view.store.state.panelControlsById.levelMeter).toBe(initialControls);
    expect(flush).not.toHaveBeenCalled();
  });

  it("keeps a no-op panel update clean and marks an effective update dirty", async () => {
    const flush = vi.fn(async () => {});
    const presets = { activeId: "preset-1", dirty: false };
    const view = mount({ flush, presets });
    await waitUntilReady();
    const initialState = view.store.state;

    const noOp = await send(
      request("panel.update", { panelId: "levelMeter", patch: { mode: "peak" } }, "panel-no-op")
    );
    expect(noOp.result).toMatchObject({
      revision: 0,
      changed: false,
      state: { preset: { activeId: "preset-1", dirty: false } },
    });
    expect(view.store.state).toBe(initialState);
    expect(flush).not.toHaveBeenCalled();

    const changed = await send(
      request("panel.update", { panelId: "levelMeter", patch: { mode: "rms" } }, "panel-dirty")
    );
    expect(changed.result.state.preset).toEqual({ activeId: "preset-1", dirty: true });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("reports a panel persistence failure with the committed revision", async () => {
    const flush = vi
      .fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(undefined);
    const view = mount({ flush });
    await waitUntilReady();
    act(() => {
      adapter.handler(request("app.wait", { afterRevision: 0, timeoutMs: 1000 }, "wait-flush"));
    });

    const response = await send(
      request("panel.update", { panelId: "levelMeter", patch: { mode: "rms" } }, "panel-flush")
    );

    expect(response.error).toMatchObject({
      code: -32030,
      data: {
        reason: "persistenceFailed",
        details: { stateCommitted: true, revision: 1 },
      },
    });
    expect(view.store.state.panelControlsById.levelMeter.levelMeterMode).toBe("rms");

    await waitFor(() =>
      expect(adapter.responses.some(({ requestId }) => requestId === "wait-flush")).toBe(true)
    );
    expect(adapter.responses.find(({ requestId }) => requestId === "wait-flush").result).toEqual({
      outcome: "changed",
      matchedImmediately: false,
      revision: 1,
    });

    const recovered = await send(
      request(
        "panel.update",
        { panelId: "levelMeter", patch: { mode: "peak" }, expectedRevision: 1 },
        "panel-after-flush"
      )
    );
    expect(recovered.result).toMatchObject({ changed: true, revision: 2 });
  });

  it("resets panel controls and local axis state as one persisted Workspace mutation", async () => {
    const flush = vi.fn(async () => {});
    const presets = { activeId: "preset-1", dirty: false };
    const view = mount({ flush, presets });
    await waitUntilReady();
    act(() => {
      view.store.setPanelControlsForPanel("spectrum", {
        ...view.store.state.panelControlsById.spectrum,
        spectrumMaxMode: "hold",
        spectrumSpeedPercent: 80,
        linkFrequencyViewport: false,
        spectrumXMinFreq: 200,
        spectrumXMaxFreq: 5000,
      });
    });
    const revision = (await send(request("app.inspect", {}, "before-reset"))).result.revision;
    flush.mockClear();

    const response = await send(
      request("panel.reset", { panelId: "spectrum", expectedRevision: revision }, "panel-reset")
    );

    expect(response.result).toMatchObject({
      dryRun: false,
      revision: revision + 1,
      changed: true,
      warnings: [],
      state: {
        panel: {
          id: "spectrum",
          moduleId: "spectrum",
          controls: { maxMode: "off", speedPercent: 25 },
          axes: { frequency: { linked: true } },
        },
        preset: { activeId: "preset-1", dirty: true },
      },
    });
    expect(view.store.state.panelControlsById.spectrum).toMatchObject({
      spectrumMaxMode: "off",
      spectrumSpeedPercent: 25,
      linkFrequencyViewport: true,
      spectrumXMinFreq: 20,
      spectrumXMaxFreq: 20000,
    });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("dry-runs and no-ops panel resets without persistence", async () => {
    const flush = vi.fn(async () => {});
    const view = mount({ flush });
    await waitUntilReady();
    const initialState = view.store.state;

    const noOp = await send(request("panel.reset", { panelId: "spectrum" }, "reset-no-op"));
    const dryRun = await send(
      request("panel.reset", { panelId: "levelMeter", dryRun: true }, "reset-dry")
    );

    expect(noOp.result).toMatchObject({ revision: 0, changed: false, dryRun: false });
    expect(dryRun.result).toMatchObject({ revision: 0, changed: false, dryRun: true });
    expect(view.store.state).toBe(initialState);
    expect(flush).not.toHaveBeenCalled();
  });

  it("applies once, waits for commit and persistence, and returns the committed revision", async () => {
    const flush = vi.fn(async () => {});
    const view = mount({ flush });
    await waitUntilReady();
    const response = await send(
      request(
        "workspace.applyLayout",
        {
          expectedRevision: 0,
          layout: { type: "panel", panelId: "spectrum" },
        },
        "apply"
      )
    );

    expect(response.result).toMatchObject({
      revision: 1,
      changed: true,
      state: { workspace: { layout: { type: "panel", panelId: "spectrum" } } },
    });
    expect(response.result).not.toHaveProperty("layout");
    expect(response.result).not.toHaveProperty("persisted");
    expect(view.store.state.tree).toEqual({
      type: "leaf",
      tabs: ["spectrum"],
      activeTab: "spectrum",
    });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("does not commit or persist when applying the current layout", async () => {
    const flush = vi.fn(async () => {});
    const view = mount({ flush });
    await waitUntilReady();
    const initialState = view.store.state;
    const inspected = await send(request("app.inspect", {}, "inspect-current"));

    const response = await send(
      request(
        "workspace.applyLayout",
        { expectedRevision: 0, layout: inspected.result.workspace.layout },
        "apply-current"
      )
    );

    expect(response.result).toMatchObject({
      revision: 0,
      changed: false,
      state: { workspace: { layout: inspected.result.workspace.layout } },
    });
    expect(view.store.state).toBe(initialState);
    expect(flush).not.toHaveBeenCalled();
  });

  it("checks revision at the queue head before compiling or mutating", async () => {
    const flush = vi.fn(async () => {});
    const view = mount({ flush });
    await waitUntilReady();
    act(() => view.store.setTree({ type: "leaf", tabs: ["stats"], activeTab: "stats" }));

    const response = await send(
      request(
        "workspace.applyLayout",
        {
          expectedRevision: 0,
          layout: { type: "panel", key: "new", moduleId: "spectrum" },
        },
        "stale"
      )
    );

    expect(response.error).toMatchObject({
      code: -32004,
      data: expect.objectContaining({ reason: "revisionConflict" }),
    });
    expect(view.store.state.tree).toEqual({
      type: "leaf",
      tabs: ["stats"],
      activeTab: "stats",
    });
    expect(flush).not.toHaveBeenCalled();
  });

  it("reports the committed revision when persistence fails", async () => {
    const flush = vi.fn(async () => {
      throw new Error("disk full");
    });
    mount({ flush });
    await waitUntilReady();
    const response = await send(
      request(
        "workspace.applyLayout",
        { layout: { type: "panel", panelId: "spectrum" } },
        "failed-flush"
      )
    );
    expect(response.error).toMatchObject({
      code: -32030,
      data: {
        reason: "persistenceFailed",
        details: { stateCommitted: true, revision: 1 },
      },
    });
    expect(response).not.toHaveProperty("result");
  });

  it("serializes requests and never sends a late response after unmount", async () => {
    let releaseFlush;
    const flush = vi.fn(() => new Promise((resolve) => (releaseFlush = resolve)));
    const view = mount({ flush });
    await waitUntilReady();

    act(() => {
      adapter.handler(
        request(
          "workspace.applyLayout",
          { layout: { type: "panel", panelId: "spectrum" } },
          "first"
        )
      );
      adapter.handler(request("app.inspect", {}, "second"));
    });
    await waitFor(() => expect(releaseFlush).toBeTypeOf("function"));
    expect(adapter.responses).toHaveLength(0);

    view.unmount();
    releaseFlush();
    await Promise.resolve();
    await Promise.resolve();
    expect(adapter.responses).toHaveLength(0);
  });

  it("bumps the revision when the theme library changes outside a command", async () => {
    const view = mount({ customThemes: { "t-1": makeTheme("t-1", "Studio") } });
    await waitUntilReady();
    const before = (await send(request("app.capabilities", {}, "theme-before"))).result.revision;

    view.rerender(
      <WorkspaceProvider>
        <Harness
          customThemes={{
            "t-1": makeTheme("t-1", "Studio"),
            "t-2": makeTheme("t-2", "Night"),
          }}
        />
      </WorkspaceProvider>
    );

    const after = (await send(request("app.capabilities", {}, "theme-after"))).result.revision;
    expect(after).toBe(before + 1);
  });

  it("tracks Appearance, custom order, and complete Theme documents but not system resolution", async () => {
    const first = makeTheme("custom-a", "A");
    const second = makeTheme("custom-b", "B");
    const system = {
      appearance: { mode: "system", selectedThemeId: null, resolvedThemeId: "plvs-dark" },
      themes: [first, second],
    };
    const view = mount({ themeState: system });
    await waitUntilReady();
    const initialRevision = (await send(request("app.capabilities", {}, "theme-state-start")))
      .result.revision;
    expect(initialRevision).toBe(0);

    const rerender = async (themeState, id) => {
      view.rerender(
        <WorkspaceProvider>
          <Harness themeState={themeState} />
        </WorkspaceProvider>
      );
      return (await send(request("app.capabilities", {}, id))).result.revision;
    };

    let revision = await rerender(
      { ...system, appearance: { ...system.appearance, resolvedThemeId: "plvs-light" } },
      "theme-resolution"
    );
    expect(revision).toBe(0);

    const fixed = {
      ...system,
      appearance: { mode: "fixed", selectedThemeId: "custom-a", resolvedThemeId: "custom-a" },
    };
    revision = await rerender(fixed, "theme-selection");
    expect(revision).toBe(1);

    const edited = {
      ...fixed,
      themes: [{ ...first, core: { ...first.core, workspace: "#111111" } }, second],
    };
    revision = await rerender(edited, "theme-document");
    expect(revision).toBe(2);

    revision = await rerender({ ...edited, themes: [...edited.themes].reverse() }, "theme-order");
    expect(revision).toBe(3);
  });

  it("increments the global revision once for a simultaneous Theme library and Appearance commit", async () => {
    const before = {
      appearance: { mode: "system", selectedThemeId: null, resolvedThemeId: "plvs-dark" },
      themes: [],
    };
    const view = mount({ themeState: before });
    await waitUntilReady();
    const created = makeTheme("custom-created", "Created");
    view.rerender(
      <WorkspaceProvider>
        <Harness
          themeState={{
            appearance: {
              mode: "fixed",
              selectedThemeId: created.id,
              resolvedThemeId: created.id,
            },
            themes: [created],
          }}
        />
      </WorkspaceProvider>
    );

    const revision = (await send(request("app.capabilities", {}, "theme-cross-store"))).result
      .revision;
    expect(revision).toBe(1);
  });

  it("bumps the revision when the loudness profile library changes outside a command", async () => {
    const view = mount({ loudnessProfiles: [{ id: "p-1", name: "EBU R128", rules: [] }] });
    await waitUntilReady();
    const before = (await send(request("app.capabilities", {}, "loudness-before"))).result.revision;

    view.rerender(
      <WorkspaceProvider>
        <Harness
          loudnessProfiles={[
            { id: "p-1", name: "EBU R128", rules: [] },
            { id: "p-2", name: "ATSC A/85", rules: [] },
          ]}
        />
      </WorkspaceProvider>
    );

    const after = (await send(request("app.capabilities", {}, "loudness-after"))).result.revision;
    expect(after).toBe(before + 1);
  });

  it("tracks active selection and every normalized Loudness Profile field in revision identity", async () => {
    const base = {
      id: "p-1",
      name: "EBU R128",
      referenceLufs: -23,
      rules: [{ metricId: "integrated", op: ">", value: -22.5, severity: "fail" }],
    };
    settingsStore.patch({
      loudnessProfiles: { active: "off", profiles: [base] },
    });
    const view = mount({ loudnessProfiles: [base] });
    await waitUntilReady();
    let revision = (await send(request("app.capabilities", {}, "profile-revision-start"))).result
      .revision;

    const expectOneBump = async (profiles, active, id) => {
      settingsStore.patch({ loudnessProfiles: { active, profiles } });
      view.rerender(
        <WorkspaceProvider>
          <Harness loudnessProfiles={profiles} />
        </WorkspaceProvider>
      );
      await waitFor(async () => {
        const next = (await send(request("app.capabilities", {}, id))).result.revision;
        expect(next).toBe(revision + 1);
        revision = next;
      });
    };

    await expectOneBump([base], "profile:p-1", "profile-selection");
    const ruleEdited = {
      ...base,
      rules: [{ ...base.rules[0], value: -21.5, severity: "warn" }],
    };
    await expectOneBump([ruleEdited], "profile:p-1", "profile-rule");
    const renamed = { ...ruleEdited, name: "Renamed" };
    await expectOneBump([renamed], "profile:p-1", "profile-rename");
    const created = { id: "p-2", name: "Second", referenceLufs: null, rules: [] };
    await expectOneBump([renamed, created], "profile:p-1", "profile-create");
    await expectOneBump([created, renamed], "profile:p-1", "profile-reorder");
    await expectOneBump([renamed], "profile:p-1", "profile-delete");

    view.rerender(
      <WorkspaceProvider>
        <Harness loudnessProfiles={structuredClone([renamed])} />
      </WorkspaceProvider>
    );
    const noOp = (await send(request("app.capabilities", {}, "profile-noop"))).result.revision;
    expect(noOp).toBe(revision);
  });

  it("exports the normalized Everything configuration without changing revision", async () => {
    const configuration = {
      app: "PLVS",
      kind: "configuration-profile",
      version: 1,
      settings: { interfaceSize: "large" },
      workspace: {},
      presets: { list: [], activeId: null },
      themes: { themes: {}, order: [] },
      windowBounds: null,
      captureDeviceId: "default",
      clearShortcut: "CmdOrCtrl+K",
      clearGlobal: false,
    };
    const exportConfiguration = vi.fn(async () => configuration);
    mount({ exportConfiguration });
    await waitUntilReady();

    const before = (await send(request("app.capabilities", {}, "config-before"))).result.revision;
    const response = await send(request("config.export", {}, "config-export"));
    const after = (await send(request("app.capabilities", {}, "config-after"))).result.revision;

    expect(response.result).toEqual({ revision: before, configuration });
    expect(after).toBe(before);
    expect(exportConfiguration).toHaveBeenCalledTimes(1);
  });

  it("validates configuration imports without writing or relaunching in dry-run", async () => {
    const configuration = { app: "PLVS", kind: "configuration-profile", version: 1 };
    const normalized = { ...configuration, settings: {}, workspace: {} };
    const normalizeConfiguration = vi.fn(() => normalized);
    const importConfiguration = vi.fn();
    const relaunchAfterConfigurationChange = vi.fn();
    mount({ normalizeConfiguration, importConfiguration, relaunchAfterConfigurationChange });
    await waitUntilReady();

    const response = await send(
      request("config.import", { configuration, expectedRevision: 0, dryRun: true }, "config-dry")
    );

    expect(response.result).toEqual({
      dryRun: true,
      revision: 0,
      changed: true,
      relaunch: false,
      configuration: normalized,
    });
    expect(normalizeConfiguration).toHaveBeenCalledWith(configuration);
    expect(importConfiguration).not.toHaveBeenCalled();
    expect(relaunchAfterConfigurationChange).not.toHaveBeenCalled();
  });

  it("relaunches only after the CLI has received a persisted configuration result", async () => {
    const configuration = { app: "PLVS", kind: "configuration-profile", version: 1 };
    const delivery = createDeferred();
    const order = [];
    const importConfiguration = vi.fn(async () => order.push("persisted"));
    const relaunchAfterConfigurationChange = vi.fn(async () => order.push("relaunched"));
    adapter.respond.mockImplementationOnce(async (response) => {
      adapter.responses.push(response);
      order.push("response-started");
      await delivery.promise;
      order.push("response-delivered");
    });
    mount({
      importConfiguration,
      normalizeConfiguration: (value) => value,
      relaunchAfterConfigurationChange,
    });
    await waitUntilReady();

    const response = await send(
      request("config.import", { configuration, expectedRevision: 0 }, "config-import")
    );
    expect(response).toEqual({
      requestId: "config-import",
      result: { dryRun: false, revision: 0, changed: true, relaunch: true },
      awaitDelivery: true,
    });
    expect(order).toEqual(["persisted", "response-started"]);

    delivery.resolve();
    await waitFor(() => expect(relaunchAfterConfigurationChange).toHaveBeenCalledTimes(1));
    expect(order).toEqual(["persisted", "response-started", "response-delivered", "relaunched"]);
  });

  it("refuses configuration import before mutation while a blocking editor is open", async () => {
    const importConfiguration = vi.fn();
    mount({
      importConfiguration,
      normalizeConfiguration: (value) => value,
      assertPresetOperationAllowed: (operation) => {
        throw new SceneOperationBlockedError(operation, ["theme"]);
      },
    });
    await waitUntilReady();

    const response = await send(
      request(
        "config.import",
        {
          configuration: { app: "PLVS", kind: "configuration-profile", version: 1 },
          expectedRevision: 0,
        },
        "config-blocked"
      )
    );

    expect(response.error.data.reason).toBe("editorActive");
    expect(response.error.data.details.editors).toEqual(["theme"]);
    expect(importConfiguration).not.toHaveBeenCalled();
  });

  describe("Theme Control", () => {
    function authoring(name = "Studio", overrides = {}) {
      const { id: _id, ...document } = makeTheme("unused", name);
      return { ...document, ...overrides };
    }

    it("inspects Appearance and describes built-in and custom V2 documents", async () => {
      seedThemeLibrary([makeTheme("custom-studio", "Studio")]);
      mountWithThemes();
      await waitUntilReady();

      const inspected = await send(request("theme.inspect", {}, "theme-inspect"));
      const builtin = await send(
        request("theme.describe", { themeId: "plvs-dark" }, "theme-describe-builtin")
      );
      const custom = await send(
        request("theme.describe", { themeId: "custom-studio" }, "theme-describe-custom")
      );

      expect(inspected.result).toEqual({
        revision: 0,
        appearance: { mode: "system", selectedThemeId: null, resolvedThemeId: "plvs-dark" },
      });
      expect(builtin.result).toMatchObject({
        revision: 0,
        theme: { id: "plvs-dark", version: 2 },
        kind: "builtin",
        active: true,
        index: null,
      });
      expect(custom.result).toMatchObject({
        theme: { id: "custom-studio", name: "Studio", version: 2 },
        kind: "custom",
        active: false,
        index: 0,
      });
      expect(builtin.result.theme).not.toHaveProperty("roles");
      const missing = await send(
        request("theme.describe", { themeId: "missing" }, "theme-describe-missing")
      );
      expect(missing.error.data.reason).toBe("themeNotFound");
    });

    it("selects, follows System, creates, updates, renames, duplicates, reorders, and deletes", async () => {
      const flush = vi.fn(async () => {});
      mountWithThemes({ flush });
      await waitUntilReady();
      let revision = 0;

      let response = await send(
        request(
          "theme.select",
          { themeId: "plvs-light", expectedRevision: revision },
          "theme-select"
        )
      );
      revision = response.result.revision;
      expect(response.result.state.appearance).toMatchObject({
        mode: "fixed",
        selectedThemeId: "plvs-light",
      });

      response = await send(
        request("theme.followSystem", { expectedRevision: revision }, "theme-follow")
      );
      revision = response.result.revision;
      expect(response.result.state.appearance.mode).toBe("system");

      response = await send(
        request(
          "theme.create",
          { document: authoring("Created"), expectedRevision: revision },
          "theme-create"
        )
      );
      expect(response.error).toBeUndefined();
      revision = response.result.revision;
      const createdId = response.result.plan.theme.id;
      expect(createdId).toMatch(/^custom-/);
      expect(response.result.state.appearance.selectedThemeId).toBe(createdId);

      response = await send(
        request(
          "theme.update",
          {
            themeId: createdId,
            document: authoring("Updated", {
              core: { ...authoring().core, workspace: "#111111" },
            }),
            expectedRevision: revision,
          },
          "theme-update"
        )
      );
      revision = response.result.revision;
      expect(response.result.plan.theme).toMatchObject({ id: createdId, name: "Updated" });
      expect(response.result.state.appearance.selectedThemeId).toBe(createdId);

      response = await send(
        request(
          "theme.rename",
          { themeId: createdId, name: "Renamed", expectedRevision: revision },
          "theme-rename"
        )
      );
      revision = response.result.revision;
      expect(response.result.plan.theme.name).toBe("Renamed");

      response = await send(
        request(
          "theme.duplicate",
          { themeId: "plvs-dark", name: "Dark Copy", expectedRevision: revision },
          "theme-duplicate"
        )
      );
      revision = response.result.revision;
      const duplicateId = response.result.plan.theme.id;
      expect(response.result.plan.source.kind).toBe("builtin");
      expect(response.result.state.appearance.selectedThemeId).toBe(duplicateId);

      response = await send(
        request(
          "theme.reorder",
          { themeIds: [duplicateId, createdId], expectedRevision: revision },
          "theme-reorder"
        )
      );
      revision = response.result.revision;
      expect(response.result.plan.themeIds).toEqual([duplicateId, createdId]);

      response = await send(
        request(
          "theme.delete",
          { themeId: duplicateId, expectedRevision: revision },
          "theme-delete"
        )
      );
      expect(response.result.plan.fallbackThemeId).toBe("plvs-dark");
      expect(response.result.state.appearance).toMatchObject({
        mode: "fixed",
        selectedThemeId: "plvs-dark",
      });
      expect(response.result.revision).toBe(8);
      expect(flush).toHaveBeenCalledTimes(8);
    });

    it("keeps dry-run and no-op side-effect free and enforces revision and permissions", async () => {
      const flush = vi.fn(async () => {});
      mountWithThemes({ flush });
      await waitUntilReady();

      const preview = await send(
        request(
          "theme.create",
          { document: authoring("Preview"), expectedRevision: 0, dryRun: true },
          "theme-create-preview"
        )
      );
      expect(preview.result).toMatchObject({ dryRun: true, revision: 0, changed: true });
      expect(preview.result.plan).not.toHaveProperty("theme");
      expect(preview.result.state.themes.filter(({ kind }) => kind === "custom")).toEqual([]);

      const noOp = await send(
        request("theme.followSystem", { expectedRevision: 0 }, "theme-follow-noop")
      );
      expect(noOp.result).toMatchObject({ changed: false, revision: 0 });

      const stale = await send(
        request("theme.select", { themeId: "plvs-dark", expectedRevision: 9 }, "theme-select-stale")
      );
      expect(stale.error.data.reason).toBe("revisionConflict");

      const immutable = await send(
        request(
          "theme.update",
          { themeId: "plvs-dark", document: authoring(), expectedRevision: 0 },
          "theme-update-builtin"
        )
      );
      expect(immutable.error.data.reason).toBe("themeNotMutable");

      const invalid = await send(
        request(
          "theme.create",
          { document: { ...authoring(), id: "claimed" }, expectedRevision: 0 },
          "theme-create-invalid"
        )
      );
      expect(invalid.error.data).toMatchObject({
        reason: "invalidTheme",
        details: { issues: [expect.objectContaining({ path: "$.id" })] },
      });
      expect(flush).not.toHaveBeenCalled();
    });

    it("blocks conflicting mutations before draft, stores, preview, ID, or persistence changes", async () => {
      const flush = vi.fn(async () => {});
      const view = mountWithThemes({ flush });
      await waitUntilReady();
      act(() => view.theme.editor.beginCreate("Draft"));
      const beforeDraft = structuredClone(view.theme.editor.draft);
      const beforeSettings = settingsStore.read();
      const beforeThemes = themesStore.read();

      const response = await send(
        request(
          "theme.create",
          { document: authoring("Blocked"), expectedRevision: 0 },
          "theme-create-blocked"
        )
      );
      expect(response.error.data).toMatchObject({
        reason: "editorActive",
        details: { editors: ["theme"] },
      });
      expect(view.theme.editor.draft).toEqual(beforeDraft);
      expect(settingsStore.read()).toEqual(beforeSettings);
      expect(themesStore.read()).toEqual(beforeThemes);
      expect(flush).not.toHaveBeenCalled();

      const reordered = await send(
        request("theme.reorder", { themeIds: [], expectedRevision: 0 }, "theme-reorder-editor")
      );
      expect(reordered.result.changed).toBe(false);
    });

    it("reports committed state and revision when persistence fails", async () => {
      const flush = vi.fn(async () => {
        throw new Error("disk full");
      });
      mountWithThemes({ flush });
      await waitUntilReady();
      const response = await send(
        request(
          "theme.select",
          { themeId: "plvs-light", expectedRevision: 0 },
          "theme-persistence-failure"
        )
      );
      expect(response.error).toMatchObject({
        code: -32030,
        data: {
          reason: "persistenceFailed",
          details: { stateCommitted: true, revision: 1 },
        },
      });
    });
  });

  describe("library transfer", () => {
    const PROFILE_A = { id: "prof-a", name: "EBU R128", referenceLufs: -23, rules: [] };
    const PROFILE_B = { id: "prof-b", name: "ATSC A/85", referenceLufs: -24, rules: [] };

    function themePack(items) {
      return { app: "PLVS", kind: "theme-pack", version: 1, exportedAt: "", items };
    }

    it("lists a library", async () => {
      getAdapter("loudness").append([PROFILE_A, PROFILE_B]);
      mount();
      await waitUntilReady();

      const response = await send(request("loudnessProfile.list", {}, "loudness-list"));

      expect(response.result.profiles).toEqual([
        { id: "prof-a", name: "EBU R128" },
        { id: "prof-b", name: "ATSC A/85" },
      ]);
      expect(response.result.activeId).toBeNull();
    });

    it("reports the active Loudness Profile selection", async () => {
      settingsStore.patch({
        loudnessProfiles: { profiles: [PROFILE_A, PROFILE_B], active: "profile:prof-b" },
      });
      mount();
      await waitUntilReady();

      const response = await send(request("loudnessProfile.list", {}, "loudness-active"));

      expect(response.result.activeId).toBe("prof-b");
    });

    it("lists built-in and custom Themes with current Appearance", async () => {
      seedThemeLibrary([makeTheme("t-1", "Studio")]);
      mount();
      await waitUntilReady();

      const response = await send(request("theme.list", {}, "theme-list"));

      expect(response.result).toMatchObject({
        appearance: { mode: "system", selectedThemeId: null, resolvedThemeId: "plvs-dark" },
        themes: [
          { id: "plvs-dark", name: "Dark", kind: "builtin", colorScheme: "dark" },
          { id: "plvs-light", name: "Light", kind: "builtin", colorScheme: "light" },
          { id: "t-1", name: "Studio", kind: "custom", colorScheme: "dark" },
        ],
      });
    });

    it("exports the whole library", async () => {
      seedThemeLibrary([makeTheme("t-1", "Studio")]);
      mount();
      await waitUntilReady();

      const response = await send(request("theme.export", {}, "theme-export"));

      expect(response.result.pack.kind).toBe("theme-pack");
      expect(response.result.pack.items.map((item) => item.id)).toEqual(["t-1"]);
    });

    it("fails an export naming an id that is not in the library", async () => {
      seedThemeLibrary([makeTheme("t-1", "Studio")]);
      mount();
      await waitUntilReady();

      const response = await send(
        request("theme.export", { ids: ["ghost", "gone"] }, "theme-export-missing")
      );

      expect(response.error).toMatchObject({
        code: -32020,
        data: {
          reason: "themeNotFound",
          path: "$.params.ids",
          details: { missingIds: ["ghost", "gone"] },
        },
      });
    });

    it("rejects built-in Theme export separately from a missing custom Theme", async () => {
      mount();
      await waitUntilReady();
      const response = await send(
        request("theme.export", { ids: ["plvs-dark"] }, "theme-export-builtin")
      );
      expect(response.error).toMatchObject({
        code: -32602,
        data: {
          reason: "themeNotExportable",
          path: "$.params.ids",
          details: { themeIds: ["plvs-dark"] },
        },
      });
    });

    it("imports a pack and reports the plan", async () => {
      const flush = vi.fn(async () => {});
      mount({ flush });
      await waitUntilReady();

      const response = await send(
        request(
          "theme.import",
          { pack: themePack([makeTheme("t-1", "Studio")]), dryRun: false },
          "theme-import"
        )
      );

      expect(response.result.changed).toBe(true);
      expect(response.result.plan.items[0].disposition).toBe("added");
      expect(response.result.state.themes).toEqual([{ id: "t-1", name: "Studio" }]);
      expect(readThemeLibrary()).toEqual([{ id: "t-1", name: "Studio" }]);
      expect(flush).toHaveBeenCalledTimes(1);
    });

    it("increments the revision exactly once for one import", async () => {
      // Two things can move the revision for a single import: a bump in the handler and the
      // library signature effect that fires once the write reaches React. The harness subscribes
      // to `themesStore` the way App.jsx does, so this is the case that measured +2.
      mount();
      await waitUntilReady();
      const before = (await send(request("app.capabilities", {}, "rev-before"))).result.revision;

      await send(
        request(
          "theme.import",
          { pack: themePack([makeTheme("t-1", "Studio")]), expectedRevision: before },
          "rev-import"
        )
      );

      const after = (await send(request("app.capabilities", {}, "rev-after"))).result.revision;
      expect(after).toBe(before + 1);
    });

    it("writes nothing on a dry run", async () => {
      const flush = vi.fn(async () => {});
      mount({ flush });
      await waitUntilReady();
      const revision = (await send(request("app.capabilities", {}, "dry-before"))).result.revision;

      const response = await send(
        request(
          "theme.import",
          {
            pack: themePack([makeTheme("t-1", "Studio")]),
            expectedRevision: revision,
            dryRun: true,
          },
          "theme-import-dry"
        )
      );

      expect(response.result).toMatchObject(goldenResult("mutation.libraryImportDryRun"));
      expect(response.result.revision).toBe(revision);
      expect(readThemeLibrary()).toEqual([]);
      expect(flush).not.toHaveBeenCalled();
    });

    it("treats an import of what is already there as a no-op", async () => {
      const theme = makeTheme("t-1", "Studio");
      seedThemeLibrary([theme]);
      const flush = vi.fn(async () => {});
      mount({ flush });
      await waitUntilReady();
      const revision = (await send(request("app.capabilities", {}, "noop-before"))).result.revision;

      const response = await send(
        request("theme.import", { pack: themePack([theme]), expectedRevision: revision }, "noop")
      );

      expect(response.result.changed).toBe(false);
      expect(response.result.plan.items[0].disposition).toBe("skipped");
      expect(response.result.revision).toBe(revision);
      expect(flush).not.toHaveBeenCalled();
    });

    it("imports a Preset pack through the Preset library", async () => {
      // The Preset family settles on a different watcher from the other two -- `usePresets`
      // re-reads `presetsStore` and the Preset signature effect is what bumps -- so it needs its
      // own coverage or an import there would simply hang until the settlement timed out.
      mount({ presetLibraryFromStore: true, presets: { list: [], activeId: null, dirty: false } });
      await waitUntilReady();

      const response = await send(
        request(
          "preset.import",
          {
            pack: {
              app: "PLVS",
              kind: "preset-pack",
              version: 1,
              exportedAt: "",
              items: [{ id: "p-1", name: "Mix", panelOrder: [], panelsById: {} }],
            },
          },
          "preset-import"
        )
      );

      expect(response.result.changed).toBe(true);
      expect(response.result.state.presets).toEqual([{ id: "p-1", name: "Mix" }]);
    });

    it("imports a Loudness Profile pack through the Loudness library", async () => {
      // The Loudness family settles on the `loudnessProfiles` prop, which `LoudnessProfileContext`
      // feeds from `plvs:settings`. Without a test that reproduces that subscription, removing the
      // watcher's `resolveLibrarySettlement` call leaves the suite green and every import in
      // production hanging until the settlement times out.
      mount({ loudnessProfilesFromStore: true });
      await waitUntilReady();
      const before = (await send(request("app.capabilities", {}, "loudness-import-before"))).result
        .revision;

      const response = await send(
        request(
          "loudnessProfile.import",
          {
            pack: {
              app: "PLVS",
              kind: "loudness-pack",
              version: 1,
              exportedAt: "",
              items: [PROFILE_A],
            },
            expectedRevision: before,
          },
          "loudness-import"
        )
      );

      expect(response.error).toBeUndefined();
      expect(response.result.changed).toBe(true);
      expect(response.result.state.profiles).toEqual([{ id: "prof-a", name: "EBU R128" }]);
      expect(response.result.revision).toBe(before + 1);
    });

    it("settles a Preset import whose only write is a bundled Loudness Profile", async () => {
      // A shared pack re-imported after the recipient deleted the Profile it carries: the Preset is
      // byte-identical to the local one and is skipped, so `presetsStore` is never written and the
      // Preset watcher never fires. Settling on the requested family would time out here and report
      // a successful import as `commitNotObserved`.
      const preset = {
        id: "p-1",
        name: "Mix",
        panelOrder: [],
        panelsById: {},
        loudnessProfileActive: "profile:prof-a",
      };
      presetsStore.patch({ list: [preset] });
      mount({
        presetLibraryFromStore: true,
        loudnessProfilesFromStore: true,
        presets: { list: [], activeId: null, dirty: false },
      });
      await waitUntilReady();
      const before = (await send(request("app.capabilities", {}, "bundled-before"))).result
        .revision;

      const response = await send(
        request(
          "preset.import",
          {
            pack: {
              app: "PLVS",
              kind: "preset-pack",
              version: 1,
              exportedAt: "",
              items: [preset],
              loudnessProfiles: [PROFILE_A],
            },
            expectedRevision: before,
          },
          "bundled-profile-import"
        )
      );

      expect(response.error).toBeUndefined();
      expect(response.result.changed).toBe(true);
      expect(response.result.plan.items[0].disposition).toBe("skipped");
      expect(response.result.plan.loudnessProfiles[0].disposition).toBe("added");
      expect(response.result.revision).toBe(before + 1);
      expect(getAdapter("loudness").list()).toHaveLength(1);
    });

    it("refuses an import that names a stale revision", async () => {
      const flush = vi.fn(async () => {});
      mount({ flush });
      await waitUntilReady();

      const response = await send(
        request(
          "theme.import",
          { pack: themePack([makeTheme("t-1", "Studio")]), expectedRevision: 7 },
          "stale"
        )
      );

      expect(response.error).toMatchObject({
        code: -32004,
        data: {
          reason: "revisionConflict",
          details: { expectedRevision: 7, currentRevision: 0 },
        },
      });
      expect(readThemeLibrary()).toEqual([]);
      // The settlement-timeout rescue below must not widen into a flush on every failure: a
      // refusal that never wrote anything has nothing to persist.
      expect(flush).not.toHaveBeenCalled();
    });

    it("persists an import whose commit is never observed", async () => {
      // The loss this guards: `commit()` writes the library synchronously, but the handler's own
      // `await flush()` sits after the settlement, so a timeout skipped it and the themes were
      // gone at the next launch while the error claimed the state was committed.
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const flush = vi.fn(async () => {});
        // A static library prop, so the signature effect never fires and the settlement never
        // matches -- exactly the shape of the live failure.
        mount({ flush, customThemes: {} });
        await vi.waitFor(() => expect(adapter.ready).toHaveBeenCalledTimes(1));

        act(() =>
          adapter.handler(
            request(
              "theme.import",
              { pack: themePack([makeTheme("t-1", "Studio")]) },
              "import-unobserved"
            )
          )
        );
        await act(async () => {
          await vi.advanceTimersByTimeAsync(6000);
        });

        expect(flush).toHaveBeenCalledTimes(1);
        expect(readThemeLibrary()).toEqual([{ id: "t-1", name: "Studio" }]);
        const response = adapter.responses.find(
          ({ requestId }) => requestId === "import-unobserved"
        );
        expect(response?.error).toMatchObject({
          code: -32031,
          data: {
            reason: "commitNotObserved",
            details: { stateCommitted: true, persisted: true },
          },
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("reports an unobserved commit that could not be persisted either", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const flush = vi.fn(async () => {
          throw new Error("disk full");
        });
        mount({ flush, customThemes: {} });
        await vi.waitFor(() => expect(adapter.ready).toHaveBeenCalledTimes(1));

        act(() =>
          adapter.handler(
            request(
              "theme.import",
              { pack: themePack([makeTheme("t-1", "Studio")]) },
              "import-unpersisted"
            )
          )
        );
        await act(async () => {
          await vi.advanceTimersByTimeAsync(6000);
        });

        const response = adapter.responses.find(
          ({ requestId }) => requestId === "import-unpersisted"
        );
        // Still the unobserved commit: reclassifying it as `persistenceFailed` would hide that
        // React never saw the change. Only the durability claim changes.
        expect(response?.error.code).toBe(-32031);
        expect(response?.error.data.reason).toBe("commitNotObserved");
        expect(response?.error.data.details.persisted).toBe(false);
        expect(response?.error.message).toMatch(/disk full/);
        expect(flush).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not dirty the active preset", async () => {
      // Asserted against the store, not the controlled Preset object `app.inspect` reports: the
      // claim is that the import path wrote no `dirty`, and a `presetsStore.patch` from inside it
      // would never reach that object.
      presetsStore.patch({ list: [], activeId: "preset-1", dirty: false });
      mount({ presets: { list: [], activeId: "preset-1", dirty: false } });
      await waitUntilReady();

      await send(
        request("theme.import", { pack: themePack([makeTheme("t-1", "Studio")]) }, "no-dirty")
      );

      expect(presetsStore.read().dirty).toBe(false);
      const inspection = await send(request("app.inspect", {}, "no-dirty-inspect"));
      expect(inspection.result.preset).toEqual({ activeId: "preset-1", dirty: false });
    });

    it("imports while a blocking editor is open", async () => {
      // Not a scene operation: an append-only merge that moves no selection cannot destroy a
      // draft, and the GUI's Import buttons are not disabled by editor state either. The guard
      // throws if the handler touches it, so calling `assertSceneOperationAllowed` fails this.
      mount({
        assertPresetOperationAllowed: (operation) => {
          throw new SceneOperationBlockedError(operation, ["theme"]);
        },
        agentDockContext: { activeEditors: ["theme"] },
      });
      await waitUntilReady();

      const response = await send(
        request("theme.import", { pack: themePack([makeTheme("t-1", "Studio")]) }, "editor-open")
      );

      expect(response.error).toBeUndefined();
      expect(response.result.changed).toBe(true);
    });

    it("rejects a pack of the wrong kind", async () => {
      mount();
      await waitUntilReady();

      const response = await send(
        request(
          "theme.import",
          { pack: { app: "PLVS", kind: "preset-pack", version: 1, items: [] } },
          "wrong-kind"
        )
      );

      expect(response.error.code).toBe(-32602);
      expect(response.error.data.reason).toBe("invalidPack");
      expect(response.error.message).toMatch(/Presets file/);
      expect(readThemeLibrary()).toEqual([]);
    });

    it("shows an imported theme in the library the editor renders", async () => {
      // The assertion has to be on rendered state: a store read would pass whether or not the
      // write went through the adapters, and it is `notifyLocal` inside them that makes the
      // theme list re-read at all.
      window.matchMedia = vi.fn((query) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));
      mount();
      await waitUntilReady();
      const themes = renderHook(() => useThemeSettings());

      await send(
        request("theme.import", { pack: themePack([makeTheme("t-1", "Studio")]) }, "renders")
      );

      expect(Object.keys(themes.result.current.customThemes)).toContain("t-1");
    });
  });

  describe("Loudness Profile control", () => {
    const PROFILE_A = { id: "prof-a", name: "A", referenceLufs: -23, rules: [] };
    const PROFILE_B = { id: "prof-b", name: "B", referenceLufs: null, rules: [] };
    const DOCUMENT = {
      name: "Broadcast",
      referenceLufs: -24,
      rules: [{ metricId: "truePeak", op: ">", value: -1, severity: "warn" }],
    };

    function seedProfiles(active = "off") {
      settingsStore.patch({ loudnessProfiles: { active, profiles: [PROFILE_A, PROFILE_B] } });
    }

    it("describes a complete normalized Profile", async () => {
      seedProfiles("profile:prof-a");
      mountWithProfiles();
      await waitUntilReady();

      const response = await send(
        request("loudnessProfile.describe", { profileId: "prof-a" }, "profile-describe")
      );
      expect(response.result).toEqual({
        revision: 0,
        profile: PROFILE_A,
        active: true,
        index: 0,
      });
    });

    it("executes select/create/update/rename/reorder/delete with one revision and flush each", async () => {
      seedProfiles();
      presetsStore.patch({
        list: [{ id: "preset-a", loudnessProfileActive: "profile:prof-a" }],
        activeId: "preset-a",
        dirty: false,
      });
      const flush = vi.fn(async () => {});
      mountWithProfiles({ flush });
      await waitUntilReady();

      const selected = await send(
        request(
          "loudnessProfile.select",
          { profileId: "prof-a", expectedRevision: 0 },
          "profile-select"
        )
      );
      expect(selected.result).toMatchObject({
        dryRun: false,
        revision: 1,
        changed: true,
        plan: { from: null, to: "prof-a" },
        state: { activeId: "prof-a" },
      });

      const created = await send(
        request(
          "loudnessProfile.create",
          { document: DOCUMENT, expectedRevision: 1 },
          "profile-create"
        )
      );
      const createdId = created.result.plan.profile.id;
      expect(created.result).toMatchObject({
        revision: 2,
        plan: { document: DOCUMENT, selectCreated: true },
        state: { activeId: createdId },
      });

      const updated = await send(
        request(
          "loudnessProfile.update",
          { profileId: "prof-a", document: DOCUMENT, expectedRevision: 2 },
          "profile-update"
        )
      );
      expect(updated.result).toMatchObject({
        revision: 3,
        plan: { profile: { id: "prof-a", ...DOCUMENT } },
        state: { activeId: createdId },
      });

      const renamed = await send(
        request(
          "loudnessProfile.rename",
          { profileId: "prof-a", name: "  Renamed  ", expectedRevision: 3 },
          "profile-rename"
        )
      );
      expect(renamed.result).toMatchObject({
        revision: 4,
        plan: { profile: { id: "prof-a", name: "Renamed" } },
      });

      const reordered = await send(
        request(
          "loudnessProfile.reorder",
          { profileIds: [createdId, "prof-b", "prof-a"], expectedRevision: 4 },
          "profile-reorder"
        )
      );
      expect(reordered.result).toMatchObject({
        revision: 5,
        plan: { profileIds: [createdId, "prof-b", "prof-a"] },
      });

      const deleted = await send(
        request(
          "loudnessProfile.delete",
          { profileId: "prof-a", expectedRevision: 5 },
          "profile-delete"
        )
      );
      expect(deleted.result).toMatchObject({
        revision: 6,
        plan: {
          deletedProfile: { id: "prof-a", name: "Renamed" },
          selectionFallsBackToOff: false,
          affectedPresetIds: ["preset-a"],
        },
      });
      expect(presetsStore.read().list[0].loudnessProfileActive).toBe("off");
      expect(flush).toHaveBeenCalledTimes(6);
    });

    it("dry-runs and no-ops without allocation, mutation, revision, or persistence", async () => {
      seedProfiles("profile:prof-a");
      const flush = vi.fn(async () => {});
      mountWithProfiles({ flush });
      await waitUntilReady();
      const before = structuredClone(settingsStore.read());

      const dryRun = await send(
        request(
          "loudnessProfile.create",
          { document: DOCUMENT, expectedRevision: 0, dryRun: true },
          "profile-create-dry"
        )
      );
      expect(dryRun.result).toMatchObject({
        dryRun: true,
        revision: 0,
        changed: true,
        plan: { document: DOCUMENT, selectCreated: true },
      });
      expect(dryRun.result.plan).not.toHaveProperty("profile");

      const noOp = await send(
        request(
          "loudnessProfile.select",
          { profileId: "prof-a", expectedRevision: 0 },
          "profile-select-noop"
        )
      );
      expect(noOp.result).toMatchObject({ changed: false, revision: 0 });
      expect(settingsStore.read()).toEqual(before);
      expect(flush).not.toHaveBeenCalled();
    });

    it("dry-runs every mutation through its real planner without changing either store", async () => {
      seedProfiles();
      presetsStore.patch({
        list: [{ id: "preset-a", loudnessProfileActive: "profile:prof-a" }],
        activeId: "preset-a",
        dirty: false,
      });
      const flush = vi.fn(async () => {});
      mountWithProfiles({ flush });
      await waitUntilReady();
      const settingsBefore = structuredClone(settingsStore.read());
      const presetsBefore = structuredClone(presetsStore.read());
      const cases = [
        ["loudnessProfile.select", { profileId: "prof-a" }],
        ["loudnessProfile.create", { document: DOCUMENT }],
        ["loudnessProfile.update", { profileId: "prof-a", document: DOCUMENT }],
        ["loudnessProfile.rename", { profileId: "prof-a", name: "Renamed" }],
        ["loudnessProfile.delete", { profileId: "prof-a" }],
        ["loudnessProfile.reorder", { profileIds: ["prof-b", "prof-a"] }],
      ];

      for (const [method, params] of cases) {
        const response = await send(
          request(method, { ...params, expectedRevision: 0, dryRun: true }, `dry-${method}`)
        );
        expect(response.result).toMatchObject({
          dryRun: true,
          revision: 0,
          changed: true,
          warnings: [],
          plan: expect.any(Object),
          state: { profiles: expect.any(Array) },
        });
      }
      expect(settingsStore.read()).toEqual(settingsBefore);
      expect(presetsStore.read()).toEqual(presetsBefore);
      expect(flush).not.toHaveBeenCalled();
    });

    it("detects normalized select, update, rename, and reorder no-ops", async () => {
      seedProfiles("profile:prof-a");
      const flush = vi.fn(async () => {});
      mountWithProfiles({ flush });
      await waitUntilReady();
      for (const [method, params] of [
        ["loudnessProfile.select", { profileId: "prof-a" }],
        [
          "loudnessProfile.update",
          {
            profileId: "prof-a",
            document: { name: " A ", referenceLufs: -23, rules: [] },
          },
        ],
        ["loudnessProfile.rename", { profileId: "prof-a", name: " A " }],
        ["loudnessProfile.reorder", { profileIds: ["prof-a", "prof-b"] }],
      ]) {
        const response = await send(
          request(method, { ...params, expectedRevision: 0 }, `noop-${method}`)
        );
        expect(response.result).toMatchObject({ dryRun: false, changed: false, revision: 0 });
      }
      expect(flush).not.toHaveBeenCalled();
    });

    it("rejects a stale revision before planning every mutation", async () => {
      seedProfiles();
      const settingsBefore = structuredClone(settingsStore.read());
      mountWithProfiles();
      await waitUntilReady();
      for (const [method, params] of [
        ["loudnessProfile.select", { profileId: "prof-a" }],
        ["loudnessProfile.create", { document: DOCUMENT }],
        ["loudnessProfile.update", { profileId: "prof-a", document: DOCUMENT }],
        ["loudnessProfile.rename", { profileId: "prof-a", name: "Renamed" }],
        ["loudnessProfile.delete", { profileId: "prof-a" }],
        ["loudnessProfile.reorder", { profileIds: ["prof-b", "prof-a"] }],
      ]) {
        const response = await send(
          request(method, { ...params, expectedRevision: 9 }, `stale-${method}`)
        );
        expect(response.error.data.reason).toBe("revisionConflict");
      }
      expect(settingsStore.read()).toEqual(settingsBefore);
    });

    it("maps validation, missing target, permutation, and stale revision failures", async () => {
      seedProfiles();
      mountWithProfiles();
      await waitUntilReady();
      const invalid = await send(
        request(
          "loudnessProfile.create",
          { document: { name: "", referenceLufs: 4, rules: [] }, expectedRevision: 0 },
          "profile-invalid"
        )
      );
      expect(invalid.error.data).toMatchObject({
        reason: "invalidProfile",
        details: { issues: expect.any(Array) },
      });
      const missing = await send(
        request(
          "loudnessProfile.delete",
          { profileId: "missing", expectedRevision: 0 },
          "profile-missing"
        )
      );
      expect(missing.error.data.reason).toBe("loudnessProfileNotFound");
      const permutation = await send(
        request(
          "loudnessProfile.reorder",
          { profileIds: ["prof-a"], expectedRevision: 0 },
          "profile-permutation"
        )
      );
      expect(permutation.error.data.reason).toBe("invalidPermutation");
      const stale = await send(
        request(
          "loudnessProfile.select",
          { profileId: "off", expectedRevision: 9 },
          "profile-stale"
        )
      );
      expect(stale.error.data.reason).toBe("revisionConflict");
    });

    it("refuses blocked mutations before Settings or Presets change while allowing reorder", async () => {
      seedProfiles();
      presetsStore.patch({ list: [], activeId: null, dirty: false });
      const view = mountWithProfiles();
      await waitUntilReady();
      act(() => view.profile.beginEdit("prof-a"));
      const settingsBefore = structuredClone(settingsStore.read());
      const presetsBefore = structuredClone(presetsStore.read());

      for (const [method, params] of [
        ["loudnessProfile.select", { profileId: "prof-a" }],
        ["loudnessProfile.create", { document: DOCUMENT }],
        ["loudnessProfile.update", { profileId: "prof-a", document: DOCUMENT }],
        ["loudnessProfile.rename", { profileId: "prof-a", name: "Name" }],
        ["loudnessProfile.delete", { profileId: "prof-a" }],
      ]) {
        const response = await send(
          request(method, { ...params, expectedRevision: 0 }, `blocked-${method}`)
        );
        expect(response.error.data).toMatchObject({
          reason: "editorActive",
          details: { editors: ["loudnessProfile"] },
        });
        expect(settingsStore.read()).toEqual(settingsBefore);
        expect(presetsStore.read()).toEqual(presetsBefore);
      }

      const reorder = await send(
        request(
          "loudnessProfile.reorder",
          { profileIds: ["prof-b", "prof-a"], expectedRevision: 0 },
          "blocked-reorder"
        )
      );
      expect(reorder.result.changed).toBe(true);
      expect(view.profile.draft).not.toBe(null);
    });

    it("reports persistence failure after a committed Profile mutation", async () => {
      seedProfiles();
      const flush = vi.fn(async () => {
        throw new Error("disk full");
      });
      mountWithProfiles({ flush });
      await waitUntilReady();

      const response = await send(
        request(
          "loudnessProfile.rename",
          { profileId: "prof-a", name: "Renamed", expectedRevision: 0 },
          "profile-persistence"
        )
      );
      expect(response.error).toMatchObject({
        data: {
          reason: "persistenceFailed",
          details: { stateCommitted: true, revision: 1 },
        },
      });
      expect(settingsStore.read().loudnessProfiles.profiles[0].name).toBe("Renamed");
    });

    it.each([
      ["select", "loudnessProfile.select", { profileId: "prof-a" }],
      ["create", "loudnessProfile.create", { document: DOCUMENT }],
      ["update", "loudnessProfile.update", { profileId: "prof-a", document: DOCUMENT }],
      ["rename", "loudnessProfile.rename", { profileId: "prof-a", name: "Renamed" }],
      ["delete", "loudnessProfile.delete", { profileId: "prof-a" }],
      ["reorder", "loudnessProfile.reorder", { profileIds: ["prof-b", "prof-a"] }],
    ])("reports committed revision when %s persistence fails", async (_name, method, params) => {
      seedProfiles();
      presetsStore.patch({ list: [], activeId: "preset-a", dirty: false });
      const flush = vi.fn(async () => {
        throw new Error("disk full");
      });
      mountWithProfiles({ flush });
      await waitUntilReady();

      const response = await send(
        request(method, { ...params, expectedRevision: 0 }, `flush-${method}`)
      );
      expect(response.error).toMatchObject({
        data: {
          reason: "persistenceFailed",
          details: { stateCommitted: true, revision: 1 },
        },
      });
    });
  });
});

describe("File analysis report", () => {
  const completeSession = {
    id: "file-analysis-1757548800000-k3j9x2",
    path: "C:\\audio\\mix.wav",
    fileName: "mix.wav",
    state: "complete",
    progress: 1,
    probe: {
      path: "C:\\audio\\mix.wav",
      fileName: "mix.wav",
      container: "wav",
      durationMs: 12000,
      selectedTrack: {
        index: 0,
        codec: "pcm_s16le",
        sampleRateHz: 48000,
        channels: 2,
        language: null,
      },
    },
    summary: {
      durationMs: 12000,
      sampleRateHz: 48000,
      channels: 2,
      integratedLufs: -23.1,
      lra: 4.2,
      mMaxLufs: -18,
      stMaxLufs: -20.5,
      truePeakMaxDbtp: -1.2,
      samplePeakMaxLDb: -1.5,
      samplePeakMaxRDb: -1.75,
      dialogueIntegrated: null,
      dialogueLra: 0,
    },
    createdAt: 1757548790000,
    analyzedAt: 1757548800000,
    decodedFrames: 576000,
    historyTruncated: false,
    historyCoveredMs: null,
    analysisSettings: { dialogue: { enabled: false } },
    error: null,
  };
  const reportTransport = (sessions) => ({
    ...transport,
    source: "file",
    files: { activeId: sessions[0]?.id ?? null, analyzingId: null, sessions },
  });

  it("returns the GUI export document for a completed session without changing state", async () => {
    const snapshot = reportTransport([completeSession]);
    mount({ agentTransport: snapshot });
    await waitUntilReady();

    const response = await send(
      request("transport.file.report", { sessionId: completeSession.id }, "file-report")
    );

    expect(response.result).toEqual({
      revision: 0,
      sessionId: completeSession.id,
      report: buildFileAnalysisReport(
        { ...completeSession, metadata: completeSession.probe },
        { appVersion: runtime.appVersion, exportedAt: response.result.report.exportedAt }
      ),
    });
    expect(response.result.report).toMatchObject({
      schemaVersion: 1,
      reportType: "fileAnalysis",
      app: { version: runtime.appVersion },
      source: { fileName: "mix.wav", container: "wav" },
      summary: { integratedLufs: -23.1, samplePeakMaxDb: -1.5 },
    });
    const after = await send(request("transport.inspect", {}, "file-report-after"));
    expect(after.result).toEqual({ revision: 0, ...snapshot });
  });

  it("reports an unknown session as fileSessionNotFound", async () => {
    mount({ agentTransport: reportTransport([completeSession]) });
    await waitUntilReady();

    const response = await send(
      request("transport.file.report", { sessionId: "missing" }, "file-report-missing")
    );

    expect(response.error).toMatchObject({
      code: -32080,
      data: { reason: "fileSessionNotFound", details: { sessionId: "missing" } },
    });
  });

  it.each(["probing", "analyzing", "stopped", "error"])(
    "refuses a %s session with fileAnalysisNotComplete",
    async (state) => {
      const session = { ...completeSession, state };
      mount({ agentTransport: reportTransport([session]) });
      await waitUntilReady();

      const response = await send(
        request("transport.file.report", { sessionId: session.id }, `file-report-${state}`)
      );

      expect(response.error).toMatchObject({
        code: -32085,
        data: {
          reason: "fileAnalysisNotComplete",
          details: { sessionId: session.id, state },
        },
      });
      const after = await send(request("transport.inspect", {}, `file-report-${state}-after`));
      expect(after.result.revision).toBe(0);
    }
  );
});
