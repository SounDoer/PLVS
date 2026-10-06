import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useBlockingEditors } from "../hooks/BlockingEditorsContext.jsx";
import {
  createUiNavigationState,
  createUiNavigationError,
  createUiSurfaceId,
  focusUiSurface,
  mountUiSurface,
  projectUiInspection,
  unmountUiSurface,
} from "./uiNavigationModel.js";

const UiNavigationContext = createContext(null);
const UiSurfaceRegistryContext = createContext(null);

export function UiNavigationProvider({
  children,
  displayName = "PLVS",
  windowForm = "normal",
  windowVisible = true,
  getRevision = () => null,
  settlementTimeoutMs = 3000,
}) {
  const [state, setState] = useState(createUiNavigationState);
  const [environment, setEnvironment] = useState(() => ({
    displayName,
    windowForm,
    windowVisible: windowVisible === true,
  }));
  const stateRef = useRef(state);
  stateRef.current = state;
  const countsRef = useRef(new Map());
  const targetsRef = useRef(new Map());
  const actionQueueRef = useRef(Promise.resolve());
  const { activeBlockingEditors } = useBlockingEditors();
  const activeBlockingEditorsRef = useRef(activeBlockingEditors);
  activeBlockingEditorsRef.current = activeBlockingEditors;
  const boot = globalThis.window?.__PLVS_INITIAL_STATE__ ?? {};
  const commitState = useCallback((reduce) => {
    const next = reduce(stateRef.current);
    stateRef.current = next;
    setState(next);
    return next;
  }, []);
  const registerUiSurface = useCallback(
    (surfaceId, descriptor, actionsRef) => {
      const counts = countsRef.current;
      const current = counts.get(surfaceId);
      if (current?.removal) current.removal.cancelled = true;
      counts.set(surfaceId, {
        ...current,
        count: (current?.count ?? 0) + 1,
        actionsRef,
        removal: null,
      });
      commitState((current) => mountUiSurface(current, { ...descriptor, surfaceId }));
      return () => {
        const entry = counts.get(surfaceId);
        const remaining = (entry?.count ?? 0) - 1;
        if (remaining > 0) {
          counts.set(surfaceId, { ...entry, count: remaining });
          return;
        }
        const removal = { cancelled: false };
        counts.set(surfaceId, { ...entry, count: 0, removal });
        queueMicrotask(() => {
          const latest = counts.get(surfaceId);
          if (removal.cancelled || latest?.removal !== removal || latest.count !== 0) return;
          counts.delete(surfaceId);
          commitState((currentState) => unmountUiSurface(currentState, surfaceId));
        });
      };
    },
    [commitState]
  );
  const updateUiSurface = useCallback(
    (surfaceId, descriptor) => {
      if (!countsRef.current.has(surfaceId)) return;
      commitState((current) => mountUiSurface(current, { ...descriptor, surfaceId }));
    },
    [commitState]
  );
  const registerUiTarget = useCallback((kind, controllerRef) => {
    targetsRef.current.set(kind, controllerRef);
    return () => {
      if (targetsRef.current.get(kind) === controllerRef) targetsRef.current.delete(kind);
    };
  }, []);
  const enqueueAction = useCallback((action) => {
    const pending = actionQueueRef.current.catch(() => {}).then(action);
    actionQueueRef.current = pending;
    return pending;
  }, []);
  const waitForSurfaceAbsent = useCallback(
    async (surfaceId) => {
      const deadline = Date.now() + settlementTimeoutMs;
      while (stateRef.current.surfaces.some((surface) => surface.surfaceId === surfaceId)) {
        if (Date.now() >= deadline) {
          throw createUiNavigationError("uiNotSettled", { surfaceId });
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    },
    [settlementTimeoutMs]
  );
  const waitForSurfaceChanged = useCallback(
    async (surfaceId, previousUiGeneration) => {
      const deadline = Date.now() + settlementTimeoutMs;
      while (
        stateRef.current.uiGeneration === previousUiGeneration &&
        stateRef.current.surfaces.some((surface) => surface.surfaceId === surfaceId)
      ) {
        if (Date.now() >= deadline) {
          throw createUiNavigationError("uiNotSettled", { surfaceId });
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    },
    [settlementTimeoutMs]
  );
  const closeSurface = useCallback(
    ({ surfaceId, expectedRevision, expectedUiGeneration }) =>
      enqueueAction(async () => {
        const currentRevision = getRevision();
        if (Number.isSafeInteger(currentRevision) && expectedRevision !== currentRevision) {
          throw Object.assign(new Error("The Agent Control revision changed."), {
            reason: "revisionConflict",
            details: { expectedRevision, currentRevision },
          });
        }
        const currentState = stateRef.current;
        if (expectedUiGeneration !== currentState.uiGeneration) {
          throw createUiNavigationError("uiGenerationConflict", {
            expectedUiGeneration,
            currentUiGeneration: currentState.uiGeneration,
          });
        }
        const surface = currentState.surfaces.find(
          (candidate) => candidate.surfaceId === surfaceId
        );
        const entry = countsRef.current.get(surfaceId);
        if (!surface || !entry) {
          throw createUiNavigationError("uiSurfaceNotFound", { surfaceId });
        }
        if (entry.actionPending) {
          throw createUiNavigationError("uiBusy", { surfaceId, kind: surface.kind });
        }
        if (!surface.supportedActions.includes("close") || !entry.actionsRef.current.close) {
          throw createUiNavigationError("uiActionUnavailable", {
            surfaceId,
            kind: surface.kind,
            action: "close",
          });
        }
        entry.actionPending = true;
        try {
          await entry.actionsRef.current.close();
          await waitForSurfaceAbsent(surfaceId);
        } catch (error) {
          const currentEntry = countsRef.current.get(surfaceId);
          if (currentEntry) currentEntry.actionPending = false;
          throw error;
        }
        return {
          changed: true,
          action: "ui.close",
          revision: getRevision(),
          uiGeneration: stateRef.current.uiGeneration,
          surface,
        };
      }),
    [enqueueAction, getRevision, waitForSurfaceAbsent]
  );
  const cancelSurface = useCallback(
    ({ surfaceId, expectedRevision, expectedUiGeneration }) =>
      enqueueAction(async () => {
        const currentRevision = getRevision();
        if (Number.isSafeInteger(currentRevision) && expectedRevision !== currentRevision) {
          throw Object.assign(new Error("The Agent Control revision changed."), {
            reason: "revisionConflict",
            details: { expectedRevision, currentRevision },
          });
        }
        const currentState = stateRef.current;
        if (expectedUiGeneration !== currentState.uiGeneration) {
          throw createUiNavigationError("uiGenerationConflict", {
            expectedUiGeneration,
            currentUiGeneration: currentState.uiGeneration,
          });
        }
        const surface = currentState.surfaces.find(
          (candidate) => candidate.surfaceId === surfaceId
        );
        const entry = countsRef.current.get(surfaceId);
        if (!surface || !entry) {
          throw createUiNavigationError("uiSurfaceNotFound", { surfaceId });
        }
        if (entry.actionPending) {
          throw createUiNavigationError("uiBusy", { surfaceId, kind: surface.kind });
        }
        if (!surface.supportedActions.includes("cancel") || !entry.actionsRef.current.cancel) {
          throw createUiNavigationError("uiActionUnavailable", {
            surfaceId,
            kind: surface.kind,
            action: "cancel",
          });
        }
        entry.actionPending = true;
        try {
          await entry.actionsRef.current.cancel();
          await waitForSurfaceChanged(surfaceId, currentState.uiGeneration);
          const currentEntry = countsRef.current.get(surfaceId);
          if (currentEntry) currentEntry.actionPending = false;
        } catch (error) {
          const currentEntry = countsRef.current.get(surfaceId);
          if (currentEntry) currentEntry.actionPending = false;
          throw error;
        }
        return {
          changed: true,
          action: "ui.cancel",
          revision: getRevision(),
          uiGeneration: stateRef.current.uiGeneration,
          surface,
        };
      }),
    [enqueueAction, getRevision, waitForSurfaceChanged]
  );
  const waitForSurface = useCallback(
    async (kind, target) => {
      const deadline = Date.now() + settlementTimeoutMs;
      for (;;) {
        const surface = stateRef.current.surfaces.find(
          (candidate) =>
            candidate.kind === kind &&
            Object.entries(target).every((entry) => candidate.target[entry[0]] === entry[1])
        );
        if (surface) return surface;
        if (Date.now() >= deadline) throw createUiNavigationError("uiNotSettled", { kind });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    },
    [settlementTimeoutMs]
  );
  const waitForTarget = useCallback(
    async (key) => {
      const deadline = Date.now() + settlementTimeoutMs;
      for (;;) {
        const controller = targetsRef.current.get(key)?.current;
        if (controller) return controller;
        if (Date.now() >= deadline) {
          throw createUiNavigationError("uiNotSettled", { kind: key.split(":")[0] });
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    },
    [settlementTimeoutMs]
  );
  const showTarget = useCallback(
    (kind, target, action, expectedRevision, expectedUiGeneration) =>
      enqueueAction(async () => {
        const currentRevision = getRevision();
        if (Number.isSafeInteger(currentRevision) && expectedRevision !== currentRevision) {
          throw Object.assign(new Error("The Agent Control revision changed."), {
            reason: "revisionConflict",
            details: { expectedRevision, currentRevision },
          });
        }
        const before = stateRef.current;
        if (expectedUiGeneration !== before.uiGeneration) {
          throw createUiNavigationError("uiGenerationConflict", {
            expectedUiGeneration,
            currentUiGeneration: before.uiGeneration,
          });
        }
        const controller = targetsRef.current.get(kind)?.current;
        if (!controller) {
          throw createUiNavigationError("surfaceUnavailable", { kind });
        }
        if (
          ["themeEditor", "loudnessProfileEditor"].includes(kind) &&
          environment.windowForm === "dock"
        ) {
          throw createUiNavigationError("surfaceUnavailable", {
            kind,
            windowForm: environment.windowForm,
          });
        }
        const blockers = activeBlockingEditorsRef.current;
        const isMatchingBlockingEditor =
          blockers.length === 1 &&
          blockers[0] === controller.blockingEditorId &&
          controller.matches?.(target) === true;
        if (blockers.length > 0 && !isMatchingBlockingEditor) {
          const authoringEditors = blockers.filter((editor) =>
            ["theme", "loudnessProfile", "feedback"].includes(editor)
          );
          if (authoringEditors.length > 0) {
            throw createUiNavigationError("editorActive", { kind, editors: authoringEditors });
          }
          throw createUiNavigationError("uiConflict", { kind });
        }
        if (kind === "panelSettings") {
          if (typeof controller.prepare !== "function") {
            throw createUiNavigationError("surfaceUnavailable", { kind });
          }
          const prepared = await controller.prepare(target);
          if (prepared?.handled !== true) {
            const panelController = await waitForTarget(`${kind}:${target.panelId}`);
            if (typeof panelController.show !== "function") {
              throw createUiNavigationError("surfaceUnavailable", { kind });
            }
            await panelController.show(target);
          }
        } else {
          if (typeof controller.show !== "function") {
            throw createUiNavigationError("surfaceUnavailable", { kind });
          }
          await controller.show(target);
        }
        let surface = await waitForSurface(kind, target);
        const after = commitState((current) => focusUiSurface(current, surface.surfaceId));
        surface = after.surfaces.find((candidate) => candidate.surfaceId === surface.surfaceId);
        return {
          changed: after.uiGeneration !== before.uiGeneration,
          revision: getRevision(),
          uiGeneration: after.uiGeneration,
          action,
          surface,
        };
      }),
    [commitState, enqueueAction, environment.windowForm, getRevision, waitForSurface, waitForTarget]
  );
  const showSettings = useCallback(
    ({ section, expectedRevision, expectedUiGeneration }) =>
      showTarget(
        "settings",
        { section },
        "ui.show.settings",
        expectedRevision,
        expectedUiGeneration
      ),
    [showTarget]
  );
  const showPanelSettings = useCallback(
    ({ panelId, expectedRevision, expectedUiGeneration }) =>
      showTarget(
        "panelSettings",
        { panelId },
        "ui.show.panel-settings",
        expectedRevision,
        expectedUiGeneration
      ),
    [showTarget]
  );
  const showThemeEditor = useCallback(
    ({ mode, themeId, page, expectedRevision, expectedUiGeneration }) =>
      showTarget(
        "themeEditor",
        {
          intent: mode,
          ...(themeId === undefined ? {} : { themeId }),
          ...(page === undefined ? {} : { page }),
        },
        "ui.show.theme-editor",
        expectedRevision,
        expectedUiGeneration
      ),
    [showTarget]
  );
  const showLoudnessProfileEditor = useCallback(
    ({ mode, profileId, expectedRevision, expectedUiGeneration }) =>
      showTarget(
        "loudnessProfileEditor",
        {
          intent: mode,
          ...(profileId === undefined ? {} : { profileId }),
        },
        "ui.show.loudness-profile-editor",
        expectedRevision,
        expectedUiGeneration
      ),
    [showTarget]
  );
  const showFeedback = useCallback(
    ({ expectedRevision, expectedUiGeneration }) =>
      showTarget("feedback", {}, "ui.show.feedback", expectedRevision, expectedUiGeneration),
    [showTarget]
  );
  const inspectUi = useCallback(
    () =>
      projectUiInspection(state, {
        workbench: {
          instanceId: typeof boot.instanceId === "string" ? boot.instanceId : null,
          workspaceId: typeof boot.workspaceId === "string" ? boot.workspaceId : null,
          displayName: environment.displayName,
        },
        window: { form: environment.windowForm, visible: environment.windowVisible },
        activeBlockingEditors,
      }),
    [activeBlockingEditors, boot.instanceId, boot.workspaceId, environment, state]
  );
  const updateEnvironment = useCallback((next) => {
    setEnvironment((current) => {
      const resolved = {
        displayName: next.displayName ?? current.displayName,
        windowForm: next.windowForm ?? current.windowForm,
        windowVisible:
          next.windowVisible === undefined ? current.windowVisible : next.windowVisible === true,
      };
      return JSON.stringify(resolved) === JSON.stringify(current) ? current : resolved;
    });
  }, []);
  const value = useMemo(
    () => ({
      uiGeneration: state.uiGeneration,
      inspectUi,
      showSettings,
      showPanelSettings,
      showThemeEditor,
      showLoudnessProfileEditor,
      showFeedback,
      closeSurface,
      cancelSurface,
      updateEnvironment,
    }),
    [
      closeSurface,
      cancelSurface,
      inspectUi,
      showPanelSettings,
      showThemeEditor,
      showLoudnessProfileEditor,
      showFeedback,
      showSettings,
      state.uiGeneration,
      updateEnvironment,
    ]
  );
  const registry = useMemo(
    () => ({ registerUiSurface, updateUiSurface, registerUiTarget }),
    [registerUiSurface, registerUiTarget, updateUiSurface]
  );
  return (
    <UiNavigationContext.Provider value={value}>
      <UiSurfaceRegistryContext.Provider value={registry}>
        {children}
      </UiSurfaceRegistryContext.Provider>
    </UiNavigationContext.Provider>
  );
}

export function useUiNavigation() {
  const value = useContext(UiNavigationContext);
  if (!value) throw new Error("useUiNavigation must be used inside UiNavigationProvider");
  return value;
}

export function useUiNavigationEnvironment(environment) {
  const navigation = useUiNavigation();
  const environmentKey = JSON.stringify(environment);
  useEffect(() => {
    navigation.updateEnvironment(environment);
    // The serialized public environment is the update boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environmentKey, navigation.updateEnvironment]);
}

export function useUiSurface({
  active = true,
  onClose = undefined,
  onCancel = undefined,
  ...descriptor
}) {
  const registry = useContext(UiSurfaceRegistryContext);
  const surfaceIdRef = useRef(null);
  if (surfaceIdRef.current === null) surfaceIdRef.current = createUiSurfaceId();
  const surfaceId = surfaceIdRef.current;
  const descriptorKey = JSON.stringify(descriptor);
  const actionsRef = useRef({ close: onClose, cancel: onCancel });
  actionsRef.current = { close: onClose, cancel: onCancel };

  useEffect(() => {
    if (!active || !registry) return undefined;
    return registry.registerUiSurface(surfaceId, descriptor, actionsRef);
    // Registration owns the lifetime. Descriptor changes are handled by the update effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, registry, surfaceId]);

  useEffect(() => {
    if (active) registry?.updateUiSurface(surfaceId, descriptor);
    // The serialized public observation is the update boundary, not the caller's object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, descriptorKey, registry, surfaceId]);

  return active ? surfaceId : null;
}

export function useUiNavigationTarget(kind, targetOrController, maybeController = undefined) {
  const registry = useContext(UiSurfaceRegistryContext);
  const key = maybeController === undefined ? kind : `${kind}:${targetOrController}`;
  const controller = maybeController ?? targetOrController;
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  useEffect(() => {
    if (!registry) return undefined;
    return registry.registerUiTarget(key, controllerRef);
  }, [key, registry]);
}
