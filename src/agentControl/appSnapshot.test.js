import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
import { buildAgentControlCapabilities, buildAgentControlSnapshot } from "./appSnapshot.js";

const runtime = {
  available: true,
  appName: "PLVS Dev",
  appVersion: "0.14.5",
  identifier: "com.soundoer.plvs.dev",
  platform: "windows",
};

describe("agent-control app snapshots", () => {
  it("reports deterministic runtime and module capabilities", () => {
    const capabilities = buildAgentControlCapabilities(runtime);
    expect(capabilities).toMatchObject({
      protocolVersion: 1,
      runtime,
      methods: ["app.capabilities", "app.inspect", "workspace.applyLayout", "panel.update"],
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
      workspace,
      presets: { activeId: "p1", dirty: true, list: [{ id: "p1", name: "Mix" }] },
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
      revisions: { workspace: 7 },
      runtime: {
        channelTopology: { status: "detected", channelCount: 2 },
        dialogueDetection: "active",
        spectralWaveform: "notRequested",
      },
      preset: { activeId: "p1", dirty: true },
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
        writable: false,
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
});
