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
      methods: ["app.capabilities", "app.inspect", "workspace.applyLayout"],
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
    });

    expect(snapshot).toMatchObject({
      app: {
        name: "PLVS Dev",
        version: "0.14.5",
        identifier: "com.soundoer.plvs.dev",
        platform: "windows",
      },
      protocolVersion: 1,
      revision: 7,
      preset: { activeId: "p1", dirty: true },
    });
    expect(snapshot.workspace.panels[0]).toMatchObject({
      panelId: "levelMeter",
      moduleId: "levelMeter",
      title: "Level Meter",
    });
    expect(snapshot.workspace.layout.type).toBe("split");
    const encoded = JSON.stringify(snapshot);
    expect(encoded).not.toMatch(/history|audioFrame|reactOnly|controls|config|fullscreen/);
    expect(JSON.parse(encoded)).toEqual(snapshot);
  });
});
