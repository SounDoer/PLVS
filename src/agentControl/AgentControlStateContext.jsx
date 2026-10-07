import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { getVisualCaptureCapabilities } from "../ipc/commands.js";
import { readAgentControlRuntime } from "./appSnapshot.js";

/**
 * @typedef {{
 *   runtime: ReturnType<typeof readAgentControlRuntime>,
 *   enabled: boolean,
 *   setEnabled: (enabled: boolean) => void,
 *   platformCapabilities: any,
 *   recordingState: any,
 *   setRecordingState: (state: any) => void,
 * }} AgentControlState
 */
const AgentControlStateContext = createContext(/** @type {AgentControlState | null} */ (null));

/**
 * The Agent Control state two parties share: the bridge, and the shell that shows the recording
 * indicator and hosts the Settings switch. Everything else Agent Control needs it reads from the
 * domain owners.
 */
export function AgentControlStateProvider({ children }) {
  const runtime = useMemo(readAgentControlRuntime, []);
  const [platformCapabilities, setPlatformCapabilities] = useState(null);
  const [recordingState, setRecordingState] = useState(null);
  useEffect(() => {
    if (runtime.available !== true) return undefined;
    let cancelled = false;
    getVisualCaptureCapabilities()
      .then((capabilities) => {
        if (!cancelled) setPlatformCapabilities(capabilities);
      })
      .catch(() => {
        if (!cancelled) {
          setPlatformCapabilities({
            platform: runtime.platform ?? "unknown",
            screenshot: { available: false, targets: [] },
            recording: { available: false, targets: [], audioSources: [], cursorModes: [] },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [runtime]);
  const [enabled, setEnabled] = useState(() => runtime.enabled === true);

  const value = useMemo(
    () => ({
      runtime,
      enabled,
      setEnabled,
      platformCapabilities,
      recordingState,
      setRecordingState,
    }),
    [enabled, platformCapabilities, recordingState, runtime]
  );
  return (
    <AgentControlStateContext.Provider value={value}>{children}</AgentControlStateContext.Provider>
  );
}

export function useAgentControlState() {
  const state = useContext(AgentControlStateContext);
  if (!state) {
    throw new Error("useAgentControlState must be used inside AgentControlStateProvider");
  }
  return state;
}
