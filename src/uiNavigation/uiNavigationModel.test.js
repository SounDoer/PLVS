import { describe, expect, it } from "vitest";
import {
  UI_NAVIGATION_ERROR_CODES,
  UI_SETTINGS_SECTIONS,
  UI_SURFACE_ACTIONS,
  UI_SURFACE_KINDS,
  UI_SURFACE_ORIGINS,
  createUiNavigationError,
  createUiSurfaceId,
  createUiNavigationState,
  mountUiSurface,
  projectUiInspection,
  unmountUiSurface,
} from "./uiNavigationModel.js";

describe("UI Navigation state", () => {
  it("publishes the stable semantic vocabulary", () => {
    expect(UI_SETTINGS_SECTIONS).toEqual([
      "behavior",
      "shortcuts",
      "appearance",
      "analysis",
      "channels",
      "transfer",
      "agent-control",
      "about",
    ]);
    expect(UI_SURFACE_ORIGINS).toEqual(["navigable", "event", "nested"]);
    expect(UI_SURFACE_ACTIONS).toEqual(["close", "cancel"]);
    expect(UI_SURFACE_KINDS).toEqual(
      expect.arrayContaining(["settings", "panelSettings", "update", "crashReport"])
    );
    expect(UI_NAVIGATION_ERROR_CODES).toEqual([
      "uiGenerationConflict",
      "uiSurfaceNotFound",
      "uiTargetNotFound",
      "uiTargetNotVisible",
      "surfaceUnavailable",
      "uiActionUnavailable",
      "uiConflict",
      "uiBusy",
      "editorActive",
      "uiNotSettled",
    ]);
  });

  it("creates bounded opaque IDs without accepting semantic target input", () => {
    const entropy = [
      "0199f00d-1111-7000-8000-000000000001",
      "0199f00d-1111-7000-8000-000000000002",
    ];

    const first = createUiSurfaceId(() => entropy.shift());
    const second = createUiSurfaceId(() => entropy.shift());

    expect(first).toMatch(/^ui-[a-z0-9-]+$/);
    expect(first.length).toBeLessThanOrEqual(64);
    expect(second).not.toBe(first);
  });

  it("creates stable errors without copying private or unbounded details", () => {
    const error = createUiNavigationError("uiGenerationConflict", {
      expectedUiGeneration: 4,
      currentUiGeneration: 5,
      feedbackText: "do not expose this",
      candidates: Array.from({ length: 30 }, (_, index) => `surface-${index}`),
    });

    expect(error).toMatchObject({
      reason: "uiGenerationConflict",
      message: "The visible UI changed after it was inspected.",
      details: { expectedUiGeneration: 4, currentUiGeneration: 5 },
    });
    expect(JSON.stringify(error)).not.toContain("do not expose this");
  });

  it("reports bounded blocking editor identities without draft content", () => {
    const error = createUiNavigationError("editorActive", {
      editors: ["theme", "loudnessProfile"],
      document: { name: "private" },
    });
    expect(error).toMatchObject({
      reason: "editorActive",
      details: { editors: ["theme", "loudnessProfile"] },
    });
    expect(JSON.stringify(error)).not.toContain("private");
  });

  it("publishes the first mounted surface at generation one", () => {
    const initial = createUiNavigationState();
    const state = mountUiSurface(initial, {
      surfaceId: "ui-opaque-lifetime-1",
      kind: "settings",
      origin: "navigable",
      blocking: false,
      dirty: false,
      dismissible: true,
      supportedActions: ["close"],
      target: { section: "appearance" },
    });

    expect(
      projectUiInspection(state, {
        workbench: {
          instanceId: "instance-1",
          workspaceId: "workspace-1",
          displayName: "Studio",
        },
        window: { form: "normal", visible: true },
        activeBlockingEditors: [],
      })
    ).toEqual({
      uiGeneration: 1,
      workbench: {
        instanceId: "instance-1",
        workspaceId: "workspace-1",
        displayName: "Studio",
      },
      window: { form: "normal", visible: true },
      activeBlockingEditors: [],
      topSurfaceId: "ui-opaque-lifetime-1",
      surfaces: [
        {
          surfaceId: "ui-opaque-lifetime-1",
          kind: "settings",
          origin: "navigable",
          blocking: false,
          dirty: false,
          dismissible: true,
          supportedActions: ["close"],
          target: { section: "appearance" },
        },
      ],
    });
  });

  it("does not advance generation for an identical repeated observation", () => {
    const surface = {
      surfaceId: "ui-opaque-lifetime-1",
      kind: "settings",
      origin: "navigable",
      blocking: false,
      dirty: false,
      dismissible: true,
      supportedActions: ["close"],
      target: { section: "appearance" },
    };
    const mounted = mountUiSurface(createUiNavigationState(), surface);

    const repeated = mountUiSurface(mounted, {
      ...surface,
      supportedActions: [...surface.supportedActions],
      target: { ...surface.target },
    });

    expect(repeated).toBe(mounted);
    expect(repeated.uiGeneration).toBe(1);
  });

  it("advances once when the exact surface lifetime unmounts", () => {
    const mounted = mountUiSurface(createUiNavigationState(), {
      surfaceId: "ui-opaque-lifetime-1",
      kind: "settings",
      origin: "navigable",
      blocking: false,
      dirty: false,
      dismissible: true,
      supportedActions: ["close"],
      target: { section: "appearance" },
    });

    const unmounted = unmountUiSurface(mounted, "ui-opaque-lifetime-1");
    const repeated = unmountUiSurface(unmounted, "ui-opaque-lifetime-1");

    expect(unmounted).toEqual({ uiGeneration: 2, surfaces: [] });
    expect(repeated).toBe(unmounted);
  });

  it("ignores volatile observations but advances for a semantic target change", () => {
    const initial = createUiNavigationState();
    const mounted = mountUiSurface(initial, {
      surfaceId: "ui-opaque-lifetime-1",
      kind: "settings",
      origin: "navigable",
      blocking: false,
      dirty: false,
      dismissible: true,
      supportedActions: ["close"],
      pointer: { x: 10, y: 20 },
      progress: 0.1,
      target: { section: "appearance", scrollTop: 120, typedValue: "private" },
    });
    const noisyRepeat = mountUiSurface(mounted, {
      surfaceId: "ui-opaque-lifetime-1",
      kind: "settings",
      origin: "navigable",
      blocking: false,
      dirty: false,
      dismissible: true,
      supportedActions: ["close"],
      pointer: { x: 90, y: 70 },
      progress: 0.8,
      target: { section: "appearance", scrollTop: 400, typedValue: "changed" },
    });
    const retargeted = mountUiSurface(noisyRepeat, {
      surfaceId: "ui-opaque-lifetime-1",
      kind: "settings",
      origin: "navigable",
      blocking: false,
      dirty: false,
      dismissible: true,
      supportedActions: ["close"],
      target: { section: "analysis" },
    });

    expect(noisyRepeat).toBe(mounted);
    expect(retargeted.uiGeneration).toBe(2);
    expect(retargeted.surfaces[0]).toEqual({
      surfaceId: "ui-opaque-lifetime-1",
      kind: "settings",
      origin: "navigable",
      blocking: false,
      dirty: false,
      dismissible: true,
      supportedActions: ["close"],
      target: { section: "analysis" },
    });
  });

  it("projects real event decisions without exposing content or unsafe actions", () => {
    const state = mountUiSurface(createUiNavigationState(), {
      surfaceId: "ui-event-lifetime-1",
      kind: "crashReport",
      origin: "event",
      blocking: true,
      dirty: true,
      dismissible: true,
      supportedActions: ["cancel", "confirm", "send"],
      target: {
        phase: "review",
        reportBody: "private crash report",
        email: "person@example.com",
      },
    });

    expect(state.surfaces[0]).toEqual({
      surfaceId: "ui-event-lifetime-1",
      kind: "crashReport",
      origin: "event",
      blocking: true,
      dirty: true,
      dismissible: true,
      supportedActions: ["cancel"],
      target: { phase: "review" },
    });
    expect(JSON.stringify(state)).not.toContain("private crash report");
    expect(JSON.stringify(state)).not.toContain("person@example.com");
  });

  it("rejects descriptors outside the stable semantic vocabulary", () => {
    expect(() =>
      mountUiSurface(createUiNavigationState(), {
        surfaceId: "ui-opaque-lifetime-1",
        kind: "domDialog",
        origin: "selector",
        supportedActions: ["click"],
      })
    ).toThrow("UI surface kind is invalid.");
  });

  it("keeps published state immutable so generation cannot be bypassed", () => {
    const state = mountUiSurface(createUiNavigationState(), {
      surfaceId: "ui-opaque-lifetime-1",
      kind: "settings",
      origin: "navigable",
      blocking: false,
      dismissible: true,
      supportedActions: ["close"],
      target: { section: "appearance" },
    });

    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.surfaces)).toBe(true);
    expect(Object.isFrozen(state.surfaces[0])).toBe(true);
    expect(Object.isFrozen(state.surfaces[0].target)).toBe(true);
  });
});
