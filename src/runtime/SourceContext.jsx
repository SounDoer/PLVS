import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAudioDevices } from "../hooks/useAudioDevices.js";
import { automaticOutputChangeNotice } from "../lib/captureHealth.js";
import { errorDetails } from "../lib/errorDetails.js";
import { formatAudioDeviceLabel } from "@/lib/audioDeviceLabels.js";
import { isTauri } from "../ipc/env.js";
import { isLinux, isMacOS, isWindows } from "../lib/platform.js";
import { compileMixRouting, mixInputs, resolveMixFormat } from "../lib/mixRouting.js";
import { canSaveSourceMix, isSourceMixId, sourceMixName } from "../lib/sourceMixes.js";
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
 *   captureApplicationUnavailable: boolean,
 *   captureRuntimeDeviceId: string,
 *   mixPreviewActive: boolean,
 *   sourceMixes: ReturnType<typeof useSourceMixes>,
 *   mixApplicationIds: string[] | undefined,
 *   mixOutputId: string | undefined,
 *   mixCaptureInputs: { id: string, channels: number[] }[] | undefined,
 *   mixRouting: ReturnType<typeof compileMixRouting> | undefined,
 *   selectedSource: { type: string, label: string } | null,
 *   sourceDisplayName: string | null,
 *   footerSourceLabel: string,
 * }} SourceOwner
 */
const SourceContext = createContext(/** @type {SourceOwner | null} */ (null));

function mixCapturePlan(mix, outputs, defaultReference) {
  if (!mix || !canSaveSourceMix(mix)) return null;
  const routing = compileMixRouting(mix, outputs, defaultReference);
  if (!routing) return null;
  return {
    members: mix.members.map(({ id }) => id).sort(),
    inputs: mixInputs(mix).map(({ id, channels }) => ({ id, channels })),
    outputId: mix.output?.id,
    routing,
  };
}

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
    defaultOutputReference,
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
    supported: isTauri() && (isWindows() || isMacOS() || isLinux()) && usesTransactionalPersistence,
    onSelect: onSelectCaptureDevice,
    onError: (message, error) => raiseNotice("error", message, errorDetails(message, error)),
  });
  const selectedMix = sourceMixes.supported
    ? sourceMixes.list.find(({ id }) => id === captureDeviceId)
    : null;
  const lastMixReference = useRef(new Map());
  let savedPlan = null;
  let savedSelection = selectedMix;
  if (selectedMix) {
    const previous = lastMixReference.current.get(selectedMix.id);
    const liveOutput = audioOutputs.find(({ id }) => id === selectedMix.output?.id);
    const selection = {
      ...selectedMix,
      referenceRoles: previous?.referenceRoles ?? selectedMix.referenceRoles,
      output: selectedMix.output && {
        ...selectedMix.output,
        roles: liveOutput?.mixOutputRoles ?? previous?.outputRoles ?? selectedMix.output.roles,
      },
    };
    const resolved = resolveMixFormat(selection, audioOutputs, defaultOutputReference);
    lastMixReference.current.set(selectedMix.id, {
      referenceRoles:
        resolved.id === "follow" && !resolved.fallback ? resolved.roles : previous?.referenceRoles,
      outputRoles: selection.output?.roles,
    });
    savedSelection = selection;
    savedPlan = mixCapturePlan(selection, audioOutputs, defaultOutputReference);
  }

  const draft = sourceMode === "live" ? sourceMixes.draft : null;
  const draftId = draft?.id ?? draft?.previewId;
  const draftSelection =
    draft && draft.id && draft.id === savedSelection?.id
      ? {
          ...draft,
          referenceRoles: savedSelection.referenceRoles,
          output:
            draft.output?.id === savedSelection.output?.id ? savedSelection.output : draft.output,
        }
      : draft;
  const draftPlan =
    draftSelection && mixCapturePlan(draftSelection, audioOutputs, defaultOutputReference);
  const originalPlan =
    draft?.id === selectedMix?.id
      ? savedPlan
      : mixCapturePlan(draft?.original, audioOutputs, defaultOutputReference);
  const draftSignature = draftPlan && JSON.stringify(draftPlan);
  const changedPreview =
    draftSignature && draftSignature !== JSON.stringify(originalPlan) ? draftSignature : null;
  const [lastPreview, setLastPreview] = useState({ id: undefined, signature: null });
  // A draft can be temporarily unroutable while changing layout or membership. Keep auditioning
  // the last valid edit until the draft is repaired, closed, or the Workbench leaves Live mode.
  if (lastPreview.id !== draftId || (draftPlan && lastPreview.signature !== changedPreview)) {
    setLastPreview({ id: draftId, signature: changedPreview });
  }
  const previewSignature =
    draftId &&
    (draftPlan ? changedPreview : lastPreview.id === draftId ? lastPreview.signature : null);
  const mixPreviewActive = running && Boolean(previewSignature);
  const captureRuntimeDeviceId = previewSignature ? draftId : captureDeviceId;
  const selectionIsMix = isSourceMixId(captureRuntimeDeviceId);
  const routingSignature = previewSignature || (savedPlan && JSON.stringify(savedPlan));
  const plan = useMemo(
    () => (routingSignature ? JSON.parse(routingSignature) : null),
    [routingSignature]
  );
  const mixApplicationIds = plan?.members;
  const mixCaptureInputs = plan?.inputs;
  const mixRouting = plan?.routing ?? (selectionIsMix ? null : undefined);
  const mixOutputId = plan?.outputId;
  const editingMix = sourceMixes.draft !== null;
  useEffect(() => {
    if (!editingMix || selectionIsMix || captureDeviceId.startsWith("app-")) return;
    const timer = window.setInterval(() => void refreshCaptureApplications(), 2_000);
    return () => window.clearInterval(timer);
  }, [captureDeviceId, editingMix, refreshCaptureApplications, selectionIsMix]);

  const captureFormatSignature = useMemo(() => {
    if (!isTauri()) return "";
    if (selectionIsMix) return routingSignature ? `2:48000|${routingSignature}` : "";
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
    const d = audioDevices.find(({ id }) => id === captureDeviceId);
    return d
      ? `${d.channels}:${d.defaultSampleRate}${d.monitorSignature ? `|${d.monitorSignature}` : ""}`
      : "";
  }, [
    captureDeviceId,
    audioDevices,
    captureApplications,
    defaultOutputFormatSig,
    selectionIsMix,
    routingSignature,
  ]);
  const captureDeviceUnavailable = selectionIsMix
    ? !plan
    : devices.snapshot.inventoryReady &&
      captureDeviceId !== "default" &&
      !/^app-[0-9a-f]{32}$/.test(captureDeviceId) &&
      !captureFormatSignature;
  const captureApplicationUnavailable =
    /^app-[0-9a-f]{32}$/.test(captureDeviceId) &&
    !captureApplications.some((application) => application.id === captureDeviceId);

  const selectedSource = useMemo(() => {
    if (!isTauri()) return null;
    if (mixPreviewActive && draft) return { type: "Mix", label: sourceMixName(draft) };
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
    const device = audioDevices.find(({ id }) => id === captureDeviceId);
    if (!device) return null;
    return {
      type: device.isSystemOutputMonitor ? "Output" : "Input",
      label: device.label,
    };
  }, [
    captureDeviceId,
    audioDevices,
    captureApplications,
    defaultOutputLabel,
    selectedMix,
    mixPreviewActive,
    draft,
  ]);
  const sourceDisplayName = useMemo(() => {
    if (!selectedSource) return null;
    if (selectedSource.type === "Application" || selectedSource.type === "Mix")
      return selectedSource.label;
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
        captureDeviceUnavailable,
        captureApplicationUnavailable,
        captureRuntimeDeviceId,
        mixPreviewActive,
        sourceMixes,
        mixApplicationIds,
        mixCaptureInputs,
        mixRouting,
        mixOutputId,
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
