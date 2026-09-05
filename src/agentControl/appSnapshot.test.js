import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
import {
  buildAgentControlCapabilities,
  buildAgentControlSnapshot,
  readAgentControlRuntime,
} from "./appSnapshot.js";

const runtime = {
  available: true,
  appName: "PLVS Dev",
  appVersion: "0.14.5",
  identifier: "com.soundoer.plvs.dev",
  platform: "windows",
};

describe("agent-control app snapshots", () => {
  afterEach(() => {
    if (globalThis.window) delete globalThis.window.__PLVS_INITIAL_STATE__;
  });

  it("reports deterministic runtime and module capabilities", () => {
    const capabilities = buildAgentControlCapabilities(runtime);
    expect(capabilities).toMatchObject({
      protocolVersion: 1,
      runtime,
      methods: [
        "app.capabilities",
        "app.inspect",
        "workspace.applyLayout",
        "axis.describe",
        "axis.inspect",
        "axis.shared.update",
        "axis.shared.reset",
        "axis.panel.update",
        "axis.panel.reset",
        "panel.describe",
        "panel.update",
        "panel.reset",
        "preset.list",
        "preset.describe",
        "preset.rename",
        "preset.delete",
        "preset.reorder",
        "preset.save",
        "preset.update",
        "preset.apply",
        "settings.describe",
        "settings.inspect",
        "settings.update",
        "app.wait",
        "transport.inspect",
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
        "dock.describe",
        "dock.inspect",
        "dock.enter",
        "dock.exit",
        "dock.layout.apply",
        "dock.panel.describe",
        "dock.panel.update",
        "dock.panel.reset",
      ],
    });
    expect(capabilities.modules.map(({ moduleId }) => moduleId)).toContain("stereo-map");
    expect(JSON.parse(JSON.stringify(capabilities))).toEqual(capabilities);
  });

  it("builds a compact inspect snapshot without raw or transient runtime data", () => {
    const workspace = {
      ...DEFAULT_WORKSPACE_STATE,
      history: { rows: [1, 2, 3] },
      audioFrame: { seq: 99 },
      reactOnly: () => {},
    };
    const snapshot = buildAgentControlSnapshot({
      runtime,
      revision: 7,
      presetsRevision: 3,
      settingsRevision: 4,
      workspace,
      presets: { activeId: "p1", dirty: true, list: [{ id: "p1", name: "Mix" }] },
      settings: { interfaceSize: "large" },
      transport: { source: "live", live: { state: "stopped" }, files: { sessions: [] } },
      dock: { supported: true, enabled: false, panels: [] },
      analysisContext: {
        channelCount: 2,
        dialogueDetectionActive: true,
        spectralWaveformActive: false,
      },
    });

    expect(snapshot).toMatchObject({
      app: {
        name: "PLVS Dev",
        version: "0.14.5",
        identifier: "com.soundoer.plvs.dev",
        platform: "windows",
      },
      protocolVersion: 1,
      revisions: { workspace: 7, presets: 3, settings: 4 },
      runtime: {
        channelTopology: { status: "detected", channelCount: 2 },
        dialogueDetection: "active",
        spectralWaveform: "notRequested",
      },
      preset: { activeId: "p1", dirty: true },
      settings: { interfaceSize: "large" },
      transport: { source: "live", live: { state: "stopped" }, files: { sessions: [] } },
      dock: { supported: true, enabled: false, panels: [] },
    });
    expect(snapshot).not.toHaveProperty("revision");
    expect(snapshot.workspace.panels[0]).toEqual({
      id: "levelMeter",
      moduleId: "levelMeter",
      title: "Level Meter",
      controls: {
        mode: "peak",
        playbackMax: false,
        floatingValue: false,
        tpMaxMarker: false,
        levelRangeDbfs: { min: -60, max: 3 },
        loudnessRangeLufs: { min: -64, max: 0 },
      },
      axes: {},
      analysis: {},
    });
    expect(snapshot.workspace.panels.find(({ id }) => id === "spectrum").axes).toEqual({
      frequency: {
        linked: true,
        source: "workspace",
        writable: true,
        range: { minHz: 20, maxHz: 20000 },
      },
    });
    expect(snapshot.workspace.panels.find(({ id }) => id === "spectrum").analysis).toEqual({
      status: "active",
    });
    expect(snapshot.workspace.layout.type).toBe("split");
    const encoded = JSON.stringify(snapshot);
    expect(encoded).not.toMatch(/history|audioFrame|reactOnly|config|fullscreen/);
    expect(JSON.parse(encoded)).toEqual(snapshot);
  });

  it("reports the live enabled flag alongside platform availability", () => {
    globalThis.window = globalThis.window || {};
    globalThis.window.__PLVS_INITIAL_STATE__ = {
      agentControl: {
        available: true,
        enabled: false,
        appName: "PLVS",
        appVersion: "0.0.0",
        identifier: "com.soundoer.plvs",
        platform: "windows",
      },
    };
    expect(readAgentControlRuntime()).toMatchObject({ available: true, enabled: false });
  });
});
