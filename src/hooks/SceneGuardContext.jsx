import { createContext, useCallback, useContext, useMemo } from "react";
import { useMeterRuntime } from "../runtime/MeterRuntimeContext.jsx";
import { useBlockingEditors } from "./BlockingEditorsContext.jsx";
import {
  SceneOperationUnavailableError,
  sceneOperationUnavailableReason,
} from "../lib/sceneOperations.js";

/**
 * @typedef {{
 *   activeBlockingEditors: readonly string[],
 *   assertSceneOperationAllowed: (operation: string) => void,
 * }} SceneGuard
 */
const SceneGuardContext = createContext(/** @type {SceneGuard | null} */ (null));

/**
 * The scene guard. Every operation that captures, replaces or tears down the current editing
 * scene -- preset apply / save / update, dock entry -- asks it first. See
 * `hooks/BlockingEditorsContext.jsx` for the editor half.
 *
 * Composed here because the two rules have different owners: the registry knows which editors are
 * open, and the metering runtime knows the source mode. Everything downstream asks one function,
 * so an entry point cannot pick up one rule and miss the other.
 */
export function SceneGuardProvider({ children }) {
  const { sourceMode } = useMeterRuntime();
  const { activeBlockingEditors, assertSceneOperationAllowed: assertNoBlockingEditor } =
    useBlockingEditors();
  // FILE mode forbids the dock outright: it is a state conflict, not a missing capability, so it
  // refuses rather than degrading the way a platform without dock support does. Enforced here and
  // not only on the disabled Dock control, so every entry point -- Agent Control included -- gets
  // the same answer.
  const assertSceneOperationAllowed = useCallback(
    (/** @type {string} */ operation) => {
      assertNoBlockingEditor(operation);
      const reason = sceneOperationUnavailableReason(operation, { sourceMode });
      if (reason) throw new SceneOperationUnavailableError(operation, reason);
    },
    [assertNoBlockingEditor, sourceMode]
  );
  const value = useMemo(
    () => ({ activeBlockingEditors, assertSceneOperationAllowed }),
    [activeBlockingEditors, assertSceneOperationAllowed]
  );
  return <SceneGuardContext.Provider value={value}>{children}</SceneGuardContext.Provider>;
}

/// Throws outside the provider for the reason `useBlockingEditors` does: a guard that silently
/// allows everything looks exactly like a guard that is running.
export function useSceneGuard() {
  const value = useContext(SceneGuardContext);
  if (!value) throw new Error("useSceneGuard must be used inside SceneGuardProvider");
  return value;
}
