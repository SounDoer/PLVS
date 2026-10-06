/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { BlockingEditorsProvider, useBlockingEditor } from "../hooks/BlockingEditorsContext.jsx";
import {
  UiNavigationProvider,
  useUiNavigation,
  useUiNavigationEnvironment,
  useUiNavigationTarget,
  useUiSurface,
} from "./UiNavigationContext.jsx";

afterEach(() => {
  delete window.__PLVS_INITIAL_STATE__;
});

function wrapper({ children }) {
  return (
    <BlockingEditorsProvider>
      <UiNavigationProvider
        displayName="Studio"
        windowForm="normal"
        windowVisible
        getRevision={() => 7}
      >
        {children}
      </UiNavigationProvider>
    </BlockingEditorsProvider>
  );
}

function shortSettlementWrapper({ children }) {
  return (
    <BlockingEditorsProvider>
      <UiNavigationProvider getRevision={() => 7} settlementTimeoutMs={10}>
        {children}
      </UiNavigationProvider>
    </BlockingEditorsProvider>
  );
}

describe("UiNavigationProvider", () => {
  it("fails loudly when a command consumer is outside the provider", () => {
    expect(() => renderHook(() => useUiNavigation())).toThrow(/UiNavigationProvider/);
  });

  it("inspects the selected workbench before any surface is registered", () => {
    window.__PLVS_INITIAL_STATE__ = {
      instanceId: "instance-1",
      workspaceId: "workspace-1",
    };

    const { result } = renderHook(() => useUiNavigation(), { wrapper });

    expect(result.current.uiGeneration).toBe(0);
    expect(result.current.inspectUi()).toEqual({
      uiGeneration: 0,
      workbench: {
        instanceId: "instance-1",
        workspaceId: "workspace-1",
        displayName: "Studio",
      },
      window: { form: "normal", visible: true },
      activeBlockingEditors: [],
      topSurfaceId: null,
      surfaces: [],
    });
  });

  it("tracks the live window form and visibility owned by the app", () => {
    const { result, rerender } = renderHook(
      ({ form, visible }) => {
        useUiNavigationEnvironment({ windowForm: form, windowVisible: visible });
        return useUiNavigation();
      },
      { wrapper, initialProps: { form: "normal", visible: true } }
    );

    rerender({ form: "dock", visible: false });

    expect(result.current.inspectUi().window).toEqual({ form: "dock", visible: false });
  });

  it("publishes a mounted semantic surface through inspection", () => {
    const { result } = renderHook(
      () => {
        const surfaceId = useUiSurface({
          active: true,
          kind: "settings",
          origin: "navigable",
          blocking: false,
          dismissible: true,
          supportedActions: ["close"],
          target: { section: "appearance" },
        });
        return { navigation: useUiNavigation(), surfaceId };
      },
      { wrapper }
    );

    expect(result.current.surfaceId).toMatch(/^ui-/);
    expect(result.current.navigation.inspectUi()).toMatchObject({
      uiGeneration: 1,
      topSurfaceId: result.current.surfaceId,
      surfaces: [
        {
          surfaceId: result.current.surfaceId,
          kind: "settings",
          target: { section: "appearance" },
        },
      ],
    });
  });

  it("keeps a previously captured inspection function on the current surface state", () => {
    const { result, rerender } = renderHook(
      ({ active }) => {
        useUiSurface({
          active,
          kind: "settings",
          origin: "navigable",
          blocking: false,
          dismissible: true,
          supportedActions: ["close"],
          target: { section: "appearance" },
        });
        return useUiNavigation();
      },
      { wrapper, initialProps: { active: false } }
    );
    const inspectBeforeMount = result.current.inspectUi;

    rerender({ active: true });

    expect(inspectBeforeMount()).toMatchObject({
      uiGeneration: 1,
      surfaces: [{ kind: "settings", target: { section: "appearance" } }],
    });
  });

  it("closes only the exact mounted surface through its visible Close intent", async () => {
    const onClose = vi.fn();
    const { result } = renderHook(
      () => {
        const [open, setOpen] = useState(true);
        const surfaceId = useUiSurface({
          active: open,
          kind: "settings",
          origin: "navigable",
          blocking: false,
          dismissible: true,
          supportedActions: ["close"],
          target: { section: "appearance" },
          onClose: () => {
            onClose();
            setOpen(false);
          },
        });
        return { navigation: useUiNavigation(), surfaceId };
      },
      { wrapper }
    );
    const surfaceId = result.current.surfaceId;

    let pending;
    await act(async () => {
      pending = result.current.navigation.closeSurface({
        surfaceId,
        expectedRevision: 7,
        expectedUiGeneration: 1,
      });
      await Promise.resolve();
    });
    await expect(pending).resolves.toMatchObject({
      changed: true,
      action: "ui.close",
      uiGeneration: 2,
      surface: { surfaceId, kind: "settings" },
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.navigation.inspectUi()).toMatchObject({
      uiGeneration: 2,
      topSurfaceId: null,
      surfaces: [],
    });
  });

  it("serializes duplicate Close requests so the visible intent runs once", async () => {
    const onClose = vi.fn();
    const { result } = renderHook(
      () => {
        const [open, setOpen] = useState(true);
        const surfaceId = useUiSurface({
          active: open,
          kind: "settings",
          origin: "navigable",
          blocking: false,
          dismissible: true,
          supportedActions: ["close"],
          target: { section: "appearance" },
          onClose: () => {
            onClose();
            setOpen(false);
          },
        });
        return { navigation: useUiNavigation(), surfaceId };
      },
      { wrapper }
    );
    const request = {
      surfaceId: result.current.surfaceId,
      expectedRevision: 7,
      expectedUiGeneration: 1,
    };
    /** @type {Promise<PromiseSettledResult<any>[]> | undefined} */
    let pendingOutcomes;

    await act(async () => {
      pendingOutcomes = Promise.allSettled([
        result.current.navigation.closeSurface(request),
        result.current.navigation.closeSurface(request),
      ]);
      await Promise.resolve();
    });
    if (!pendingOutcomes) throw new Error("Close outcomes were not captured.");
    const outcomes = await pendingOutcomes;

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(outcomes.map(({ status }) => status)).toEqual(["fulfilled", "rejected"]);
    if (outcomes[1].status !== "rejected") throw new Error("Second Close request was accepted.");
    expect(outcomes[1].reason).toMatchObject({ reason: "uiGenerationConflict" });
  });

  it("reports not settled when the visible Close intent leaves the surface mounted", async () => {
    const onClose = vi.fn();
    const { result } = renderHook(
      () => {
        const surfaceId = useUiSurface({
          kind: "settings",
          origin: "navigable",
          blocking: false,
          dismissible: true,
          supportedActions: ["close"],
          target: { section: "appearance" },
          onClose,
        });
        return { navigation: useUiNavigation(), surfaceId };
      },
      { wrapper: shortSettlementWrapper }
    );

    await expect(
      result.current.navigation.closeSurface({
        surfaceId: result.current.surfaceId,
        expectedRevision: 7,
        expectedUiGeneration: 1,
      })
    ).rejects.toMatchObject({ reason: "uiNotSettled" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.navigation.inspectUi().surfaces).toHaveLength(1);
  });

  it("cancels only the exact surface and settles when its visible state changes", async () => {
    const onCancel = vi.fn();
    const { result } = renderHook(
      () => {
        const [phase, setPhase] = useState("editing");
        const surfaceId = useUiSurface({
          kind: "themeEditor",
          origin: "navigable",
          blocking: true,
          dirty: true,
          dismissible: true,
          supportedActions: ["cancel"],
          target: { intent: "create", phase },
          onCancel: () => {
            onCancel();
            setPhase("discardConfirmation");
          },
        });
        return { navigation: useUiNavigation(), surfaceId };
      },
      { wrapper }
    );

    let pending;
    await act(async () => {
      pending = result.current.navigation.cancelSurface({
        surfaceId: result.current.surfaceId,
        expectedRevision: 7,
        expectedUiGeneration: 1,
      });
      await Promise.resolve();
    });
    await expect(pending).resolves.toMatchObject({
      changed: true,
      action: "ui.cancel",
      uiGeneration: 2,
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(result.current.navigation.inspectUi().surfaces[0].target.phase).toBe(
      "discardConfirmation"
    );
  });

  it("shows Settings through its owner and returns the registered surface", async () => {
    const show = vi.fn();
    const { result } = renderHook(
      () => {
        const [open, setOpen] = useState(false);
        const [section, setSection] = useState("behavior");
        useUiNavigationTarget("settings", {
          show: ({ section: nextSection }) => {
            show(nextSection);
            setSection(nextSection);
            setOpen(true);
          },
        });
        useUiSurface({
          active: open,
          kind: "settings",
          origin: "navigable",
          blocking: false,
          dismissible: true,
          supportedActions: ["close"],
          target: { section },
          onClose: () => setOpen(false),
        });
        return useUiNavigation();
      },
      { wrapper }
    );
    let pending;

    await act(async () => {
      pending = result.current.showSettings({
        section: "appearance",
        expectedRevision: 7,
        expectedUiGeneration: 0,
      });
      await Promise.resolve();
    });
    const response = await pending;

    expect(show).toHaveBeenCalledWith("appearance");
    expect(response).toMatchObject({
      changed: true,
      revision: 7,
      uiGeneration: 1,
      action: "ui.show.settings",
      surface: { kind: "settings", target: { section: "appearance" } },
    });
  });

  it("observes event decisions without allowing show to synthesize or hide them", async () => {
    const show = vi.fn();
    const { result } = renderHook(
      () => {
        useUiNavigationTarget("settings", { show });
        const eventSurfaceId = useUiSurface({
          kind: "update",
          origin: "event",
          blocking: false,
          dismissible: true,
          supportedActions: ["cancel"],
          target: { phase: "idle" },
          onCancel: vi.fn(),
        });
        return { navigation: useUiNavigation(), eventSurfaceId };
      },
      { wrapper }
    );

    await expect(
      result.current.navigation.showSettings({
        section: "appearance",
        expectedRevision: 7,
        expectedUiGeneration: 1,
      })
    ).rejects.toMatchObject({
      reason: "uiConflict",
      details: { kind: "update", surfaceId: result.current.eventSurfaceId },
    });
    expect(show).not.toHaveBeenCalled();
    await expect(
      result.current.navigation.showFeedback({
        expectedRevision: 7,
        expectedUiGeneration: 1,
      })
    ).rejects.toMatchObject({ reason: "surfaceUnavailable" });
  });

  it("lets the window owner handle Dock Panel Settings without a popover target", async () => {
    const { result } = renderHook(
      () => {
        const [openPanelId, setOpenPanelId] = useState(null);
        useUiNavigationTarget("panelSettings", {
          prepare: ({ panelId }) => {
            setOpenPanelId(panelId);
            return { handled: true };
          },
        });
        useUiSurface({
          active: openPanelId !== null,
          kind: "panelSettings",
          origin: "navigable",
          blocking: false,
          dismissible: true,
          supportedActions: ["close"],
          target: { panelId: openPanelId, presentation: "dock" },
          onClose: () => setOpenPanelId(null),
        });
        return useUiNavigation();
      },
      { wrapper }
    );
    let pending;

    await act(async () => {
      pending = result.current.showPanelSettings({
        panelId: "dock-stats",
        expectedRevision: 7,
        expectedUiGeneration: 0,
      });
      await Promise.resolve();
    });

    await expect(pending).resolves.toMatchObject({
      changed: true,
      surface: {
        kind: "panelSettings",
        target: { panelId: "dock-stats", presentation: "dock" },
      },
    });
  });

  it("opens an authoring editor, retargets its page idempotently, and refuses another draft", async () => {
    const { result } = renderHook(
      () => {
        const [authoring, setAuthoring] = useState(null);
        const [page, setPage] = useState("core");
        useBlockingEditor("theme", authoring !== null);
        useUiNavigationTarget("themeEditor", {
          blockingEditorId: "theme",
          matches: (target) =>
            authoring?.mode === target.intent &&
            (target.themeId ?? null) === (authoring?.sourceId ?? null),
          show: (target) => {
            if (!authoring) {
              setAuthoring({
                mode: target.intent,
                sourceId: target.themeId ?? null,
                draftId: "theme-draft-1",
              });
            }
            if (target.page) setPage(target.page);
          },
        });
        useUiSurface({
          active: authoring !== null,
          kind: "themeEditor",
          origin: "navigable",
          blocking: true,
          dirty: false,
          dismissible: true,
          supportedActions: ["cancel"],
          target: authoring
            ? {
                intent: authoring.mode,
                themeId: authoring.sourceId,
                draftId: authoring.draftId,
                page,
              }
            : {},
          onCancel: vi.fn(),
        });
        return useUiNavigation();
      },
      { wrapper }
    );

    /** @type {Promise<any> | undefined} */
    let pending;
    await act(async () => {
      pending = result.current.showThemeEditor({
        mode: "customize",
        themeId: "plvs-light",
        page: "advanced",
        expectedRevision: 7,
        expectedUiGeneration: 0,
      });
      await Promise.resolve();
    });
    if (!pending) throw new Error("Theme Editor request was not captured.");
    const opened = await pending;
    expect(opened).toMatchObject({
      changed: true,
      surface: {
        kind: "themeEditor",
        target: { intent: "customize", themeId: "plvs-light", page: "advanced" },
      },
    });

    await expect(
      result.current.showThemeEditor({
        mode: "edit",
        themeId: "custom-other",
        expectedRevision: 7,
        expectedUiGeneration: opened.uiGeneration,
      })
    ).rejects.toMatchObject({ reason: "editorActive", details: { editors: ["theme"] } });
  });

  it("treats a StrictMode effect replay as one mounted surface lifetime", () => {
    const { result } = renderHook(
      () => {
        useUiSurface({
          kind: "settings",
          origin: "navigable",
          blocking: false,
          dismissible: true,
          supportedActions: ["close"],
          target: { section: "behavior" },
          onClose: vi.fn(),
        });
        return useUiNavigation();
      },
      { wrapper, reactStrictMode: true }
    );

    expect(result.current.inspectUi()).toMatchObject({
      uiGeneration: 1,
      surfaces: [{ kind: "settings", target: { section: "behavior" } }],
    });
  });

  it("moves an already-open target to the top when show focuses it", async () => {
    const { result } = renderHook(
      () => {
        useUiNavigationTarget("settings", { show: vi.fn() });
        useUiSurface({
          kind: "settings",
          origin: "navigable",
          blocking: false,
          dismissible: true,
          supportedActions: ["close"],
          target: { section: "appearance" },
          onClose: vi.fn(),
        });
        useUiSurface({
          kind: "panelSettings",
          origin: "navigable",
          blocking: false,
          dismissible: true,
          supportedActions: ["close"],
          target: { panelId: "stats" },
          onClose: vi.fn(),
        });
        return useUiNavigation();
      },
      { wrapper }
    );
    expect(result.current.inspectUi().surfaces.map(({ kind }) => kind)).toEqual([
      "settings",
      "panelSettings",
    ]);
    /** @type {any} */
    let response;

    await act(async () => {
      response = await result.current.showSettings({
        section: "appearance",
        expectedRevision: 7,
        expectedUiGeneration: 2,
      });
    });
    expect(response.uiGeneration).toBe(3);
    expect(result.current.inspectUi().surfaces.map(({ kind }) => kind)).toEqual([
      "panelSettings",
      "settings",
    ]);
  });
});
