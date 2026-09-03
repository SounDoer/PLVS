/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { migrateDialogueVadEngine } from "./migrateDialogueVadEngine.js";
import { settingsStore, workspaceStore } from "./index.js";

function workspaceWith(panels) {
  return {
    tree: { type: "leaf", panelId: panels[0]?.id ?? "p1" },
    panelOrder: panels.map((panel) => panel.id),
    panelsById: Object.fromEntries(
      panels.map((panel) => [panel.id, { id: panel.id, moduleId: panel.moduleId }])
    ),
    panelControlsById: Object.fromEntries(
      panels
        .filter((panel) => panel.engine !== undefined)
        .map((panel) => [panel.id, { dialogueVadEngine: panel.engine }])
    ),
  };
}

beforeEach(() => {
  settingsStore.reset();
  workspaceStore.reset();
});

describe("migrateDialogueVadEngine", () => {
  it("lifts the first Stats panel's engine into settings", () => {
    workspaceStore.patch(workspaceWith([{ id: "p1", moduleId: "stats", engine: "ten" }]));
    migrateDialogueVadEngine();
    expect(settingsStore.read().dialogueVadEngine).toBe("ten");
  });

  it("takes the first Stats panel in panelOrder when they disagree", () => {
    workspaceStore.patch(
      workspaceWith([
        { id: "p1", moduleId: "spectrum" },
        { id: "p2", moduleId: "stats", engine: "silero" },
        { id: "p3", moduleId: "stats", engine: "ten" },
      ])
    );
    migrateDialogueVadEngine();
    expect(settingsStore.read().dialogueVadEngine).toBe("silero");
  });

  it("writes nothing when there is no Stats panel", () => {
    workspaceStore.patch(workspaceWith([{ id: "p1", moduleId: "spectrum" }]));
    migrateDialogueVadEngine();
    expect(settingsStore.read().dialogueVadEngine).toBeUndefined();
  });

  it("writes nothing when the Stats panel carries no engine", () => {
    workspaceStore.patch(workspaceWith([{ id: "p1", moduleId: "stats" }]));
    migrateDialogueVadEngine();
    expect(settingsStore.read().dialogueVadEngine).toBeUndefined();
  });

  it("leaves an existing settings value alone", () => {
    settingsStore.patch({ dialogueVadEngine: "silero" });
    workspaceStore.patch(workspaceWith([{ id: "p1", moduleId: "stats", engine: "ten" }]));
    migrateDialogueVadEngine();
    expect(settingsStore.read().dialogueVadEngine).toBe("silero");
  });

  it("repairs an unknown stored engine to the default", () => {
    workspaceStore.patch(workspaceWith([{ id: "p1", moduleId: "stats", engine: "nonsense" }]));
    migrateDialogueVadEngine();
    expect(settingsStore.read().dialogueVadEngine).toBe("firered");
  });

  it("is a no-op on a second run", () => {
    workspaceStore.patch(workspaceWith([{ id: "p1", moduleId: "stats", engine: "ten" }]));
    migrateDialogueVadEngine();
    settingsStore.patch({ dialogueVadEngine: "silero" });
    migrateDialogueVadEngine();
    expect(settingsStore.read().dialogueVadEngine).toBe("silero");
  });

  it("survives a workspace with no panelOrder", () => {
    workspaceStore.patch({ tree: null });
    expect(() => migrateDialogueVadEngine()).not.toThrow();
    expect(settingsStore.read().dialogueVadEngine).toBeUndefined();
  });

  it("skips a dangling panelOrder id and an orphaned panelControlsById entry", () => {
    workspaceStore.patch({
      tree: { type: "leaf", panelId: "p2" },
      panelOrder: ["ghost", "p2"],
      panelsById: {
        p2: { id: "p2", moduleId: "stats" },
      },
      panelControlsById: {
        orphan: { dialogueVadEngine: "silero" },
        p2: { dialogueVadEngine: "ten" },
      },
    });
    expect(() => migrateDialogueVadEngine()).not.toThrow();
    expect(settingsStore.read().dialogueVadEngine).toBe("ten");
  });
});
