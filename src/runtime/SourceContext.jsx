import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useAudioDevices } from "../hooks/useAudioDevices.js";
import { automaticOutputChangeNotice } from "../lib/captureHealth.js";
import { errorDetails } from "../lib/errorDetails.js";
import { formatAudioDeviceLabel } from "@/lib/audioDeviceLabels.js";
import { isTauri } from "../ipc/env.js";
import { useMeterDisplayState, useMeterRuntime } from "./MeterRuntimeContext.jsx";

/**
 * @typedef {ReturnType<typeof useAudioDevices> & {
 *   audioOutputs: any[],
 *   audioInputs: any[],
 *   onSelectCaptureDevice: (deviceId: string) => Promise<void>,
 *   captureFormatSignature: string,
 *   selectedSource: { type: string, label: string } | null,
 *   sourceDisplayName: string | null,
 *   footerSourceLabel: string,
 * }} SourceOwner
 */
const SourceContext = createContext(/** @type {SourceOwner | null} */ (null));

/** The capture source: the device inventory, the selection, and the labels derived from it. */
export function SourceProvider({ children }) {
  const { sourceMode, running, liveLifecycle, beginDeviceRestartForControl } = useMeterRuntime();
  const { clearNotice, raiseNotice } = useMeterDisplayState();

  const devices = useAudioDevices({ liveLifecycle, beginDeviceRestartForControl });
  const {
    audioDevices,
    captureApplications,
    captureDeviceId,
    selectCaptureDevice,
    defaultOutputFormatSig,
    defaultOutputLabel,
  } = devices;

  const audioOutputs = useMemo(
    () => (audioDevices || []).filter((d) => d.isSystemOutputMonitor),
    [audioDevices]
  );
  const audioInputs = useMemo(
    () => (audioDevices || []).filter((d) => !d.isSystemOutputMonitor),
    [audioDevices]
  );

  const onSelectCaptureDevice = useCallback(
    async (deviceId) => {
      clearNotice();
      try {
        await selectCaptureDevice(deviceId);
      } catch (error) {
        raiseNotice(
          "error",
          "Could not switch the audio device.",
          errorDetails("Device selection failed", error)
        );
      }
    },
    [clearNotice, raiseNotice, selectCaptureDevice]
  );

  const captureFormatSignature = useMemo(() => {
    if (!isTauri()) return "";
    if (/^app-[0-9a-f]{32}$/.test(captureDeviceId)) {
      const application = captureApplications.find((candidate) => candidate.id === captureDeviceId);
      const processSignature = application?.processIds?.length
        ? application.processIds.join(",")
        : (application?.processId ?? "missing");
      return `${defaultOutputFormatSig || "2:48000"}|pid:${processSignature}`;
    }
    if (captureDeviceId === "default") {
      return defaultOutputFormatSig || "";
    }
    const d = audioDevices.find((x) => x.id === captureDeviceId);
    return d ? `${d.channels}:${d.defaultSampleRate}` : "";
  }, [captureDeviceId, audioDevices, captureApplications, defaultOutputFormatSig]);

  const selectedSource = useMemo(() => {
    if (!isTauri()) return null;
    if (captureDeviceId === "default") {
      const label =
        defaultOutputLabel || audioDevices.find((device) => device.isSystemOutputMonitor)?.label;
      return label ? { type: "Output", label } : null;
    }
    const application = captureApplications.find((candidate) => candidate.id === captureDeviceId);
    if (application) {
      return { type: "Application", label: application.label };
    }
    const device = audioDevices.find((candidate) => candidate.id === captureDeviceId);
    if (!device) return null;
    return {
      type: device.isSystemOutputMonitor ? "Output" : "Input",
      label: device.label,
    };
  }, [captureDeviceId, audioDevices, captureApplications, defaultOutputLabel]);
  const sourceDisplayName = useMemo(() => {
    if (!selectedSource) return null;
    if (selectedSource.type === "Application") return selectedSource.label;
    const display = formatAudioDeviceLabel(selectedSource.label);
    return display.secondary || display.primary;
  }, [selectedSource]);
  // The restart itself is driven by `captureFormatSignature`; this only tells the user why their
  // measurement just started over.
  const previousDefaultOutputLabelRef = useRef(defaultOutputLabel);
  useEffect(() => {
    const previousLabel = previousDefaultOutputLabelRef.current;
    previousDefaultOutputLabelRef.current = defaultOutputLabel;
    const notice = automaticOutputChangeNotice({
      previousLabel,
      nextLabel: defaultOutputLabel,
      captureDeviceId,
      sourceMode,
      running,
    });
    if (notice) raiseNotice("info", notice.text, notice.details);
    // Only a change of the resolved default output announces itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultOutputLabel]);
  const footerSourceLabel =
    selectedSource && sourceDisplayName
      ? `${selectedSource.type} · ${sourceDisplayName}`
      : "Not connected";

  return (
    <SourceContext.Provider
      value={{
        ...devices,
        audioOutputs,
        audioInputs,
        onSelectCaptureDevice,
        captureFormatSignature,
        selectedSource,
        sourceDisplayName,
        footerSourceLabel,
      }}
    >
      {children}
    </SourceContext.Provider>
  );
}

export function useSource() {
  const source = useContext(SourceContext);
  if (!source) throw new Error("useSource must be used inside SourceProvider");
  return source;
}
