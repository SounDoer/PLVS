import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { SCENE_OPERATIONS, SceneOperationBlockedError } from "../lib/sceneOperations.js";

/// The one place that knows whether a draft-style editor is open.
///
/// A blocking editor is any surface with draft / preview / save / cancel semantics: what it shows
/// is a preview that outranks the persisted state, and closing it without Save throws the user's
/// work away. Preset operations are refused while one is open. Dock entry may transfer an editor
/// only when every registration explicitly supports both hosts; unknown editors remain blocked.
///
/// The rule is "open", not "dirty", on purpose. Dirty is invisible to the user and flips mid-
/// interaction; whether an editor is on screen is something both the user and a remote caller can
/// reason about, and the operations guarded here do not merely lose typed characters, they replace
/// the scene or close the editor outright.
///
/// Registration is a count, not a flag: StrictMode mounts effects twice, and an id registered by
/// two surfaces at once must survive the first unmount.

const BlockingEditorsContext = createContext(null);

const EMPTY_EDITORS = Object.freeze([]);

function sameIds(a, b) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function BlockingEditorsProvider({ children }) {
  const countsRef = useRef(new Map());
  const transferableRef = useRef(new Map());
  const [activeBlockingEditors, setActiveBlockingEditors] = useState(EMPTY_EDITORS);

  const sync = useCallback(() => {
    const next = [...countsRef.current.keys()];
    setActiveBlockingEditors((prev) =>
      sameIds(prev, next) ? prev : next.length === 0 ? EMPTY_EDITORS : next
    );
  }, []);

  const registerBlockingEditor = useCallback(
    (id, dockTransferable = false) => {
      const counts = countsRef.current;
      counts.set(id, (counts.get(id) ?? 0) + 1);
      if (dockTransferable)
        transferableRef.current.set(id, (transferableRef.current.get(id) ?? 0) + 1);
      sync();
      return () => {
        if (dockTransferable) {
          const remaining = (transferableRef.current.get(id) ?? 0) - 1;
          if (remaining > 0) transferableRef.current.set(id, remaining);
          else transferableRef.current.delete(id);
        }
        const remaining = (counts.get(id) ?? 0) - 1;
        if (remaining > 0) counts.set(id, remaining);
        else counts.delete(id);
        sync();
      };
    },
    [sync]
  );

  /// Reads the ref, never the state: a scene operation can be dispatched from an async
  /// continuation or from a callback the tray captured a render ago, and both must see the
  /// registry as it is now.
  const getSceneOperationBlockers = useCallback(
    (operation) =>
      [...countsRef.current.keys()].filter(
        (id) =>
          operation !== SCENE_OPERATIONS.dockEnter ||
          countsRef.current.get(id) !== transferableRef.current.get(id)
      ),
    []
  );
  const assertSceneOperationAllowed = useCallback(
    (operation) => {
      const editors = getSceneOperationBlockers(operation);
      if (editors.length) throw new SceneOperationBlockedError(operation, editors);
    },
    [getSceneOperationBlockers]
  );

  const value = useMemo(
    () => ({
      activeBlockingEditors,
      registerBlockingEditor,
      assertSceneOperationAllowed,
      getSceneOperationBlockers,
    }),
    [
      activeBlockingEditors,
      assertSceneOperationAllowed,
      registerBlockingEditor,
      getSceneOperationBlockers,
    ]
  );

  return (
    <BlockingEditorsContext.Provider value={value}>{children}</BlockingEditorsContext.Provider>
  );
}

/// Throws outside the provider, the same way `useLoudnessProfile` does and for a sharper reason:
/// a silent no-op here is a guard that is not running, which looks exactly like a guard that is.
export function useBlockingEditors() {
  const value = useContext(BlockingEditorsContext);
  if (!value) throw new Error("useBlockingEditors must be used inside BlockingEditorsProvider");
  return value;
}

/// The registration side. Every editor with draft semantics calls this with its own id; see
/// AGENTS.md, which makes it a rule rather than a habit.
///
/// Registering without a provider is a no-op rather than a throw, so an editor can be rendered on
/// its own in a test. That cannot cost the app its protection: the consumer side above throws, and
/// AppContent reads it on every render, so a missing provider fails loudly at the one place a
/// silent no-op would matter.
export function useBlockingEditor(id, active, dockTransferable = false) {
  const registry = useContext(BlockingEditorsContext);
  const registerBlockingEditor = registry?.registerBlockingEditor;
  useEffect(() => {
    if (!active || !registerBlockingEditor) return undefined;
    return registerBlockingEditor(id, dockTransferable);
  }, [active, id, dockTransferable, registerBlockingEditor]);
}
