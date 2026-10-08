import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useBlockingEditors } from "../hooks/BlockingEditorsContext.jsx";
import { useUiNavigation } from "../uiNavigation/UiNavigationContext.jsx";

const DevelopmentEventFixturesContext = createContext(null);
const DevelopmentEventFixtureRegistryContext = createContext(null);

function fixtureError(reason, details = {}) {
  const messages = {
    fixtureUnavailable: "Development event fixtures are unavailable.",
    fixtureNotFound: "The development event fixture is no longer active.",
    fixtureConflict: "Another editor or event prevents this development fixture.",
    fixtureResetUnsafe: "The development event fixture cannot be reset safely.",
    uiGenerationConflict: "The visible UI changed after it was inspected.",
    revisionConflict: "The Agent Control revision changed.",
    uiNotSettled: "The development event fixture did not settle in time.",
  };
  return Object.assign(new Error(messages[reason] ?? "Development event fixture failed."), {
    reason,
    details,
  });
}

function fixtureId() {
  const entropy =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `fixture-${entropy
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 60)}`;
}

function surfaceMatches(surface, expected) {
  return (
    surface.kind === expected.kind &&
    Object.entries(expected.target ?? {}).every(([key, value]) => surface.target?.[key] === value)
  );
}

export function DevelopmentEventFixturesProvider({
  children,
  enabled = false,
  getRevision = () => null,
  settlementTimeoutMs = 3000,
}) {
  const uiNavigation = useUiNavigation();
  const { activeBlockingEditors } = useBlockingEditors();
  const blockingRef = useRef(activeBlockingEditors);
  blockingRef.current = activeBlockingEditors;
  const adaptersRef = useRef(new Map());
  const activeRef = useRef(null);
  const queueRef = useRef(Promise.resolve());

  const registerAdapter = useCallback((name, adapterRef) => {
    adaptersRef.current.set(name, adapterRef);
    return () => {
      if (adaptersRef.current.get(name) === adapterRef) adaptersRef.current.delete(name);
    };
  }, []);

  const enqueue = useCallback((action) => {
    const pending = queueRef.current.catch(() => {}).then(action);
    queueRef.current = pending;
    return pending;
  }, []);

  const assertTokens = useCallback(
    ({ expectedRevision, expectedUiGeneration }) => {
      const currentRevision = getRevision();
      if (Number.isSafeInteger(currentRevision) && expectedRevision !== currentRevision) {
        throw fixtureError("revisionConflict", { expectedRevision, currentRevision });
      }
      const currentUiGeneration = uiNavigation.inspectUi().uiGeneration;
      if (expectedUiGeneration !== currentUiGeneration) {
        throw fixtureError("uiGenerationConflict", {
          expectedUiGeneration,
          currentUiGeneration,
        });
      }
    },
    [getRevision, uiNavigation]
  );

  const waitFor = useCallback(
    async (predicate, details) => {
      const deadline = Date.now() + settlementTimeoutMs;
      for (;;) {
        const inspection = uiNavigation.inspectUi();
        const result = predicate(inspection);
        if (result) return { inspection, result };
        if (Date.now() >= deadline) throw fixtureError("uiNotSettled", details);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    },
    [settlementTimeoutMs, uiNavigation]
  );

  const establish = useCallback(
    (params) =>
      enqueue(async () => {
        if (!enabled) throw fixtureError("fixtureUnavailable");
        assertTokens(params);
        let active = activeRef.current;
        if (active && !active.adapterRef.current?.matches?.(active.fixtureId)) {
          activeRef.current = null;
          active = null;
        }
        if (active) {
          if (active.name !== params.name) {
            throw fixtureError("fixtureConflict", {
              name: params.name,
              activeFixtureId: active.fixtureId,
            });
          }
          const activeAdapter = active.adapterRef.current;
          const inspection = uiNavigation.inspectUi();
          const surface = inspection.surfaces.find((candidate) =>
            surfaceMatches(candidate, activeAdapter.surface)
          );
          if (!surface) {
            throw fixtureError("uiNotSettled", {
              fixtureId: active.fixtureId,
              committed: true,
            });
          }
          return {
            changed: false,
            committed: true,
            name: active.name,
            fixtureId: active.fixtureId,
            revision: getRevision(),
            uiGeneration: inspection.uiGeneration,
            surface,
          };
        }

        const adapterRef = adaptersRef.current.get(params.name);
        const adapter = adapterRef?.current;
        if (!adapter) throw fixtureError("fixtureUnavailable", { name: params.name });

        const before = uiNavigation.inspectUi();
        if (
          blockingRef.current.length > 0 ||
          before.surfaces.some(({ origin }) => origin !== "navigable")
        ) {
          throw fixtureError("fixtureConflict", { name: params.name });
        }
        if (adapter.canEstablish && adapter.canEstablish() !== true) {
          throw fixtureError("fixtureConflict", { name: params.name });
        }

        const id = fixtureId();
        await adapter.establish(id);
        activeRef.current = { name: params.name, fixtureId: id, adapterRef };
        try {
          const settled = await waitFor(
            (inspection) =>
              inspection.surfaces.find((surface) => surfaceMatches(surface, adapter.surface)),
            { name: params.name, fixtureId: id, committed: true }
          );
          return {
            changed: true,
            committed: true,
            name: params.name,
            fixtureId: id,
            revision: getRevision(),
            uiGeneration: settled.inspection.uiGeneration,
            surface: settled.result,
          };
        } catch (error) {
          error.details = { ...error.details, name: params.name, fixtureId: id, committed: true };
          throw error;
        }
      }),
    [assertTokens, enabled, enqueue, getRevision, uiNavigation, waitFor]
  );

  const reset = useCallback(
    (params) =>
      enqueue(async () => {
        if (!enabled) throw fixtureError("fixtureUnavailable");
        assertTokens(params);
        const active = activeRef.current;
        if (!active || active.fixtureId !== params.fixtureId) {
          throw fixtureError("fixtureNotFound", { fixtureId: params.fixtureId });
        }
        const adapter = active.adapterRef.current;
        if (!adapter?.matches?.(active.fixtureId)) {
          activeRef.current = null;
          return {
            changed: false,
            committed: false,
            name: active.name,
            fixtureId: active.fixtureId,
            revision: getRevision(),
            uiGeneration: uiNavigation.inspectUi().uiGeneration,
          };
        }
        if (adapter.canReset && adapter.canReset(active.fixtureId) !== true) {
          throw fixtureError("fixtureResetUnsafe", { fixtureId: active.fixtureId });
        }
        await adapter.reset(active.fixtureId);
        try {
          const settled = await waitFor(
            (inspection) =>
              inspection.surfaces.some((surface) => surfaceMatches(surface, adapter.surface))
                ? null
                : true,
            { fixtureId: active.fixtureId, committed: true }
          );
          activeRef.current = null;
          return {
            changed: true,
            committed: true,
            name: active.name,
            fixtureId: active.fixtureId,
            revision: getRevision(),
            uiGeneration: settled.inspection.uiGeneration,
          };
        } catch (error) {
          error.details = { ...error.details, fixtureId: active.fixtureId, committed: true };
          throw error;
        }
      }),
    [assertTokens, enabled, enqueue, getRevision, uiNavigation, waitFor]
  );

  const value = useMemo(() => ({ enabled, establish, reset }), [enabled, establish, reset]);
  const registry = useMemo(() => ({ registerAdapter }), [registerAdapter]);
  return (
    <DevelopmentEventFixtureRegistryContext.Provider value={registry}>
      <DevelopmentEventFixturesContext.Provider value={value}>
        {children}
      </DevelopmentEventFixturesContext.Provider>
    </DevelopmentEventFixtureRegistryContext.Provider>
  );
}

export function useDevelopmentEventFixtures() {
  const fixtures = useContext(DevelopmentEventFixturesContext);
  if (!fixtures) {
    throw new Error(
      "useDevelopmentEventFixtures must be used inside DevelopmentEventFixturesProvider"
    );
  }
  return fixtures;
}

export function useDevelopmentEventFixtureAdapter(name, adapter) {
  const registry = useContext(DevelopmentEventFixtureRegistryContext);
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;
  useEffect(() => registry?.registerAdapter(name, adapterRef), [name, registry]);
}
