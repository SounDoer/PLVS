import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { useAudioDevices } from "../hooks/useAudioDevices.js";
import { automaticOutputChangeNotice } from "../lib/captureHealth.js";
import { errorDetails } from "../lib/errorDetails.js";
import { formatAudioDeviceLabel } from "@/lib/audioDeviceLabels.js";
import { isTauri } from "../ipc/env.js";
import { isWindows } from "../lib/platform.js";
import { isSourceMixId } from "../lib/sourceMixes.js";
import { findDeviceSource } from "../lib/channelSources.js";
import { usesTransactionalPersistence } from "../persistence/index.js";
import { useSourceMixes } from "../hooks/useSourceMixes.js";
import { useMeterDisplayState, useMeterRuntime } from "./MeterRuntimeContext.jsx";

/**
 * @typedef {ReturnType<typeof useAudioDevices> & {
 *   audioOutputs: any[],
 *   audioInputs: any[],
 *   onSelectCaptureDevice: (deviceId: string) => Promise<boolean>,
 *   captureFormatSignature: string,
 *   captureDeviceUnavailable: boolean,
 *   sourceMixes: ReturnType<typeof useSourceMixes>,
 *   mixApplicationIds: string[] | undefined,
 *   mixInput: { id: string, channels: number[], mode?: "sum" } | undefined,
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
    refreshCaptureApplications,
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
        return true;
      } catch (error) {
        raiseNotice(
          "error",
          "Could not switch the audio device.",
          errorDetails("Device selection failed", error),
          { helpTopic: "audio-capture" }
        );
        return false;
      }
    },
    [clearNotice, raiseNotice, selectCaptureDevice]
  );

  const sourceMixes = useSourceMixes({
    supported: isTauri() && isWindows() && usesTransactionalPersistence,
    onSelect: onSelectCaptureDevice,
    onError: (message, error) => raiseNotice("error", message, errorDetails(message, error)),
  });
  const selectedMix = sourceMixes.supported
    ? sourceMixes.list.find(({ id }) => id === captureDeviceId)
    : null;
  const selectionIsMix = isSourceMixId(captureDeviceId);
  const mixMembers = selectedMix
    ? JSON.stringify(selectedMix.members.map(({ id }) => id).sort())
    : "";
  const mixApplicationIds = useMemo(
    () => (mixMembers ? JSON.parse(mixMembers) : undefined),
    [mixMembers]
  );
  const inputSignature = selectedMix?.input
    ? JSON.stringify({
        id: selectedMix.input.id,
        channels: selectedMix.input.channels,
        mode: selectedMix.input.mode,
      })
    : "";
  const mixInput = useMemo(
    () => (inputSignature ? JSON.parse(inputSignature) : undefined),
    [inputSignature]
  );
  const editingMix = sourceMixes.draft !== null;
  useEffect(() => {
    if (!editingMix || selectionIsMix || captureDeviceId.startsWith("app-")) return;
    const timer = window.setInterval(() => void refreshCaptureApplications(), 2_000);
    return () => window.clearInterval(timer);
  }, [captureDeviceId, editingMix, refreshCaptureApplications, selectionIsMix]);

  const captureFormatSignature = useMemo(() => {
    if (!isTauri()) return "";
    if (selectionIsMix) return mixMembers ? `2:48000|${mixMembers}|${inputSignature}` : "";
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
    const d = findDeviceSource(audioDevices, captureDeviceId);
    return d
      ? `${d.channels}:${d.defaultSampleRate}${d.monitorSignature ? `|${d.monitorSignature}` : ""}`
      : "";
  }, [
    captureDeviceId,
    audioDevices,
    captureApplications,
    defaultOutputFormatSig,
    selectionIsMix,
    mixMembers,
    inputSignature,
  ]);
  const captureDeviceUnavailable = selectionIsMix
    ? !selectedMix
    : devices.snapshot.inventoryReady &&
      captureDeviceId !== "default" &&
      !/^app-[0-9a-f]{32}$/.test(captureDeviceId) &&
      !captureFormatSignature;

  const selectedSource = useMemo(() => {
    if (!isTauri()) return null;
    if (selectedMix) return { type: "Mix", label: selectedMix.name };
    if (captureDeviceId === "default") {
      const label =
        defaultOutputLabel || audioDevices.find((device) => device.isSystemOutputMonitor)?.label;
      return label ? { type: "Output", label } : null;
    }
    const application = captureApplications.find((candidate) => candidate.id === captureDeviceId);
    if (application) {
      return { type: "Application", label: application.label };
    }
    const device = findDeviceSource(audioDevices, captureDeviceId);
    if (!device) return null;
    return {
      type: device.isSystemOutputMonitor ? "Output" : "Input",
      label: device.parentId
        ? `${formatAudioDeviceLabel(audioDevices.find(({ id }) => id === device.parentId)?.label ?? device.label).primary} · ${device.channelLabel}`
        : device.label,
    };
  }, [captureDeviceId, audioDevices, captureApplications, defaultOutputLabel, selectedMix]);
  const sourceDisplayName = useMemo(() => {
    if (!selectedSource) return null;
    if (
      selectedSource.type === "Application" ||
      selectedSource.type === "Mix" ||
      captureDeviceId.startsWith("ch:")
    )
      return selectedSource.label;
    const display = formatAudioDeviceLabel(selectedSource.label);
    return display.secondary || display.primary;
  }, [selectedSource, captureDeviceId]);
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
        captureDeviceUnavailable,
        sourceMixes,
        mixApplicationIds,
        mixInput,
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
