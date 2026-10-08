import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";

const EditorDraftContext = createContext(null);

export class EditorDraftRegistryError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "EditorDraftRegistryError";
    this.code = code;
    this.details = details;
  }
}

export function EditorDraftProvider({ children }) {
  const adaptersRef = useRef(new Map());
  const decisionsRef = useRef(new Map());

  const registerEditorDraft = useCallback((surfaceId, kind, controllerRef) => {
    const registration = { kind, controllerRef };
    adaptersRef.current.set(surfaceId, registration);
    return () => {
      if (adaptersRef.current.get(surfaceId) === registration) {
        adaptersRef.current.delete(surfaceId);
      }
    };
  }, []);

  const resolve = useCallback((kind, surfaceId) => {
    const registration = adaptersRef.current.get(surfaceId);
    if (!registration) {
      throw new EditorDraftRegistryError("editorDraftNotFound", { kind, surfaceId });
    }
    if (registration.kind !== kind) {
      throw new EditorDraftRegistryError("editorDraftKindMismatch", {
        kind,
        actualKind: registration.kind,
        surfaceId,
      });
    }
    return registration.controllerRef.current;
  }, []);

  const registerDraftDecision = useCallback(
    (decisionSurfaceId, editorKind, editorSurfaceId, actionRef) => {
      const registration = { editorKind, editorSurfaceId, actionRef };
      decisionsRef.current.set(decisionSurfaceId, registration);
      return () => {
        if (decisionsRef.current.get(decisionSurfaceId) === registration) {
          decisionsRef.current.delete(decisionSurfaceId);
        }
      };
    },
    []
  );

  const inspect = useCallback(
    (kind, surfaceId) => {
      const snapshot = resolve(kind, surfaceId).inspectDraft?.();
      if (!snapshot) {
        throw new EditorDraftRegistryError("editorDraftNotFound", { kind, surfaceId });
      }
      return snapshot;
    },
    [resolve]
  );

  const commit = useCallback(
    (kind, surfaceId, document) => {
      const controller = resolve(kind, surfaceId);
      if (typeof controller.commitDraftDocument !== "function") {
        throw new EditorDraftRegistryError("draftActionUnavailable", {
          action: "patch",
          kind,
          surfaceId,
        });
      }
      return controller.commitDraftDocument(document);
    },
    [resolve]
  );

  const history = useCallback(
    (kind, surfaceId, action) => {
      const controller = resolve(kind, surfaceId);
      const snapshot = controller.inspectDraft?.();
      const available = action === "undo" ? snapshot?.canUndo === true : snapshot?.canRedo === true;
      if (!available || typeof controller[action] !== "function") {
        throw new EditorDraftRegistryError("draftActionUnavailable", {
          action,
          kind,
          surfaceId,
        });
      }
      return controller[action]();
    },
    [resolve]
  );

  const discard = useCallback(
    (kind, surfaceId, decisionSurfaceId, expectedDraftGeneration) => {
      const decision = decisionsRef.current.get(decisionSurfaceId);
      if (!decision || decision.editorKind !== kind || decision.editorSurfaceId !== surfaceId) {
        throw new EditorDraftRegistryError("draftDecisionNotFound", {
          kind,
          surfaceId,
          decisionSurfaceId,
        });
      }
      const snapshot = resolve(kind, surfaceId).inspectDraft?.();
      if (!snapshot) {
        throw new EditorDraftRegistryError("editorDraftNotFound", { kind, surfaceId });
      }
      if (snapshot.draftGeneration !== expectedDraftGeneration) {
        throw new EditorDraftRegistryError("draftGenerationConflict", {
          expectedDraftGeneration,
          draftGeneration: snapshot.draftGeneration,
        });
      }
      if (!snapshot.dirty) {
        throw new EditorDraftRegistryError("draftNotDirty", { kind, surfaceId });
      }
      return decision.actionRef.current();
    },
    [resolve]
  );

  const value = useMemo(
    () => ({ registerEditorDraft, registerDraftDecision, inspect, commit, history, discard }),
    [commit, discard, history, inspect, registerDraftDecision, registerEditorDraft]
  );
  return <EditorDraftContext.Provider value={value}>{children}</EditorDraftContext.Provider>;
}

export function useEditorDraftRegistry() {
  const value = useContext(EditorDraftContext);
  if (!value) throw new Error("useEditorDraftRegistry must be used inside EditorDraftProvider");
  return value;
}

export function useEditorDraftSurface({ active = true, kind, surfaceId, controller }) {
  const registry = useContext(EditorDraftContext);
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  useEffect(() => {
    if (!active || !surfaceId || !registry) return undefined;
    return registry.registerEditorDraft(surfaceId, kind, controllerRef);
  }, [active, kind, registry, surfaceId]);
}

export function useEditorDraftDecision({
  active = true,
  decisionSurfaceId,
  editorKind,
  editorSurfaceId,
  onDiscard,
}) {
  const registry = useContext(EditorDraftContext);
  const actionRef = useRef(onDiscard);
  actionRef.current = onDiscard;

  useEffect(() => {
    if (!active || !decisionSurfaceId || !editorSurfaceId || !registry) return undefined;
    return registry.registerDraftDecision(
      decisionSurfaceId,
      editorKind,
      editorSurfaceId,
      actionRef
    );
  }, [active, decisionSurfaceId, editorKind, editorSurfaceId, registry]);
}
