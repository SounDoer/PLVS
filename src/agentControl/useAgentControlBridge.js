import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  announceAgentControlFrontendNotReady,
  announceAgentControlFrontendReady,
  listenForAgentControlRequests,
  respondToAgentControlRequest,
} from "../ipc/agentControlEvents.js";
import { flushPersistence, settingsStore } from "../persistence/index.js";
import { exportProfile, importProfile, reloadAfterProfileChange } from "../persistence/profile.js";
import { normalizeImportedProfile, ProfileValidationError } from "../persistence/profileShape.js";
import { parseSelection } from "../lib/loudnessProfileCatalog.js";
import { normalizeRuleDocument } from "../lib/loudnessProfileNormalize.js";
import { presetWorkspaceView } from "../lib/presetWorkspaceView.js";
import { isSceneOperationRefused } from "../lib/sceneOperations.js";
import {
  agentControlRpcError,
  DEVICE_CONTROL_METHODS,
  isTransportAction,
  normalizeAgentControlRequest,
} from "./protocol.js";
import { buildDeviceInspection, buildDeviceList, planDeviceSelection } from "./deviceControl.js";
import {
  buildAxisInspection,
  buildAxisSchema,
  planPanelAxisReset,
  planPanelAxisUpdate,
  planSharedAxisReset,
  planSharedAxisUpdate,
} from "./axisControl.js";
import {
  buildAgentControlCapabilities,
  buildAgentControlPanelSnapshot,
  buildAgentControlSnapshot,
} from "./appSnapshot.js";
import { planPublicPanelControlPatch, planPublicPanelReset } from "./panelControlPatch.js";
import { buildPublicPanelControlSchema } from "./panelControlSchema.js";
import { buildPublicPresetSnapshot } from "./presetSnapshot.js";
import { buildMeasurementDescription, buildMeasurementInspection } from "./measurementControl.js";
import { planPresetDelete, planPresetRename, planPresetReorder } from "./presetLibrary.js";
import {
  buildLibraryList,
  libraryFamily,
  planLibraryExport,
  planLibraryImport,
} from "./libraryTransfer.js";
import { PackValidationError } from "../transfer/packShape.js";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import { listThemeSummaries } from "../theme/themeLibrary.js";
import { normalizeThemeV2 } from "../theme/themeSchema.js";
import {
  planPresetApply,
  planPresetApplyResources,
  planPresetSave,
  planPresetUpdate,
} from "./presetScene.js";
import {
  buildSettingsInspection,
  buildSettingsSchema,
  planSettingsUpdate,
} from "./settingsControl.js";
import {
  planTransportMutation,
  projectTransportMutation,
  transportLifecycleSignature,
} from "./transportControl.js";
import {
  buildDockDescription,
  buildDockPanelDescription,
  buildDockSnapshot,
  compileDockLayout,
  dockStateSignature,
  planDockFormMutation,
  planDockPanelPatch,
  planDockPanelReset,
} from "./dockControl.js";
import {
  compileWorkspaceLayout,
  serializeWorkspaceLayout,
  WorkspaceLayoutError,
} from "./workspaceLayout.js";

function semanticFailure(reason, path, message, code, details) {
  return { reason, path, message, code, ...(details ? { details } : {}) };
}

function workspaceMatches(workspace, view) {
  return (
    workspace.tree === view.tree &&
    workspace.panelsById === view.panelsById &&
    workspace.panelOrder === view.panelOrder
  );
}

function panelControlsMatch(workspace, view, panelId) {
  return (
    JSON.stringify(workspace.panelControlsById?.[panelId]) ===
    JSON.stringify(view.panelControlsById?.[panelId])
  );
}

function axisStateMatches(workspace, view) {
  return (
    JSON.stringify(workspace.axisViewports) === JSON.stringify(view.axisViewports) &&
    JSON.stringify(workspace.panelControlsById) === JSON.stringify(view.panelControlsById)
  );
}

function panelResultPreset(presets, changed) {
  const activeId = typeof presets?.activeId === "string" ? presets.activeId : null;
  return {
    activeId,
    dirty: presets?.dirty === true || (activeId !== null && changed.length > 0),
  };
}

function controllableWorkspaceMatches(left, right) {
  return (
    left.tree === right.tree &&
    left.panelsById === right.panelsById &&
    left.panelOrder === right.panelOrder &&
    left.panelControlsById === right.panelControlsById &&
    left.pinnedPanelsById === right.pinnedPanelsById &&
    left.axisViewports === right.axisViewports
  );
}

function presetStateSignature(presets) {
  return JSON.stringify({
    list: Array.isArray(presets?.list) ? presets.list : [],
    activeId: typeof presets?.activeId === "string" ? presets.activeId : null,
    dirty: presets?.dirty === true,
  });
}

function themeStateSignature(state) {
  return JSON.stringify({
    appearance: {
      mode: state?.appearance?.mode,
      selectedThemeId:
        state?.appearance?.mode === "fixed" ? (state.appearance.selectedThemeId ?? null) : null,
    },
    themes: (Array.isArray(state?.themes) ? state.themes : [])
      .map((theme) => normalizeThemeV2(theme))
      .filter(Boolean),
  });
}

function compactThemeState(state) {
  return {
    appearance: state.appearance,
    themes: listThemeSummaries(state),
  };
}

function themePlanResult(method, planned) {
  if (method === "theme.select" || method === "theme.followSystem") {
    return {
      previousAppearance: planned.previousAppearance,
      appearance: planned.appearance,
    };
  }
  if (method === "theme.create") {
    return {
      document: planned.document,
      selectCreated: true,
      ...(planned.theme ? { theme: planned.theme } : {}),
    };
  }
  if (method === "theme.duplicate") {
    return {
      source: planned.source,
      name: planned.name,
      selectCreated: true,
      ...(planned.theme ? { theme: planned.theme } : {}),
    };
  }
  if (method === "theme.delete") {
    return {
      deletedTheme: planned.deletedTheme,
      ...(planned.fallbackThemeId ? { fallbackThemeId: planned.fallbackThemeId } : {}),
    };
  }
  if (method === "theme.reorder") return { themeIds: planned.themeIds };
  return { theme: planned.theme };
}

function loudnessProfileStateSignature(profiles, activeSelection) {
  const normalizedProfiles = (Array.isArray(profiles) ? profiles : [])
    .map((profile) => normalizeRuleDocument(profile))
    .filter(Boolean);
  return JSON.stringify({
    activeId: activeLoudnessProfileId(normalizedProfiles, activeSelection),
    profiles: normalizedProfiles,
  });
}

/// The live Loudness Profile selection, as `loudnessProfile.list` reports it. Off is null, and so
/// is a selection pointing at a profile the library no longer holds.
///
/// Read from `plvs:settings` rather than a prop: the bridge is handed the profile *library*
/// (`loudnessProfiles`) and never the selection, and `LoudnessProfileContext` writes every
/// selection change straight through to that store. It is also where the loudness adapter reads
/// the library from, so both halves of this result come from one source.
function activeLoudnessProfileId(
  profiles,
  selection = settingsStore.read().loudnessProfiles?.active
) {
  const { id } = parseSelection(selection);
  return id !== null && profiles.some((profile) => profile.id === id) ? id : null;
}

function compactLoudnessProfileState(state, previewDocument = null) {
  const profiles = state.profiles.map(({ id, name }) => ({ id, name }));
  if (previewDocument) profiles.push({ id: null, name: previewDocument.name });
  return {
    profiles,
    activeId: previewDocument ? null : activeLoudnessProfileId(state.profiles, state.active),
  };
}

/// Compares the live Workspace against the view a Preset becomes once applied.
///
/// Never compare against the stored Preset itself: applying migrates its controls, so a Preset
/// saved before a control was added or removed can never equal the Workspace it produces, and a
/// settlement waiting on that equality would never fire.
function workspaceMatchesPresetView(workspace, view) {
  return [
    "tree",
    "panelsById",
    "panelOrder",
    "panelControlsById",
    "pinnedPanelsById",
    "axisViewports",
  ].every((key) => JSON.stringify(workspace[key]) === JSON.stringify(view[key]));
}

function settingsStateForSignature(settings) {
  if (!settings) return null;
  return {
    ...settings,
    channelLabels: {
      mode: settings.channelLabels?.mode,
      ...(settings.channelLabels?.mode === "custom" ? { roles: settings.channelLabels.roles } : {}),
    },
  };
}

function settingsStateSignature(settings) {
  return JSON.stringify(settingsStateForSignature(settings));
}

function ordinarySettingsStateSignature(settings) {
  const normalized = settingsStateForSignature(settings);
  if (normalized === null) return "null";
  const { openAtLogin: _openAtLogin, clearShortcut: _clearShortcut, ...ordinary } = normalized;
  return JSON.stringify(ordinary);
}

function requestedDeviceSignature(device) {
  return device?.snapshot?.requestedId ?? "default";
}

function deviceInspection(device, requestedId = device?.snapshot?.requestedId) {
  return buildDeviceInspection(
    { ...device.snapshot, requestedId },
    {
      ...device.live,
      usingRequestedSelection:
        requestedId === device.snapshot.requestedId
          ? device.live?.usingRequestedSelection
          : device.live?.state === "running",
    }
  );
}

/// A settlement waits only for React to render a change that has already been applied, so anything
/// near a second means the predicate will never match. Kept well under the broker's own budget so
/// the caller gets this specific failure instead of a transport timeout.
const SETTLEMENT_TIMEOUT_MS = 5000;

/// Bounds a settlement wait.
///
/// Without this a predicate that can never match hangs the request forever - and because commands
/// share one serialized queue, every later command hangs behind it and the whole control channel is
/// dead until the app restarts. A timeout turns that into one failed command with a stated cause.
const COMMIT_NOT_OBSERVED = "commitNotObserved";

function isCommitNotObserved(error) {
  return error?.reason === COMMIT_NOT_OBSERVED;
}

/// Persists the write a settlement timeout is reporting on, and says in the failure whether that
/// worked.
///
/// Every mutation handler writes its state first and calls `flush()` only after the settlement, so
/// a timeout used to skip persistence entirely: the change was live in memory, absent from
/// `plvs-settings.json`, and the failure still said `stateCommitted: true`. Three hand-made themes
/// were lost that way. The failure stays `commitNotObserved` -- that React never observed the
/// commit is the more informative fact, and calling it `persistenceFailed` would bury it -- so
/// `persisted` is what tells the two outcomes apart.
async function persistUnobservedCommit(error, flush) {
  try {
    await flush();
  } catch (persistenceError) {
    return {
      ...error,
      message: `${error.message} Persisting it then failed: ${persistenceError?.message || String(persistenceError)}.`,
      details: { ...error.details, persisted: false },
    };
  }
  return {
    ...error,
    message: `${error.message} The change was persisted.`,
    details: { ...error.details, persisted: true },
  };
}

function awaitSettlement(committed, clear, subject) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      clear();
      reject(
        semanticFailure(
          COMMIT_NOT_OBSERVED,
          "$",
          `${subject} was applied but the commit was not observed within ${SETTLEMENT_TIMEOUT_MS} ms.`,
          -32031,
          { stateCommitted: true }
        )
      );
    }, SETTLEMENT_TIMEOUT_MS);
    committed.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

const WAIT_CANCELLED = Symbol("waitCancelled");

function isDifferentPublishedMeasurement(live, afterGeneration, afterSequence) {
  const sequence = live?.record?.sequence;
  if (!Number.isSafeInteger(sequence)) return false;
  return live.generation !== afterGeneration || sequence !== (afterSequence ?? null);
}

function transportMutationMatches(method, params, execution, snapshot) {
  const sessionId = execution?.sessionId ?? params.sessionId;
  if (method === "transport.source.live") {
    return snapshot.source === "live" && snapshot.files.analyzingId === null;
  }
  if (method === "transport.source.file") return snapshot.source === "file";
  if (method === "transport.live.start") {
    return snapshot.source === "live" && snapshot.live.state === "running";
  }
  if (method === "transport.live.stop") return snapshot.live.state === "stopped";
  if (method === "transport.file.analyze" || method === "transport.file.reanalyze") {
    return (
      snapshot.source === "file" &&
      snapshot.files.analyzingId === sessionId &&
      snapshot.files.sessions.some(
        (session) => session.id === sessionId && ["probing", "analyzing"].includes(session.state)
      )
    );
  }
  if (method === "transport.file.stop") {
    return (
      snapshot.files.analyzingId !== sessionId &&
      snapshot.files.sessions.some(
        (session) => session.id === sessionId && session.state === "stopped"
      )
    );
  }
  if (method === "transport.file.select") {
    return snapshot.source === "file" && snapshot.files.activeId === sessionId;
  }
  if (method === "transport.file.remove") {
    return !snapshot.files.sessions.some((session) => session.id === sessionId);
  }
  if (method === "transport.file.clear") return snapshot.files.sessions.length === 0;
  return false;
}

export function useAgentControlBridge({
  enabled,
  runtime,
  workspace,
  replaceWorkspace,
  setPanelControlsForPanel,
  waitForWorkspacePersistenceEnqueue,
  presets,
  settings,
  settingsContext = {},
  applySettings = async () => {},
  transport,
  transportContext = {},
  executeTransport = async () => ({}),
  device = null,
  dock,
  dockContext = {},
  executeDock = async () => {},
  loudnessProfiles: loudnessProfilesInput = [],
  loudnessProfile = null,
  customThemes = {},
  theme = null,
  hasLoudnessReference = false,
  analysisContext = {},
  measurementContext = {},
  flush = flushPersistence,
  exportConfiguration = exportProfile,
  importConfiguration = importProfile,
  normalizeConfiguration = normalizeImportedProfile,
  relaunchAfterConfigurationChange = reloadAfterProfileChange,
}) {
  const loudnessProfiles = loudnessProfile?.profiles ?? loudnessProfilesInput;
  const loudnessActive = loudnessProfile?.active;
  const providedThemeState = theme?.state;
  const themeState = useMemo(
    () =>
      providedThemeState ?? {
        appearance: { mode: "system", selectedThemeId: null, resolvedThemeId: "plvs-dark" },
        themes: Object.values(customThemes ?? {}),
      },
    [customThemes, providedThemeState]
  );
  const themeControl = theme?.control ?? null;
  const themeSignature = themeStateSignature(themeState);
  const latestThemeRef = useRef({ state: themeState, control: themeControl });
  const latestMeasurementContextRef = useRef(measurementContext);
  const latestMeasurementProfileRef = useRef({ active: loudnessActive, profile: loudnessProfile });
  const aliveRef = useRef(false);
  const controlRevisionRef = useRef(0);
  const controlRevisionBumpedThisTurnRef = useRef(false);
  const previousWorkspaceRef = useRef(workspace);
  const previousPresetsSignatureRef = useRef(presetStateSignature(presets));
  const previousThemeStateSignatureRef = useRef(themeSignature);
  const loudnessSignature = loudnessProfileStateSignature(loudnessProfiles, loudnessActive);
  const previousLoudnessLibrarySignatureRef = useRef(loudnessSignature);
  const previousOrdinarySettingsSignatureRef = useRef(ordinarySettingsStateSignature(settings));
  const openAtLoginTrackingRef = useRef({
    ready: settingsContext.autostartReady === true,
    value: settings?.openAtLogin,
  });
  const clearShortcutTrackingRef = useRef({
    ready: settingsContext.clearShortcutReady === true,
    signature: JSON.stringify(settings?.clearShortcut ?? null),
  });
  const settlementRef = useRef(null);
  const presetSettlementRef = useRef(null);
  const librarySettlementRef = useRef(null);
  const loudnessProfileSettlementRef = useRef(null);
  const themeSettlementRef = useRef(null);
  const settingsSettlementRef = useRef(null);
  const previousTransportSignatureRef = useRef(transportLifecycleSignature(transport));
  const latestTransportRef = useRef(transport);
  const transportSettlementRef = useRef(null);
  const latestDeviceRef = useRef(device);
  const previousRequestedDeviceRef = useRef(requestedDeviceSignature(device));
  const deviceSettlementRef = useRef(null);
  const previousDockSignatureRef = useRef(dockStateSignature(dock));
  const latestDockRef = useRef(dock);
  const dockSettlementRef = useRef(null);
  const waitersRef = useRef(new Map());
  const waitWakeScheduledRef = useRef(false);
  const workspaceRevisionBumpedThisTurnRef = useRef(false);
  const revisionBatchRef = useRef(null);
  const processRef = useRef(null);
  const queueRef = useRef(Promise.resolve());

  useEffect(() => {
    latestMeasurementContextRef.current = measurementContext;
    latestMeasurementProfileRef.current = { active: loudnessActive, profile: loudnessProfile };
  }, [loudnessActive, loudnessProfile, measurementContext]);

  const publishWaitWake = useCallback(() => {
    if (waitWakeScheduledRef.current) return;
    waitWakeScheduledRef.current = true;
    queueMicrotask(() => {
      waitWakeScheduledRef.current = false;
      for (const [id, waiter] of waitersRef.current) {
        if (waiter.kind !== "revision") continue;
        if (controlRevisionRef.current === waiter.afterRevision) continue;
        clearTimeout(waiter.timer);
        waitersRef.current.delete(id);
        waiter.resolve({
          outcome: "changed",
          matchedImmediately: false,
          revision: controlRevisionRef.current,
        });
      }
    });
  }, []);
  const scheduleWaitWake = useCallback(() => {
    const batch = revisionBatchRef.current;
    if (batch) {
      batch.wakePending = true;
      return;
    }
    publishWaitWake();
  }, [publishWaitWake]);
  const bumpControlRevision = useCallback(() => {
    const batch = revisionBatchRef.current;
    if (batch) {
      if (batch.bumped) return;
      batch.bumped = true;
      controlRevisionRef.current += 1;
      return;
    }
    if (controlRevisionBumpedThisTurnRef.current) return;
    controlRevisionBumpedThisTurnRef.current = true;
    controlRevisionRef.current += 1;
    queueMicrotask(() => {
      controlRevisionBumpedThisTurnRef.current = false;
    });
  }, []);
  const bumpWorkspaceRevision = useCallback(() => {
    if (workspaceRevisionBumpedThisTurnRef.current) return;
    workspaceRevisionBumpedThisTurnRef.current = true;
    bumpControlRevision();
    queueMicrotask(() => {
      workspaceRevisionBumpedThisTurnRef.current = false;
    });
    scheduleWaitWake();
  }, [bumpControlRevision, scheduleWaitWake]);

  /// Resolved by the watcher for a library the `*.import` in flight actually wrote -- which is
  /// `planLibraryImport`'s `writes`, not the family the request named. A Preset pack can write the
  /// Loudness library alone, and waiting on the Preset watcher there times out on a commit that
  /// succeeded. `commit` writes both stores synchronously, so when it writes two libraries both
  /// watchers fire in the same React commit and the first to arrive is the right answer.
  ///
  /// Import does not bump the revision itself. Every library it can write is watched -- the two
  /// `librarySignature` effects below and the Preset effect -- and each watcher bumps when the
  /// write reaches React. Doing both moved the revision by two for a single import (measured, not
  /// reasoned about: `bumpControlRevision`'s same-turn guard has already reset by the time the
  /// re-render lands). Nothing about that is visible -- no error, an ordinary-looking number --
  /// except that every later `--expected-revision` starts conflicting.
  const resolveLibrarySettlement = useCallback((family) => {
    const settlement = librarySettlementRef.current;
    if (!settlement || !settlement.families.includes(family)) return;
    librarySettlementRef.current = null;
    settlement.resolve(controlRevisionRef.current);
  }, []);

  const observeLoudnessProfileSettlement = useCallback((store, signature) => {
    const settlement = loudnessProfileSettlementRef.current;
    if (!settlement || settlement.expected[store] !== signature) return;
    settlement.observed.add(store);
    if (Object.keys(settlement.expected).every((key) => settlement.observed.has(key))) {
      loudnessProfileSettlementRef.current = null;
      settlement.resolve(controlRevisionRef.current);
    }
  }, []);

  useEffect(() => {
    if (!controllableWorkspaceMatches(previousWorkspaceRef.current, workspace)) {
      previousWorkspaceRef.current = workspace;
      bumpWorkspaceRevision();
    } else {
      previousWorkspaceRef.current = workspace;
    }
    const settlement = settlementRef.current;
    if (settlement && settlement.matches(workspace)) {
      settlementRef.current = null;
      settlement.resolve(controlRevisionRef.current);
    }
  }, [bumpWorkspaceRevision, workspace]);

  useEffect(() => {
    const signature = presetStateSignature(presets);
    if (signature !== previousPresetsSignatureRef.current) {
      previousPresetsSignatureRef.current = signature;
      bumpControlRevision();
      scheduleWaitWake();
      resolveLibrarySettlement("preset");
    }
    const settlement = presetSettlementRef.current;
    if (settlement && signature === settlement.signature) {
      presetSettlementRef.current = null;
      settlement.resolve(controlRevisionRef.current);
    }
    observeLoudnessProfileSettlement("presets", signature);
  }, [
    bumpControlRevision,
    observeLoudnessProfileSettlement,
    presets,
    resolveLibrarySettlement,
    scheduleWaitWake,
  ]);

  useEffect(() => {
    latestThemeRef.current = { state: themeState, control: themeControl };
    if (themeSignature !== previousThemeStateSignatureRef.current) {
      previousThemeStateSignatureRef.current = themeSignature;
      bumpControlRevision();
      scheduleWaitWake();
      resolveLibrarySettlement("theme");
    }
    const settlement = themeSettlementRef.current;
    if (settlement && settlement.signature === themeSignature) {
      themeSettlementRef.current = null;
      settlement.resolve(controlRevisionRef.current);
    }
  }, [
    bumpControlRevision,
    resolveLibrarySettlement,
    scheduleWaitWake,
    themeControl,
    themeSignature,
    themeState,
  ]);

  useEffect(() => {
    if (loudnessSignature !== previousLoudnessLibrarySignatureRef.current) {
      previousLoudnessLibrarySignatureRef.current = loudnessSignature;
      bumpControlRevision();
      scheduleWaitWake();
      resolveLibrarySettlement("loudnessProfile");
    }
    observeLoudnessProfileSettlement("loudnessProfile", loudnessSignature);
  }, [
    bumpControlRevision,
    loudnessSignature,
    observeLoudnessProfileSettlement,
    resolveLibrarySettlement,
    scheduleWaitWake,
  ]);

  useEffect(() => {
    const signature = settingsStateSignature(settings);
    const ordinarySignature = ordinarySettingsStateSignature(settings);
    let changed = false;
    if (ordinarySignature !== previousOrdinarySettingsSignatureRef.current) {
      previousOrdinarySettingsSignatureRef.current = ordinarySignature;
      changed = true;
    }

    const openAtLogin = openAtLoginTrackingRef.current;
    if (settingsContext.autostartReady === true) {
      if (openAtLogin.ready && openAtLogin.value !== settings?.openAtLogin) changed = true;
      openAtLogin.ready = true;
      openAtLogin.value = settings?.openAtLogin;
    } else {
      openAtLogin.ready = false;
    }

    const clearShortcut = clearShortcutTrackingRef.current;
    const clearShortcutSignature = JSON.stringify(settings?.clearShortcut ?? null);
    if (settingsContext.clearShortcutReady === true) {
      if (clearShortcut.ready && clearShortcut.signature !== clearShortcutSignature) changed = true;
      clearShortcut.ready = true;
      clearShortcut.signature = clearShortcutSignature;
    } else {
      clearShortcut.ready = false;
    }

    if (changed) {
      bumpControlRevision();
      scheduleWaitWake();
    }
    const settlement = settingsSettlementRef.current;
    if (settlement && signature === settlement.signature) {
      settingsSettlementRef.current = null;
      settlement.resolve(controlRevisionRef.current);
    }
  }, [
    bumpControlRevision,
    scheduleWaitWake,
    settings,
    settingsContext.autostartReady,
    settingsContext.clearShortcutReady,
  ]);

  useEffect(() => {
    latestTransportRef.current = transport;
    const signature = transportLifecycleSignature(transport);
    if (signature !== previousTransportSignatureRef.current) {
      previousTransportSignatureRef.current = signature;
      bumpControlRevision();
      scheduleWaitWake();
    }
    const settlement = transportSettlementRef.current;
    if (settlement && settlement.matches(transport)) {
      transportSettlementRef.current = null;
      settlement.resolve(controlRevisionRef.current);
    }
  }, [bumpControlRevision, scheduleWaitWake, transport]);

  useEffect(() => {
    latestDeviceRef.current = device;
    const requestedId = requestedDeviceSignature(device);
    if (requestedId !== previousRequestedDeviceRef.current) {
      previousRequestedDeviceRef.current = requestedId;
      bumpControlRevision();
      scheduleWaitWake();
    }
    const settlement = deviceSettlementRef.current;
    if (settlement && requestedId === settlement.requestedId) {
      deviceSettlementRef.current = null;
      settlement.resolve(controlRevisionRef.current);
    }
  }, [bumpControlRevision, device, scheduleWaitWake]);

  useEffect(() => {
    latestDockRef.current = dock;
    const signature = dockStateSignature(dock);
    if (signature !== previousDockSignatureRef.current) {
      previousDockSignatureRef.current = signature;
      bumpWorkspaceRevision();
    }
    const settlement = dockSettlementRef.current;
    if (settlement && settlement.matches(dock)) {
      dockSettlementRef.current = null;
      settlement.resolve(controlRevisionRef.current);
    }
  }, [bumpWorkspaceRevision, dock]);

  useEffect(() => {
    const buildCurrentMeasurement = (liveOverride) => {
      const currentMeasurement = latestMeasurementContextRef.current;
      const currentProfile = latestMeasurementProfileRef.current;
      const live = liveOverride ??
        currentMeasurement.getLiveMeasurement?.() ?? {
          generation: 0,
          record: null,
        };
      const record = live.record ?? null;
      const labels = currentMeasurement.getChannelLabels?.(record) ?? [];
      const selection = parseSelection(currentProfile.active);
      const preview = currentProfile.profile?.draft != null;
      const profileDocument = currentProfile.profile?.document ?? null;
      const profile = profileDocument
        ? {
            mode: preview ? "preview" : "saved",
            id: preview
              ? (currentProfile.profile.draft.editingId ?? null)
              : selection.kind === "profile"
                ? selection.id
                : null,
            name: profileDocument.name ?? null,
            document: profileDocument,
          }
        : null;
      return buildMeasurementInspection({
        revision: controlRevisionRef.current,
        observedAtMs: Date.now(),
        liveState: currentMeasurement.liveState,
        sessionGeneration: live.generation,
        record,
        channelLabels: labels,
        vectorscopeRequest: currentMeasurement.vectorscopeRequests?.[0] ?? null,
        dialogueActive: currentMeasurement.dialogueActive === true,
        profile,
      });
    };
    const buildMeasurementOrFail = (liveOverride) => {
      try {
        return buildCurrentMeasurement(liveOverride);
      } catch (error) {
        throw semanticFailure(
          "measurementSnapshotFailed",
          "$",
          `The LIVE measurement snapshot could not be formed: ${error?.message || String(error)}`,
          -32072
        );
      }
    };

    processRef.current = async (rawRequest) => {
      const normalized = normalizeAgentControlRequest(rawRequest);
      const requestId =
        normalized.ok && normalized.request.id
          ? normalized.request.id
          : typeof rawRequest?.id === "string"
            ? rawRequest.id
            : "";

      if (!normalized.ok) {
        return { requestId, error: agentControlRpcError(normalized.error) };
      }

      const { request } = normalized;
      const revisionBatch =
        request.params.expectedRevision === undefined
          ? null
          : {
              startRevision: controlRevisionRef.current,
              bumped: false,
              wakePending: false,
            };
      if (revisionBatch) revisionBatchRef.current = revisionBatch;
      try {
        if (request.method === "app.capabilities") {
          return {
            requestId,
            result: buildAgentControlCapabilities(runtime, controlRevisionRef.current),
          };
        }
        if (request.method === "measurement.describe") {
          return {
            requestId,
            result: buildMeasurementDescription(controlRevisionRef.current),
          };
        }
        if (request.method === "measurement.inspect") {
          return {
            requestId,
            result: buildMeasurementOrFail(),
          };
        }
        if (request.method === "measurement.wait") {
          const currentMeasurement = latestMeasurementContextRef.current;
          const initialLive = currentMeasurement.getLiveMeasurement?.() ?? {
            generation: 0,
            record: null,
          };
          if (
            isDifferentPublishedMeasurement(
              initialLive,
              request.params.afterGeneration,
              request.params.afterSequence
            )
          ) {
            return {
              requestId,
              result: {
                outcome: "sample",
                matchedImmediately: true,
                measurement: buildMeasurementOrFail(initialLive),
              },
            };
          }
          if (waitersRef.current.size >= 4) {
            throw semanticFailure(
              "waitLimitReached",
              "$",
              "Too many long waits are active.",
              -32070
            );
          }
          const result = await new Promise((resolve, reject) => {
            const waiter = {
              kind: "measurement",
              timer: null,
              unsubscribe: () => {},
              resolve,
              reject,
            };
            const finish = (value) => {
              clearTimeout(waiter.timer);
              waiter.unsubscribe();
              waitersRef.current.delete(requestId);
              resolve(value);
            };
            const observe = (live) => {
              if (
                !isDifferentPublishedMeasurement(
                  live,
                  request.params.afterGeneration,
                  request.params.afterSequence
                )
              ) {
                return;
              }
              finish({ outcome: "sample", matchedImmediately: false, live });
            };
            waiter.timer = setTimeout(() => {
              const live = latestMeasurementContextRef.current.getLiveMeasurement?.() ?? {
                generation: 0,
                record: null,
              };
              finish({ outcome: "timeout", live });
            }, request.params.timeoutMs);
            waitersRef.current.set(requestId, waiter);
            waiter.unsubscribe =
              currentMeasurement.subscribeLiveMeasurement?.(observe) ?? (() => {});
            observe(currentMeasurement.getLiveMeasurement?.() ?? { generation: 0, record: null });
          });
          if (result === WAIT_CANCELLED) return null;
          if (result.outcome === "timeout") {
            throw semanticFailure(
              "timeout",
              "$.params.timeoutMs",
              "No different LIVE measurement sample was published before the timeout.",
              -32071,
              {
                afterGeneration: request.params.afterGeneration,
                afterSequence: request.params.afterSequence ?? null,
                currentGeneration: result.live.generation,
                currentSequence: result.live.record?.sequence ?? null,
                liveState: latestMeasurementContextRef.current.liveState,
              }
            );
          }
          return {
            requestId,
            result: {
              outcome: "sample",
              matchedImmediately: result.matchedImmediately,
              measurement: buildMeasurementOrFail(result.live),
            },
          };
        }
        if (request.method === "app.wait") {
          const activeBatch = revisionBatchRef.current;
          const awaitingActiveBatch =
            activeBatch?.bumped === true &&
            request.params.afterRevision === activeBatch.startRevision;
          if (controlRevisionRef.current !== request.params.afterRevision && !awaitingActiveBatch) {
            return {
              requestId,
              result: {
                outcome: "changed",
                matchedImmediately: true,
                revision: controlRevisionRef.current,
              },
            };
          }
          if (waitersRef.current.size >= 4) {
            throw semanticFailure(
              "waitLimitReached",
              "$",
              "Too many long waits are active.",
              -32070
            );
          }
          const result = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              waitersRef.current.delete(requestId);
              resolve({
                outcome: "timeout",
                revision: controlRevisionRef.current,
              });
            }, request.params.timeoutMs);
            waitersRef.current.set(requestId, {
              kind: "revision",
              afterRevision: request.params.afterRevision,
              timer,
              resolve,
              reject,
            });
          });
          if (result === WAIT_CANCELLED) return null;
          if (result.outcome === "timeout") {
            throw semanticFailure(
              "timeout",
              "$.params.timeoutMs",
              "The app revision did not change before the timeout.",
              -32071,
              {
                afterRevision: request.params.afterRevision,
                currentRevision: result.revision,
              }
            );
          }
          return { requestId, result };
        }
        if (request.method === "app.inspect") {
          return {
            requestId,
            result: buildAgentControlSnapshot({
              runtime,
              revision: controlRevisionRef.current,
              workspace,
              presets,
              appearance: latestThemeRef.current.state.appearance,
              loudnessProfile: {
                activeId: activeLoudnessProfileId(loudnessProfiles, loudnessActive),
              },
              settings,
              transport,
              device: device ? deviceInspection(device) : null,
              dock: buildDockSnapshot(dock, dockContext),
              hasLoudnessReference,
              analysisContext,
            }),
          };
        }

        if (DEVICE_CONTROL_METHODS.includes(request.method)) {
          const currentDevice = latestDeviceRef.current;
          if (!currentDevice?.snapshot) {
            throw semanticFailure(
              "deviceControlUnavailable",
              "$.method",
              "Device Control is unavailable in the current app state.",
              -32064
            );
          }
          if (request.method === "device.list") {
            return {
              requestId,
              result: {
                revision: controlRevisionRef.current,
                ...buildDeviceList(currentDevice.snapshot),
              },
            };
          }
          if (request.method === "device.inspect") {
            return {
              requestId,
              result: {
                revision: controlRevisionRef.current,
                ...deviceInspection(currentDevice),
              },
            };
          }

          const currentRevision = controlRevisionRef.current;
          if (request.params.expectedRevision !== currentRevision) {
            throw semanticFailure(
              "revisionConflict",
              "$.params.expectedRevision",
              `Device selection changed after revision ${request.params.expectedRevision}.`,
              -32004,
              { expectedRevision: request.params.expectedRevision, currentRevision }
            );
          }
          if (currentDevice.runtimeUnavailable === true) {
            throw semanticFailure(
              "transitionInProgress",
              "$.params",
              "Runtime changes are unavailable while an update is being applied.",
              -32081,
              { state: "update" }
            );
          }

          const planOrThrow = (controller) => {
            const planned = planDeviceSelection(
              controller.snapshot,
              request.params,
              controller.live
            );
            if (planned.issues.length > 0) {
              const problem = planned.issues[0];
              const codes = {
                deviceNotFound: -32060,
                deviceInventoryChanged: -32061,
                deviceUnavailable: -32062,
              };
              throw semanticFailure(
                problem.code,
                problem.path,
                problem.message,
                codes[problem.code] ?? -32602,
                problem.details
              );
            }
            if (planned.refusal) {
              throw semanticFailure(
                planned.refusal.code,
                "$.params",
                "Device selection is unavailable during a Live transition.",
                -32081,
                planned.refusal
              );
            }
            if (
              request.params.dryRun !== true &&
              planned.confirmationsRequired.includes("allowMeasurementRestart")
            ) {
              throw semanticFailure(
                "confirmationRequired",
                "$.params.allowMeasurementRestart",
                "Changing the running Live device requires measurement-restart confirmation.",
                -32041,
                { requiredFlag: "allowMeasurementRestart" }
              );
            }
            return planned;
          };

          const previewOrThrow = async (controller, planned) => {
            if (!planned.changed) return planned;
            try {
              await controller.previewSelection(request.params.deviceId);
              return planned;
            } catch (error) {
              if (request.params.deviceId === "default" && controller.live?.state !== "running") {
                return {
                  ...planned,
                  warnings: Array.from(
                    new Set([...planned.warnings, "automaticCurrentlyUnavailable"])
                  ),
                };
              }
              throw semanticFailure(
                "deviceUnavailable",
                "$.params.deviceId",
                `The requested device is unavailable: ${error?.message || String(error)}`,
                -32062
              );
            }
          };

          let planned = planOrThrow(currentDevice);
          planned = await previewOrThrow(currentDevice, planned);
          const predicted = deviceInspection(
            currentDevice,
            planned.changed ? request.params.deviceId : currentDevice.snapshot.requestedId
          );
          const result = {
            dryRun: request.params.dryRun === true,
            revision: currentRevision,
            generation: currentDevice.snapshot.generation,
            changed: planned.changed,
            effects: planned.effects,
            warnings: planned.warnings,
            ...(request.params.dryRun === true
              ? { confirmationsRequired: planned.confirmationsRequired }
              : {}),
            plan: planned.plan,
            state: {
              selection: predicted.selection,
              live: predicted.live,
            },
          };
          if (request.params.dryRun === true || !planned.changed) {
            return { requestId, result };
          }

          const finalDevice = latestDeviceRef.current;
          planned = planOrThrow(finalDevice);
          planned = await previewOrThrow(finalDevice, planned);
          const commitDevice = latestDeviceRef.current;
          planned = planOrThrow(commitDevice);
          if (request.params.expectedRevision !== controlRevisionRef.current) {
            throw semanticFailure(
              "revisionConflict",
              "$.params.expectedRevision",
              `Device selection changed after revision ${request.params.expectedRevision}.`,
              -32004,
              {
                expectedRevision: request.params.expectedRevision,
                currentRevision: controlRevisionRef.current,
              }
            );
          }
          if (commitDevice.runtimeUnavailable === true) {
            throw semanticFailure(
              "transitionInProgress",
              "$.params",
              "Runtime changes became unavailable while an update was being applied.",
              -32081,
              { state: "update" }
            );
          }
          result.effects = planned.effects;
          result.warnings = planned.warnings;
          result.plan = planned.plan;

          const committed = new Promise((resolve, reject) => {
            deviceSettlementRef.current = {
              requestedId: request.params.deviceId,
              resolve,
              reject,
            };
          });
          let restart = null;
          try {
            restart = planned.plan.restartLive ? commitDevice.beginRestart() : null;
          } catch (error) {
            deviceSettlementRef.current = null;
            throw semanticFailure(
              error?.code === "transitionInProgress" ? "transitionInProgress" : "commandFailed",
              "$.params",
              `Device restart could not begin: ${error?.message || String(error)}`,
              error?.code === "transitionInProgress" ? -32081 : -32050
            );
          }
          const restartSettlement = restart
            ? restart.then(
                () => null,
                (error) => error
              )
            : null;

          let persistenceError = null;
          try {
            await commitDevice.commitSelection(request.params.deviceId);
          } catch (error) {
            persistenceError = error;
          }

          let committedRevision = controlRevisionRef.current;
          if (persistenceError?.stateCommitted === true) {
            committedRevision = await awaitSettlement(
              committed,
              () => {
                deviceSettlementRef.current = null;
              },
              "The Device selection"
            );
          } else if (persistenceError) {
            deviceSettlementRef.current = null;
          } else {
            committedRevision = await awaitSettlement(
              committed,
              () => {
                deviceSettlementRef.current = null;
              },
              "The Device selection"
            );
          }

          const restartError = restartSettlement ? await restartSettlement : null;
          const resultingDevice = latestDeviceRef.current;
          const inspection = deviceInspection(resultingDevice);
          if (persistenceError) {
            throw semanticFailure(
              "persistenceFailed",
              "$.params.deviceId",
              `Device selection committed but persistence failed: ${persistenceError?.message || String(persistenceError)}`,
              -32030,
              {
                stateCommitted: persistenceError.stateCommitted === true,
                revision: committedRevision,
                generation: resultingDevice.snapshot.generation,
                state: { selection: inspection.selection, live: inspection.live },
              }
            );
          }
          if (restartError) {
            throw semanticFailure(
              "deviceStartFailed",
              "$.params.deviceId",
              `Device selection committed but Live restart failed: ${restartError?.message || String(restartError)}`,
              -32063,
              {
                stateCommitted: true,
                revision: committedRevision,
                generation: resultingDevice.snapshot.generation,
                state: { selection: inspection.selection, live: inspection.live },
              }
            );
          }
          result.revision = committedRevision;
          result.generation = resultingDevice.snapshot.generation;
          result.state = { selection: inspection.selection, live: inspection.live };
          return { requestId, result };
        }

        if (request.method === "settings.describe" || request.method === "settings.inspect") {
          const inspection = buildSettingsInspection(settings, settingsContext);
          return {
            requestId,
            result: {
              revision: controlRevisionRef.current,
              ...inspection,
              ...(request.method === "settings.describe"
                ? { schema: buildSettingsSchema(settings, settingsContext) }
                : {}),
            },
          };
        }
        if (request.method === "transport.inspect") {
          return {
            requestId,
            result: { revision: controlRevisionRef.current, ...transport },
          };
        }
        if (request.method === "dock.describe" || request.method === "dock.inspect") {
          const snapshot = buildDockSnapshot(dock, dockContext);
          return {
            requestId,
            result: {
              revision: controlRevisionRef.current,
              preset: panelResultPreset(presets, []),
              ...(request.method === "dock.describe"
                ? buildDockDescription(dock, dockContext)
                : snapshot),
            },
          };
        }
        if (request.method === "dock.panel.describe") {
          const description = buildDockPanelDescription(dock, request.params.panelId, dockContext);
          if (description.issue) {
            const unavailable = description.issue.code === "controlsUnavailable";
            throw semanticFailure(
              unavailable ? "controlsUnavailable" : "dockPanelNotFound",
              "$.params.panelId",
              description.issue.message,
              unavailable ? -32091 : -32090
            );
          }
          return { requestId, result: { revision: controlRevisionRef.current, ...description } };
        }
        if (request.method.startsWith("dock.")) {
          const currentRevision = controlRevisionRef.current;
          if (
            request.params.expectedRevision !== undefined &&
            request.params.expectedRevision !== currentRevision
          ) {
            throw semanticFailure(
              "revisionConflict",
              "$.params.expectedRevision",
              `Workspace changed after revision ${request.params.expectedRevision}.`,
              -32004,
              { expectedRevision: request.params.expectedRevision, currentRevision }
            );
          }
          let planned;
          let createdPanels = {};
          if (request.method === "dock.enter" || request.method === "dock.exit") {
            planned = planDockFormMutation(dock, request.method, request.params, dockContext);
          } else if (request.method === "dock.layout.apply") {
            planned = compileDockLayout(dock, request.params.layout, dockContext);
            createdPanels = planned.createdPanels;
          } else if (request.method === "dock.panel.update") {
            planned = planDockPanelPatch(
              dock,
              request.params.panelId,
              request.params.patch,
              dockContext
            );
          } else {
            planned = planDockPanelReset(dock, request.params.panelId, dockContext);
          }
          if (planned.issues.length) {
            const missing = planned.issues.some(({ code }) => code === "dockPanelNotFound");
            const monitorMissing = planned.issues.some(({ code }) => code === "monitorNotFound");
            const unavailable = planned.issues.some(({ code }) => code === "controlsUnavailable");
            throw semanticFailure(
              missing
                ? "dockPanelNotFound"
                : monitorMissing
                  ? "monitorNotFound"
                  : unavailable
                    ? "controlsUnavailable"
                    : request.method === "dock.layout.apply"
                      ? "invalidDockLayout"
                      : "invalidDockControls",
              "$.params",
              "The Dock request is invalid.",
              missing ? -32090 : monitorMissing ? -32093 : unavailable ? -32091 : -32602,
              { issues: planned.issues }
            );
          }
          if (planned.refusal) {
            const code = planned.refusal.code === "editorActive" ? -32040 : -32092;
            throw semanticFailure(
              planned.refusal.code,
              "$.params",
              "The Dock operation is unavailable in the current state.",
              code,
              planned.refusal
            );
          }
          const result = {
            dryRun: request.params.dryRun === true,
            revision: currentRevision,
            changed: planned.changed.length > 0,
            effects: planned.effects ?? [],
            warnings: planned.warnings,
            createdPanels,
            state: {
              dock: buildDockSnapshot(planned.dock, dockContext),
              preset: panelResultPreset(presets, planned.changed),
            },
          };
          if (request.params.dryRun === true || planned.changed.length === 0)
            return { requestId, result };
          const plannedSignature = dockStateSignature(planned.dock);
          const matches =
            request.method === "dock.enter"
              ? (candidate) =>
                  candidate.enabled === true &&
                  candidate.edge === planned.dock.edge &&
                  candidate.reserveSpace === planned.dock.reserveSpace &&
                  candidate.height === planned.dock.height &&
                  (request.params.monitor === undefined ||
                    candidate.monitor === planned.dock.monitor)
              : request.method === "dock.exit"
                ? (candidate) => candidate.enabled === false
                : (candidate) => dockStateSignature(candidate) === plannedSignature;
          const committed = new Promise((resolve, reject) => {
            dockSettlementRef.current = { matches, resolve, reject };
          });
          try {
            await executeDock(request.method, planned.dock);
            result.revision = await awaitSettlement(
              committed,
              () => {
                dockSettlementRef.current = null;
              },
              "The Dock change"
            );
          } catch (error) {
            dockSettlementRef.current = null;
            // The backstop already states what went wrong and that state was committed; relabelling
            // it as a failed native operation would hide the real cause.
            if (isCommitNotObserved(error)) throw error;
            const observableDock = latestDockRef.current;
            const partial = dockStateSignature(observableDock) !== dockStateSignature(dock);
            throw semanticFailure(
              "applicationFailed",
              "$.params",
              `Dock operation failed: ${error?.message || String(error)}`,
              -32050,
              {
                stage: error?.stage ?? "execution",
                partial,
                changed: planned.changed,
                revision: controlRevisionRef.current,
                dock: buildDockSnapshot(observableDock, dockContext),
              }
            );
          }
          result.state.dock = buildDockSnapshot(latestDockRef.current, dockContext);
          result.state.preset = panelResultPreset(presets, planned.changed);
          try {
            await flush();
          } catch (error) {
            throw semanticFailure(
              "persistenceFailed",
              "$.params",
              `Dock state committed but persistence failed: ${error?.message || String(error)}`,
              -32030,
              {
                stage: "persistence",
                partial: true,
                stateCommitted: true,
                changed: planned.changed,
                revision: result.revision,
                dock: result.state.dock,
              }
            );
          }
          return { requestId, result };
        }

        if (request.method.startsWith("transport.")) {
          const currentRevision = controlRevisionRef.current;
          if (
            request.params.expectedRevision !== undefined &&
            request.params.expectedRevision !== currentRevision
          ) {
            throw semanticFailure(
              "revisionConflict",
              "$.params.expectedRevision",
              `Transport changed after revision ${request.params.expectedRevision}.`,
              -32004,
              {
                expectedRevision: request.params.expectedRevision,
                currentRevision,
              }
            );
          }
          const planned = planTransportMutation(
            latestTransportRef.current,
            request.method,
            request.params,
            transportContext
          );
          if (planned.issues.length > 0) {
            const missing = planned.issues.some(({ code }) => code === "fileSessionNotFound");
            throw semanticFailure(
              missing ? "fileSessionNotFound" : "invalidTransport",
              missing ? "$.params.sessionId" : "$.params",
              missing ? "The FILE session was not found." : "The Transport request is invalid.",
              missing ? -32080 : -32602,
              { issues: planned.issues }
            );
          }
          if (planned.refusal) {
            const refusalCodes = {
              transitionInProgress: -32081,
              analysisInProgress: -32082,
              dockActive: -32083,
              fileAnalysisNotActive: -32084,
            };
            throw semanticFailure(
              planned.refusal.code,
              "$.params",
              "The Transport operation is unavailable in the current state.",
              refusalCodes[planned.refusal.code] ?? -32012,
              planned.refusal
            );
          }
          if (planned.confirmation) {
            throw semanticFailure(
              "confirmationRequired",
              "$.params.allowStopFileAnalysis",
              "Active FILE analysis must be stopped before switching to LIVE.",
              -32041,
              planned.confirmation
            );
          }
          const action = isTransportAction(request.method);
          const result = {
            ...(action
              ? {
                  action: request.method,
                  status:
                    request.method === "transport.file.analyze" ||
                    request.method === "transport.file.reanalyze"
                      ? "accepted"
                      : "completed",
                }
              : {
                  dryRun: request.params.dryRun === true,
                  changed: planned.changed.length > 0,
                }),
            revision: currentRevision,
            effects: planned.effects,
            warnings: planned.warnings,
            ...(planned.affectedSessions.length > 0
              ? { affectedSessions: planned.affectedSessions }
              : {}),
            ...(planned.evictedSessions.length > 0
              ? { evictedSessions: planned.evictedSessions }
              : {}),
            state: {
              transport: action
                ? latestTransportRef.current
                : projectTransportMutation(
                    latestTransportRef.current,
                    request.method,
                    request.params
                  ),
            },
          };
          if (request.params.dryRun === true || planned.changed.length === 0) {
            return { requestId, result };
          }

          let execution;
          try {
            execution = await executeTransport(request.method, request.params);
          } catch (error) {
            throw semanticFailure(
              "applicationFailed",
              "$.params",
              `Transport operation failed: ${error?.message || String(error)}`,
              -32050,
              {
                partial: true,
                stage: error?.stage ?? "execution",
                changed: planned.changed,
                revision: controlRevisionRef.current,
                ...(error?.sessionId ? { sessionId: error.sessionId } : {}),
              }
            );
          }

          if (request.method === "transport.live.clear") {
            bumpControlRevision();
            scheduleWaitWake();
            result.revision = controlRevisionRef.current;
          } else {
            const matches = (candidate) =>
              transportMutationMatches(request.method, request.params, execution, candidate);
            if (matches(latestTransportRef.current)) {
              result.revision = controlRevisionRef.current;
            } else {
              result.revision = await awaitSettlement(
                new Promise((resolve, reject) => {
                  transportSettlementRef.current = { matches, resolve, reject };
                }),
                () => {
                  transportSettlementRef.current = null;
                },
                "The Transport change"
              );
            }
          }
          result.state.transport = latestTransportRef.current;
          Object.assign(result, execution?.result ?? {});
          if (Array.isArray(execution?.affectedSessions)) {
            result.affectedSessions = execution.affectedSessions;
          }
          if (Array.isArray(execution?.evictedSessions)) {
            result.evictedSessions = execution.evictedSessions;
          }
          return { requestId, result };
        }

        if (request.method === "settings.update") {
          const currentRevision = controlRevisionRef.current;
          if (
            request.params.expectedRevision !== undefined &&
            request.params.expectedRevision !== currentRevision
          ) {
            throw semanticFailure(
              "revisionConflict",
              "$.params.expectedRevision",
              `Settings changed after revision ${request.params.expectedRevision}.`,
              -32004,
              {
                expectedRevision: request.params.expectedRevision,
                currentRevision,
              }
            );
          }
          const planned = planSettingsUpdate(settings, request.params.patch, settingsContext, {
            allowMeasurementRestart: request.params.allowMeasurementRestart === true,
          });
          if (planned.issues.length > 0) {
            throw semanticFailure(
              "invalidSettings",
              "$.params.patch",
              "The Settings patch is invalid.",
              -32602,
              { issues: planned.issues }
            );
          }
          if (planned.refusal) {
            const editorActive = planned.refusal.code === "editorActive";
            throw semanticFailure(
              planned.refusal.code,
              "$.params.patch",
              editorActive
                ? "Finish or cancel the active editor first."
                : "A Settings control is unavailable.",
              editorActive ? -32040 : -32012,
              planned.refusal
            );
          }
          if (planned.confirmation && request.params.dryRun !== true) {
            throw semanticFailure(
              "confirmationRequired",
              "$.params.allowMeasurementRestart",
              "This change requires a measurement restart.",
              -32041,
              planned.confirmation
            );
          }
          const inspection = buildSettingsInspection(planned.settings, settingsContext);
          const result = {
            dryRun: request.params.dryRun === true,
            revision: currentRevision,
            changed: planned.changed.length > 0,
            effects: planned.effects,
            warnings: planned.warnings,
            ...(planned.confirmation ? { confirmation: planned.confirmation } : {}),
            state: inspection,
          };
          if (request.params.dryRun === true || planned.changed.length === 0) {
            return { requestId, result };
          }

          const committed = new Promise((resolve, reject) => {
            settingsSettlementRef.current = {
              signature: settingsStateSignature(planned.settings),
              resolve,
              reject,
            };
          });
          try {
            await applySettings(planned.settings, {
              changed: planned.changed,
              effects: planned.effects,
            });
          } catch (error) {
            settingsSettlementRef.current = null;
            throw semanticFailure(
              "applicationFailed",
              "$",
              `Settings application failed: ${error?.message || String(error)}`,
              -32050,
              {
                partial: error?.partial === true,
                rollback: error?.rollback ?? "completed",
                changed: error?.changed ?? [],
                effects: error?.effects ?? [],
                revision: controlRevisionRef.current,
              }
            );
          }
          result.revision = await awaitSettlement(
            committed,
            () => {
              settingsSettlementRef.current = null;
            },
            "The Settings change"
          );
          try {
            await flush();
          } catch (error) {
            throw semanticFailure(
              "persistenceFailed",
              "$",
              `Settings committed but persistence failed: ${error?.message || String(error)}`,
              -32030,
              { stateCommitted: true, revision: result.revision }
            );
          }
          return { requestId, result };
        }

        if (request.method === "loudnessProfile.describe") {
          const index = loudnessProfiles.findIndex(({ id }) => id === request.params.profileId);
          if (index < 0) {
            throw semanticFailure(
              "loudnessProfileNotFound",
              "$.params.profileId",
              `Loudness Profile ${request.params.profileId} was not found.`,
              -32020
            );
          }
          const profile = normalizeRuleDocument(loudnessProfiles[index]);
          return {
            requestId,
            result: {
              revision: controlRevisionRef.current,
              profile,
              active: activeLoudnessProfileId(loudnessProfiles, loudnessActive) === profile.id,
              index,
            },
          };
        }

        if (
          request.method === "loudnessProfile.select" ||
          request.method === "loudnessProfile.create" ||
          request.method === "loudnessProfile.update" ||
          request.method === "loudnessProfile.rename" ||
          request.method === "loudnessProfile.delete" ||
          request.method === "loudnessProfile.reorder"
        ) {
          const currentRevision = controlRevisionRef.current;
          if (request.params.expectedRevision !== currentRevision) {
            throw semanticFailure(
              "revisionConflict",
              "$.params.expectedRevision",
              `Loudness Profiles changed after revision ${request.params.expectedRevision}.`,
              -32004,
              { expectedRevision: request.params.expectedRevision, currentRevision }
            );
          }
          const control = loudnessProfile?.control;
          if (!control) {
            throw semanticFailure(
              "controlUnavailable",
              "$",
              "Loudness Profile Control is unavailable.",
              -32012
            );
          }
          if (request.method !== "loudnessProfile.reorder") {
            control.assertAllowed(request.method);
          }

          let planned =
            request.method === "loudnessProfile.select"
              ? control.planSelect(request.params.profileId)
              : request.method === "loudnessProfile.create"
                ? control.planCreate(request.params.document)
                : request.method === "loudnessProfile.update"
                  ? control.planUpdate(request.params.profileId, request.params.document)
                  : request.method === "loudnessProfile.rename"
                    ? control.planRename(request.params.profileId, request.params.name)
                    : request.method === "loudnessProfile.delete"
                      ? control.planDelete(request.params.profileId)
                      : control.planReorder(request.params.profileIds);
          if (planned.issues.length > 0) {
            const missing = planned.issues.find(({ code }) => code === "loudnessProfileNotFound");
            const permutation = planned.issues.find(({ code }) => code === "invalidPermutation");
            if (missing) {
              throw semanticFailure(
                "loudnessProfileNotFound",
                "$.params.profileId",
                missing.message,
                -32020
              );
            }
            if (permutation) {
              throw semanticFailure(
                "invalidPermutation",
                "$.params.profileIds",
                permutation.message,
                -32602,
                { issues: planned.issues }
              );
            }
            throw semanticFailure(
              "invalidProfile",
              request.method === "loudnessProfile.rename" ? "$.params.name" : "$.params.document",
              "The Loudness Profile document is invalid.",
              -32602,
              { issues: planned.issues }
            );
          }

          const profilePlan = () =>
            request.method === "loudnessProfile.select"
              ? { from: planned.from, to: planned.to }
              : request.method === "loudnessProfile.create"
                ? {
                    document: planned.document,
                    selectCreated: true,
                    ...(planned.profile ? { profile: planned.profile } : {}),
                  }
                : request.method === "loudnessProfile.delete"
                  ? {
                      deletedProfile: planned.deletedProfile,
                      selectionFallsBackToOff: planned.selectionFallsBackToOff,
                      affectedPresetIds: planned.affectedPresetIds,
                    }
                  : request.method === "loudnessProfile.reorder"
                    ? { profileIds: planned.profileIds }
                    : { profile: planned.profile };
          const dryRun = request.params.dryRun === true;
          const result = {
            dryRun,
            revision: currentRevision,
            changed: planned.changed.length > 0,
            warnings: planned.warnings,
            plan: profilePlan(),
            state: compactLoudnessProfileState(
              planned.loudnessProfiles,
              dryRun && request.method === "loudnessProfile.create" ? planned.document : null
            ),
          };
          if (dryRun || planned.changed.length === 0) return { requestId, result };

          const registerSettlement = (commitPlan) => {
            const expected = {
              loudnessProfile: loudnessProfileStateSignature(
                commitPlan.loudnessProfiles.profiles,
                commitPlan.loudnessProfiles.active
              ),
            };
            if (
              commitPlan.presets &&
              presetStateSignature(commitPlan.presets) !== presetStateSignature(presets)
            ) {
              expected.presets = presetStateSignature(commitPlan.presets);
            }
            const committed = new Promise((resolve, reject) => {
              loudnessProfileSettlementRef.current = {
                expected,
                observed: new Set(),
                resolve,
                reject,
              };
            });
            return committed;
          };

          let committed;
          if (request.method === "loudnessProfile.create") {
            planned = control.create(request.params.document);
            if (planned.issues.length > 0 || !planned.profile) {
              throw semanticFailure(
                "commandFailed",
                "$",
                "Loudness Profile could not be created.",
                -32050
              );
            }
            committed = registerSettlement(planned);
          } else {
            committed = registerSettlement(planned);
            control.commit(planned);
          }
          result.plan = profilePlan();
          result.state = compactLoudnessProfileState(planned.loudnessProfiles);
          result.revision = await awaitSettlement(
            committed,
            () => {
              loudnessProfileSettlementRef.current = null;
            },
            "The Loudness Profile change"
          );
          try {
            await flush();
          } catch (error) {
            throw semanticFailure(
              "persistenceFailed",
              "$",
              `Loudness Profile committed but persistence failed: ${error?.message || String(error)}`,
              -32030,
              { stateCommitted: true, revision: result.revision }
            );
          }
          return { requestId, result };
        }

        if (request.method === "preset.list") {
          return {
            requestId,
            result: {
              revision: controlRevisionRef.current,
              presets: (presets?.list ?? []).map(({ id, name }) => ({ id, name })),
              activeId: typeof presets?.activeId === "string" ? presets.activeId : null,
              dirty: presets?.dirty === true,
            },
          };
        }

        if (request.method === "preset.describe") {
          const currentRevision = controlRevisionRef.current;
          const preset = (presets?.list ?? []).find(({ id }) => id === request.params.presetId);
          if (!preset) {
            throw semanticFailure(
              "presetNotFound",
              "$.params.presetId",
              `Preset ${request.params.presetId} was not found.`,
              -32020
            );
          }
          return {
            requestId,
            result: {
              revision: currentRevision,
              preset: buildPublicPresetSnapshot(preset, { loudnessProfiles }),
            },
          };
        }

        if (request.method === "preset.save" || request.method === "preset.update") {
          const assertRevisions = () => {
            if (request.params.expectedRevision !== controlRevisionRef.current) {
              throw semanticFailure(
                "revisionConflict",
                "$.params.expectedRevision",
                `App state changed after revision ${request.params.expectedRevision}.`,
                -32004,
                {
                  expectedRevision: request.params.expectedRevision,
                  currentRevision: controlRevisionRef.current,
                }
              );
            }
          };
          assertRevisions();
          presets.assertSceneOperationAllowed(request.method);
          const state = {
            list: presets?.list ?? [],
            activeId: typeof presets?.activeId === "string" ? presets.activeId : null,
            dirty: presets?.dirty === true,
          };
          if (
            request.method === "preset.update" &&
            !state.list.some(({ id }) => id === request.params.presetId)
          ) {
            throw semanticFailure(
              "presetNotFound",
              "$.params.presetId",
              `Preset ${request.params.presetId} was not found.`,
              -32020
            );
          }
          const snapshot = await presets.captureSnapshot();
          assertRevisions();
          presets.assertSceneOperationAllowed(request.method);
          let planned =
            request.method === "preset.save"
              ? planPresetSave(state, request.params.name, snapshot)
              : planPresetUpdate(state, request.params.presetId, snapshot);
          if (planned.issues.length > 0) {
            throw semanticFailure(
              "invalidPreset",
              "$.params",
              "The Preset request is invalid.",
              -32602,
              { issues: planned.issues }
            );
          }
          const result = {
            dryRun: request.params.dryRun === true,
            changed: planned.changed.length > 0,
            state: {
              preset: planned.preset,
              presets: planned.presetState,
            },
            revision: controlRevisionRef.current,
            warnings: planned.warnings,
          };
          if (request.params.dryRun === true || planned.changed.length === 0) {
            return { requestId, result };
          }

          if (request.method === "preset.save") {
            const saved = presets.saveSnapshot(planned.preset.name, snapshot);
            if (!saved) {
              throw semanticFailure("commandFailed", "$", "Preset could not be saved.", -32050);
            }
            planned = planPresetSave(state, planned.preset.name, snapshot, saved.id);
          }
          const committed = new Promise((resolve, reject) => {
            presetSettlementRef.current = {
              signature: presetStateSignature(planned.presets),
              resolve,
              reject,
            };
          });
          if (request.method === "preset.update") {
            const updated = presets.updateSnapshot(request.params.presetId, snapshot);
            if (!updated) {
              presetSettlementRef.current = null;
              throw semanticFailure(
                "presetNotFound",
                "$.params.presetId",
                "Preset was not found.",
                -32020
              );
            }
          }
          result.state.preset = planned.preset;
          result.state.presets = planned.presetState;
          result.revision = await awaitSettlement(
            committed,
            () => {
              presetSettlementRef.current = null;
            },
            "The Preset change"
          );
          try {
            await flush();
          } catch (error) {
            throw semanticFailure(
              "persistenceFailed",
              "$",
              `Preset state committed but persistence failed: ${error?.message || String(error)}`,
              -32030,
              { stateCommitted: true, revision: result.revision }
            );
          }
          return { requestId, result };
        }

        if (request.method === "preset.apply") {
          const assertRevisions = () => {
            if (request.params.expectedRevision !== controlRevisionRef.current) {
              throw semanticFailure(
                "revisionConflict",
                "$.params.expectedRevision",
                `App state changed after revision ${request.params.expectedRevision}.`,
                -32004,
                {
                  expectedRevision: request.params.expectedRevision,
                  currentRevision: controlRevisionRef.current,
                }
              );
            }
          };
          assertRevisions();
          presets.assertSceneOperationAllowed(request.method);
          const state = {
            list: presets?.list ?? [],
            activeId: typeof presets?.activeId === "string" ? presets.activeId : null,
            dirty: presets?.dirty === true,
          };
          const target = state.list.find(({ id }) => id === request.params.presetId);
          if (!target) {
            throw semanticFailure(
              "presetNotFound",
              "$.params.presetId",
              `Preset ${request.params.presetId} was not found.`,
              -32020
            );
          }
          presets.preflightApplySnapshot(request.params.presetId);
          const resources = planPresetApplyResources(target, {
            loudnessProfiles,
            dockSupported: dock.supported === true,
            monitors: dockContext.monitors,
            fallbackMonitor: dockContext.fallbackMonitor,
            monitorInventoryReady: dockContext.monitorInventoryReady,
            monitorRects: dockContext.monitorRects,
          });
          if (resources.issues.length > 0) {
            throw semanticFailure(
              "controlUnavailable",
              "$.params.presetId",
              "A saved Preset resource is unavailable.",
              -32012,
              { issues: resources.issues }
            );
          }
          const currentSnapshot = await presets.captureSnapshot();
          assertRevisions();
          presets.assertSceneOperationAllowed(request.method);
          const scenePlan = planPresetApply(state, request.params.presetId, currentSnapshot);
          const planned = {
            ...scenePlan,
            warnings: [...resources.warnings, ...scenePlan.warnings],
          };
          const result = {
            dryRun: request.params.dryRun === true,
            changed: planned.changed.length > 0,
            state: {
              preset: planned.preset,
              presets: planned.presetState,
            },
            revision: controlRevisionRef.current,
            warnings: planned.warnings,
          };
          if (request.params.dryRun === true || planned.changed.length === 0) {
            return { requestId, result };
          }

          const presetStateChanged = planned.changed.some((path) => path.startsWith("presets."));
          const presetCommitted = presetStateChanged
            ? new Promise((resolve, reject) => {
                presetSettlementRef.current = {
                  signature: presetStateSignature(planned.presets),
                  resolve,
                  reject,
                };
              })
            : null;
          let workspaceCommitted = null;
          // What applying this Preset actually installs. Both the settlement below and the
          // persistence wait further down must compare against this, never against `target`. Built
          // only when the Workspace is really being replaced: a Preset that merely gets associated
          // need not carry a complete Workspace record.
          let targetView = null;
          if (planned.changed.includes("workspace")) {
            targetView = presetWorkspaceView(target);
            workspaceCommitted = new Promise((resolve, reject) => {
              settlementRef.current = {
                matches: (currentWorkspace) =>
                  workspaceMatchesPresetView(currentWorkspace, targetView),
                resolve,
                reject,
              };
            });
          }
          try {
            if (planned.applyScene) {
              const applied = await presets.applySnapshot(request.params.presetId, {
                applyWorkspace: planned.changed.includes("workspace"),
              });
              if (!applied) throw new Error("Preset target disappeared before application.");
            } else if (!presets.activateSnapshot(request.params.presetId)) {
              throw new Error("Preset target disappeared before activation.");
            }
          } catch (error) {
            settlementRef.current = null;
            presetSettlementRef.current = null;
            if (isSceneOperationRefused(error)) throw error;
            throw semanticFailure(
              "applicationFailed",
              "$",
              `Preset application failed: ${error?.message || String(error)}`,
              -32050,
              {
                stage: typeof error?.stage === "string" ? error.stage : "scene",
                partial: planned.applyScene,
                changed: planned.changed,
                revision: controlRevisionRef.current,
                presetState: { activeId: null, dirty: false },
              }
            );
          }
          await awaitSettlement(
            Promise.all([
              ...(presetCommitted ? [presetCommitted] : []),
              ...(workspaceCommitted ? [workspaceCommitted] : []),
            ]),
            () => {
              presetSettlementRef.current = null;
              settlementRef.current = null;
            },
            "The Preset application"
          );
          result.revision = controlRevisionRef.current;
          if (workspaceCommitted) {
            await awaitSettlement(
              waitForWorkspacePersistenceEnqueue(targetView),
              () => {},
              "The Preset Workspace"
            );
          }
          try {
            await flush();
          } catch (error) {
            throw semanticFailure(
              "persistenceFailed",
              "$",
              `Preset state committed but persistence failed: ${error?.message || String(error)}`,
              -32030,
              { stateCommitted: true, revision: result.revision }
            );
          }
          return { requestId, result };
        }

        if (
          request.method === "preset.rename" ||
          request.method === "preset.delete" ||
          request.method === "preset.reorder"
        ) {
          const currentRevision = controlRevisionRef.current;
          if (
            request.params.expectedRevision !== undefined &&
            request.params.expectedRevision !== currentRevision
          ) {
            throw semanticFailure(
              "revisionConflict",
              "$.params.expectedRevision",
              `Presets changed after revision ${request.params.expectedRevision}.`,
              -32004,
              {
                expectedRevision: request.params.expectedRevision,
                currentRevision,
              }
            );
          }
          const state = {
            list: presets?.list ?? [],
            activeId: typeof presets?.activeId === "string" ? presets.activeId : null,
            dirty: presets?.dirty === true,
          };
          const planned =
            request.method === "preset.rename"
              ? planPresetRename(state, request.params.presetId, request.params.name)
              : request.method === "preset.delete"
                ? planPresetDelete(state, request.params.presetId)
                : planPresetReorder(state, request.params.presetIds);
          if (planned.issues.length > 0) {
            const missing = planned.issues.find(({ code }) => code === "presetNotFound");
            if (missing) {
              throw semanticFailure("presetNotFound", "$.params.presetId", missing.message, -32020);
            }
            throw semanticFailure(
              "invalidPreset",
              "$.params",
              "The Preset request is invalid.",
              -32602,
              { issues: planned.issues }
            );
          }
          const result = {
            dryRun: request.params.dryRun === true,
            changed: planned.changed.length > 0,
            ...(planned.deletedPreset ? { deletedPreset: planned.deletedPreset } : {}),
            state: {
              ...(planned.preset ? { preset: planned.preset } : {}),
              presets: {
                activeId: planned.presets.activeId,
                dirty: planned.presets.dirty === true,
                ...(planned.presetIds ? { presetIds: planned.presetIds } : {}),
              },
            },
            revision: currentRevision,
            warnings: planned.warnings,
          };
          if (request.params.dryRun === true || planned.changed.length === 0) {
            return { requestId, result };
          }

          const committed = new Promise((resolve, reject) => {
            presetSettlementRef.current = {
              signature: presetStateSignature(planned.presets),
              resolve,
              reject,
            };
          });
          if (request.method === "preset.rename") {
            presets.rename(request.params.presetId, planned.preset.name);
          } else if (request.method === "preset.delete") {
            presets.remove(request.params.presetId);
          } else {
            presets.reorder(planned.presetIds);
          }
          result.revision = await awaitSettlement(
            committed,
            () => {
              presetSettlementRef.current = null;
            },
            "The Preset order"
          );
          try {
            await flush();
          } catch (error) {
            throw semanticFailure(
              "persistenceFailed",
              "$",
              `Preset state committed but persistence failed: ${error?.message || String(error)}`,
              -32030,
              { stateCommitted: true, revision: result.revision }
            );
          }
          return { requestId, result };
        }

        if (request.method === "theme.inspect" || request.method === "theme.list") {
          const currentTheme = latestThemeRef.current.state;
          return {
            requestId,
            result: {
              revision: controlRevisionRef.current,
              appearance: currentTheme.appearance,
              ...(request.method === "theme.list"
                ? { themes: listThemeSummaries(currentTheme) }
                : {}),
            },
          };
        }

        if (request.method === "theme.describe") {
          const currentTheme = latestThemeRef.current.state;
          const builtin = BUILTIN_THEMES_V2[request.params.themeId];
          const index = currentTheme.themes.findIndex(({ id }) => id === request.params.themeId);
          const document = builtin ?? (index >= 0 ? currentTheme.themes[index] : null);
          if (!document) {
            throw semanticFailure(
              "themeNotFound",
              "$.params.themeId",
              `Theme ${request.params.themeId} was not found.`,
              -32020
            );
          }
          return {
            requestId,
            result: {
              revision: controlRevisionRef.current,
              theme: structuredClone(document),
              kind: builtin ? "builtin" : "custom",
              active: currentTheme.appearance.resolvedThemeId === document.id,
              index: builtin ? null : index,
            },
          };
        }

        const themeMutations = new Set([
          "theme.select",
          "theme.followSystem",
          "theme.create",
          "theme.update",
          "theme.rename",
          "theme.duplicate",
          "theme.delete",
          "theme.reorder",
        ]);
        if (themeMutations.has(request.method)) {
          const currentRevision = controlRevisionRef.current;
          if (request.params.expectedRevision !== currentRevision) {
            throw semanticFailure(
              "revisionConflict",
              "$.params.expectedRevision",
              `Themes changed after revision ${request.params.expectedRevision}.`,
              -32004,
              { expectedRevision: request.params.expectedRevision, currentRevision }
            );
          }
          const control = latestThemeRef.current.control;
          if (!control) {
            throw semanticFailure(
              "controlUnavailable",
              "$",
              "Theme Control is unavailable.",
              -32012
            );
          }
          if (request.method !== "theme.reorder") control.assertAllowed(request.method);

          const dryRun = request.params.dryRun === true;
          const makeId = () => `custom-${crypto.randomUUID()}`;
          const planned =
            request.method === "theme.select"
              ? control.planSelect(request.params.themeId)
              : request.method === "theme.followSystem"
                ? control.planFollowSystem()
                : request.method === "theme.create"
                  ? control.planCreate(request.params.document, dryRun ? undefined : { makeId })
                  : request.method === "theme.update"
                    ? control.planUpdate(request.params.themeId, request.params.document)
                    : request.method === "theme.rename"
                      ? control.planRename(request.params.themeId, request.params.name)
                      : request.method === "theme.duplicate"
                        ? control.planDuplicate(
                            request.params.themeId,
                            request.params.name,
                            dryRun ? undefined : { makeId }
                          )
                        : request.method === "theme.delete"
                          ? control.planDelete(request.params.themeId)
                          : control.planReorder(request.params.themeIds);

          if (planned.issues.length > 0) {
            const first = planned.issues[0];
            const paths = {
              themeNotFound: "$.params.themeId",
              themeNotMutable: "$.params.themeId",
              invalidPermutation: "$.params.themeIds",
              invalidName: "$.params.name",
            };
            const codes = {
              themeNotFound: -32020,
              themeNotMutable: -32602,
              invalidPermutation: -32602,
              invalidName: -32602,
            };
            const reason = paths[first.code] ? first.code : "invalidTheme";
            throw semanticFailure(
              reason,
              paths[first.code] ?? "$.params.document",
              reason === "invalidTheme" ? "The Theme document is invalid." : first.message,
              codes[first.code] ?? -32602,
              { issues: planned.issues }
            );
          }

          const result = {
            dryRun,
            revision: currentRevision,
            changed: planned.changed.length > 0,
            warnings: planned.warnings,
            plan: themePlanResult(request.method, planned),
            state: compactThemeState(planned.state),
          };
          if (dryRun || planned.changed.length === 0) return { requestId, result };

          const committed = new Promise((resolve, reject) => {
            themeSettlementRef.current = {
              signature: themeStateSignature(planned.state),
              resolve,
              reject,
            };
          });
          control.commit(planned);
          result.revision = await awaitSettlement(
            committed,
            () => {
              themeSettlementRef.current = null;
            },
            "The Theme change"
          );
          result.state = compactThemeState(latestThemeRef.current.state);
          try {
            await flush();
          } catch (error) {
            throw semanticFailure(
              "persistenceFailed",
              "$",
              `Theme committed but persistence failed: ${error?.message || String(error)}`,
              -32030,
              { stateCommitted: true, revision: result.revision }
            );
          }
          return { requestId, result };
        }

        // `preset.list` is handled above and keeps its own richer shape; the guard is here so a
        // later reordering of these branches cannot silently swap it for the generic one.
        const libraryMatch = /^(preset|theme|loudnessProfile)\.(list|export|import)$/.exec(
          request.method
        );
        if (libraryMatch && !(libraryMatch[1] === "preset" && libraryMatch[2] === "list")) {
          const [, family, action] = libraryMatch;
          const { stateKey, notFoundCode } = libraryFamily(family);

          if (action === "list") {
            const entries = buildLibraryList(family);
            return {
              requestId,
              result: {
                revision: controlRevisionRef.current,
                [stateKey]: entries,
                ...(family === "loudnessProfile"
                  ? { activeId: activeLoudnessProfileId(entries) }
                  : {}),
              },
            };
          }

          if (action === "export") {
            if (
              family === "theme" &&
              request.params.ids?.some((id) => Object.hasOwn(BUILTIN_THEMES_V2, id))
            ) {
              const builtinIds = request.params.ids.filter((id) =>
                Object.hasOwn(BUILTIN_THEMES_V2, id)
              );
              throw semanticFailure(
                "themeNotExportable",
                "$.params.ids",
                `Built-in Themes cannot be exported: ${builtinIds.join(", ")}.`,
                -32602,
                { themeIds: builtinIds }
              );
            }
            const planned = planLibraryExport(family, request.params.ids);
            if (planned.missingIds.length > 0) {
              throw semanticFailure(
                notFoundCode,
                "$.params.ids",
                `These ids are not in the library: ${planned.missingIds.join(", ")}.`,
                -32020,
                { missingIds: planned.missingIds }
              );
            }
            return {
              requestId,
              result: { revision: controlRevisionRef.current, pack: planned.pack },
            };
          }

          // Import is deliberately not a scene operation: the merge only appends, moves no
          // selection and dirties no Preset, so it cannot destroy an open editor's draft. The
          // GUI's own Import buttons are not disabled by editor state either.
          const currentRevision = controlRevisionRef.current;
          if (
            request.params.expectedRevision !== undefined &&
            request.params.expectedRevision !== currentRevision
          ) {
            throw semanticFailure(
              "revisionConflict",
              "$.params.expectedRevision",
              `App state changed after revision ${request.params.expectedRevision}.`,
              -32004,
              { expectedRevision: request.params.expectedRevision, currentRevision }
            );
          }

          let planned;
          try {
            planned = planLibraryImport(family, request.params.pack);
          } catch (error) {
            if (!(error instanceof PackValidationError)) throw error;
            // The message is the one a recipient of a shared file needs -- which library the file
            // belongs to, or that it is a whole configuration -- so it is passed through verbatim.
            throw semanticFailure("invalidPack", "$.params.pack", error.message, -32602);
          }

          const result = {
            dryRun: request.params.dryRun === true,
            revision: currentRevision,
            changed: planned.changed,
            warnings: [],
            plan: planned.plan,
            state: { [stateKey]: buildLibraryList(family) },
          };
          if (result.dryRun || !planned.changed) {
            return { requestId, result };
          }

          const committed = new Promise((resolve, reject) => {
            librarySettlementRef.current = { families: planned.writes, resolve, reject };
          });
          planned.commit();
          result.state = { [stateKey]: buildLibraryList(family) };
          result.revision = await awaitSettlement(
            committed,
            () => {
              librarySettlementRef.current = null;
            },
            "The library import"
          );
          try {
            await flush();
          } catch (error) {
            throw semanticFailure(
              "persistenceFailed",
              "$",
              `Library committed but persistence failed: ${error?.message || String(error)}`,
              -32030,
              { stateCommitted: true, revision: result.revision }
            );
          }
          return { requestId, result };
        }

        if (request.method === "config.export") {
          const configuration = await exportConfiguration();
          return {
            requestId,
            result: {
              revision: controlRevisionRef.current,
              configuration,
            },
          };
        }

        if (request.method === "config.import") {
          const currentRevision = controlRevisionRef.current;
          if (request.params.expectedRevision !== currentRevision) {
            throw semanticFailure(
              "revisionConflict",
              "$.params.expectedRevision",
              `App state changed after revision ${request.params.expectedRevision}.`,
              -32004,
              { expectedRevision: request.params.expectedRevision, currentRevision }
            );
          }
          presets.assertSceneOperationAllowed(request.method);

          let configuration;
          try {
            configuration = normalizeConfiguration(request.params.configuration);
          } catch (error) {
            if (!(error instanceof ProfileValidationError)) throw error;
            throw semanticFailure(
              "invalidConfiguration",
              "$.params.configuration",
              error.message,
              -32602
            );
          }

          if (request.params.dryRun === true) {
            return {
              requestId,
              result: {
                dryRun: true,
                revision: currentRevision,
                changed: true,
                relaunch: false,
                configuration,
              },
            };
          }

          try {
            await importConfiguration(configuration);
          } catch (error) {
            throw semanticFailure(
              "persistenceFailed",
              "$",
              `Configuration import failed: ${error?.message || String(error)}`,
              -32030
            );
          }
          return {
            requestId,
            result: {
              dryRun: false,
              revision: currentRevision,
              changed: true,
              relaunch: true,
            },
            awaitDelivery: true,
            afterResponse: relaunchAfterConfigurationChange,
          };
        }

        if (request.method === "axis.describe" || request.method === "axis.inspect") {
          const inspection = buildAxisInspection(workspace);
          return {
            requestId,
            result: {
              revision: controlRevisionRef.current,
              ...(request.method === "axis.describe"
                ? { schema: buildAxisSchema(analysisContext) }
                : {}),
              ...inspection,
            },
          };
        }

        if (
          request.method === "axis.shared.update" ||
          request.method === "axis.shared.reset" ||
          request.method === "axis.panel.update" ||
          request.method === "axis.panel.reset"
        ) {
          const currentRevision = controlRevisionRef.current;
          if (
            request.params.expectedRevision !== undefined &&
            request.params.expectedRevision !== currentRevision
          ) {
            throw semanticFailure(
              "revisionConflict",
              "$.params.expectedRevision",
              `Workspace changed after revision ${request.params.expectedRevision}.`,
              -32004,
              {
                expectedRevision: request.params.expectedRevision,
                currentRevision,
              }
            );
          }
          const planned =
            request.method === "axis.shared.update"
              ? planSharedAxisUpdate(
                  workspace,
                  request.params.kind,
                  request.params.range,
                  analysisContext
                )
              : request.method === "axis.shared.reset"
                ? planSharedAxisReset(workspace, request.params.kind)
                : request.method === "axis.panel.update"
                  ? planPanelAxisUpdate(
                      workspace,
                      request.params.panelId,
                      request.params.kind,
                      request.params.patch,
                      analysisContext
                    )
                  : planPanelAxisReset(workspace, request.params.panelId, request.params.kind);
          if (planned.issues.length > 0) {
            const target = planned.issues.find(({ code }) =>
              ["panelNotFound", "axisNotFound", "axisUnavailable"].includes(code)
            );
            if (target) {
              const codes = {
                panelNotFound: -32010,
                axisNotFound: -32011,
                axisUnavailable: -32012,
              };
              throw semanticFailure(
                target.code,
                target.path === "$.panelId" ? "$.params.panelId" : "$.params.kind",
                target.message,
                codes[target.code]
              );
            }
            throw semanticFailure(
              "invalidAxis",
              request.method.includes(".update") ? "$.params" : "$.params.kind",
              "The axis request is invalid.",
              -32602,
              { issues: planned.issues }
            );
          }
          const result = {
            dryRun: request.params.dryRun === true,
            revision: currentRevision,
            changed: planned.changed.length > 0,
            warnings: planned.warnings,
            state: {
              axis: buildAxisInspection(planned.workspace),
              preset: panelResultPreset(presets, planned.changed),
            },
          };
          if (request.params.dryRun === true || planned.changed.length === 0) {
            return { requestId, result };
          }

          const committed = new Promise((resolve, reject) => {
            settlementRef.current = {
              view: planned.workspace,
              matches: (currentWorkspace) => axisStateMatches(currentWorkspace, planned.workspace),
              resolve,
              reject,
            };
          });
          replaceWorkspace(planned.workspace);
          result.revision = await awaitSettlement(
            committed,
            () => {
              settlementRef.current = null;
            },
            "The axis change"
          );
          await waitForWorkspacePersistenceEnqueue(planned.workspace);
          try {
            await flush();
          } catch (error) {
            throw semanticFailure(
              "persistenceFailed",
              "$",
              `Axis state committed but persistence failed: ${error?.message || String(error)}`,
              -32030,
              { stateCommitted: true, revision: result.revision }
            );
          }
          return { requestId, result };
        }

        if (request.method === "panel.describe") {
          const panelId = request.params.panelId;
          const panel = workspace.panelsById?.[panelId];
          if (!panel) {
            throw semanticFailure(
              "panelNotFound",
              "$.params.panelId",
              `Panel ${panelId} was not found.`,
              -32010
            );
          }
          const context = { ...analysisContext, hasLoudnessReference };
          return {
            requestId,
            result: {
              revision: controlRevisionRef.current,
              panel: buildAgentControlPanelSnapshot({
                workspace,
                panelId,
                hasLoudnessReference,
                analysisContext,
              }),
              schema: buildPublicPanelControlSchema(
                panel.moduleId,
                workspace.panelControlsById?.[panelId],
                context
              ),
            },
          };
        }

        if (request.method === "panel.update" || request.method === "panel.reset") {
          const currentRevision = controlRevisionRef.current;
          if (
            request.params.expectedRevision !== undefined &&
            request.params.expectedRevision !== currentRevision
          ) {
            throw semanticFailure(
              "revisionConflict",
              "$.params.expectedRevision",
              `Workspace changed after revision ${request.params.expectedRevision}.`,
              -32004,
              {
                expectedRevision: request.params.expectedRevision,
                currentRevision,
              }
            );
          }
          const panelId = request.params.panelId;
          const panel = workspace.panelsById?.[panelId];
          if (!panel) {
            throw semanticFailure(
              "panelNotFound",
              "$.params.panelId",
              `Panel ${panelId} was not found.`,
              -32010
            );
          }
          const context = { ...analysisContext, hasLoudnessReference };
          const planned =
            request.method === "panel.reset"
              ? planPublicPanelReset(
                  panel.moduleId,
                  workspace.panelControlsById?.[panelId],
                  context
                )
              : planPublicPanelControlPatch(
                  panel.moduleId,
                  workspace.panelControlsById?.[panelId],
                  request.params.patch,
                  context
                );
          if (planned.issues.length > 0) {
            throw semanticFailure(
              "invalidControls",
              request.method === "panel.update" ? "$.params.patch" : "$.params",
              "The panel controls are invalid.",
              -32602,
              { issues: planned.issues }
            );
          }
          const nextWorkspace = {
            ...workspace,
            panelControlsById: {
              ...workspace.panelControlsById,
              [panelId]: planned.panelControls,
            },
          };
          const result = {
            dryRun: request.params.dryRun === true,
            revision: currentRevision,
            changed: planned.changed.length > 0,
            warnings: planned.warnings,
            state: {
              panel: buildAgentControlPanelSnapshot({
                workspace: nextWorkspace,
                panelId,
                hasLoudnessReference,
                analysisContext,
              }),
              preset: panelResultPreset(presets, planned.changed),
            },
          };
          if (request.params.dryRun === true || planned.changed.length === 0) {
            return { requestId, result };
          }

          const committed = new Promise((resolve, reject) => {
            settlementRef.current = {
              view: nextWorkspace,
              matches: (currentWorkspace) =>
                panelControlsMatch(currentWorkspace, nextWorkspace, panelId),
              resolve,
              reject,
            };
          });
          setPanelControlsForPanel(panelId, planned.panelControls);
          result.revision = await awaitSettlement(
            committed,
            () => {
              settlementRef.current = null;
            },
            "The panel controls change"
          );
          await waitForWorkspacePersistenceEnqueue(nextWorkspace);
          try {
            await flush();
          } catch (error) {
            throw semanticFailure(
              "persistenceFailed",
              "$",
              `Panel controls committed but persistence failed: ${error?.message || String(error)}`,
              -32030,
              { stateCommitted: true, revision: result.revision }
            );
          }
          return { requestId, result };
        }

        const currentRevision = controlRevisionRef.current;
        if (
          request.params.expectedRevision !== undefined &&
          request.params.expectedRevision !== currentRevision
        ) {
          throw semanticFailure(
            "revisionConflict",
            "$.params.expectedRevision",
            `Workspace changed after revision ${request.params.expectedRevision}.`,
            -32004
          );
        }

        const compiled = compileWorkspaceLayout(request.params.layout, workspace);
        const layoutIsUnchanged =
          Object.keys(compiled.createdPanels).length === 0 &&
          JSON.stringify(compiled.layout) === JSON.stringify(serializeWorkspaceLayout(workspace));
        const result = {
          revision: currentRevision,
          dryRun: request.params.dryRun === true,
          changed: !layoutIsUnchanged,
          state: { workspace: { layout: compiled.layout } },
          createdPanels: compiled.createdPanels,
        };
        if (request.params.dryRun === true || layoutIsUnchanged) return { requestId, result };

        const committed = new Promise((resolve, reject) => {
          settlementRef.current = {
            view: compiled.view,
            matches: (currentWorkspace) => workspaceMatches(currentWorkspace, compiled.view),
            resolve,
            reject,
          };
        });
        replaceWorkspace(compiled.view);
        const committedRevision = await awaitSettlement(
          committed,
          () => {
            settlementRef.current = null;
          },
          "The Workspace layout"
        );
        await waitForWorkspacePersistenceEnqueue(compiled.view);
        try {
          await flush();
        } catch (error) {
          throw semanticFailure(
            "persistenceFailed",
            "$",
            `Workspace committed but persistence failed: ${error?.message || String(error)}`,
            -32030,
            { stateCommitted: true, revision: committedRevision }
          );
        }

        result.revision = committedRevision;
        return { requestId, result };
      } catch (error) {
        // One place rather than nine: `isCommitNotObserved` is true only for the settlement
        // timeout, so every pre-commit failure -- validation, `revisionConflict`, `editorActive`,
        // a refused scene operation -- still reaches here without touching the disk.
        if (isCommitNotObserved(error)) {
          return {
            requestId,
            error: agentControlRpcError(await persistUnobservedCommit(error, flush)),
          };
        }
        const semantic =
          error instanceof WorkspaceLayoutError
            ? semanticFailure(error.reason, error.path, error.message, -32602)
            : isSceneOperationRefused(error)
              ? semanticFailure(error.code, "$", error.message, -32040, {
                  operation: error.operation,
                  ...(Array.isArray(error.editors) ? { editors: error.editors } : {}),
                  ...(typeof error.reason === "string" ? { reason: error.reason } : {}),
                })
              : error;
        return { requestId, error: agentControlRpcError(semantic) };
      } finally {
        if (revisionBatch && revisionBatchRef.current === revisionBatch) {
          revisionBatchRef.current = null;
          if (revisionBatch.wakePending) publishWaitWake();
        }
      }
    };
  }, [
    flush,
    exportConfiguration,
    importConfiguration,
    normalizeConfiguration,
    relaunchAfterConfigurationChange,
    bumpControlRevision,
    hasLoudnessReference,
    loudnessActive,
    loudnessProfile,
    loudnessProfiles,
    analysisContext,
    measurementContext,
    applySettings,
    executeTransport,
    device,
    dock,
    dockContext,
    executeDock,
    presets,
    publishWaitWake,
    replaceWorkspace,
    runtime,
    scheduleWaitWake,
    settings,
    settingsContext,
    transport,
    transportContext,
    setPanelControlsForPanel,
    waitForWorkspacePersistenceEnqueue,
    workspace,
  ]);

  useEffect(() => {
    if (!enabled) return undefined;
    const waiters = waitersRef.current;
    aliveRef.current = true;
    // Per-run, unlike `aliveRef`: a remount sets that shared ref back to true, so an install left
    // over from the previous run cannot use it to tell that its own run was torn down. Believing
    // it could is what left two listeners attached, and every request then ran twice.
    let cancelled = false;
    let unlisten = null;
    let ready = false;

    const install = async () => {
      const stop = await listenForAgentControlRequests((request) => {
        if (request?.type === "cancel" && typeof request.requestId === "string") {
          const waiter = waiters.get(request.requestId);
          if (waiter) {
            clearTimeout(waiter.timer);
            waiter.unsubscribe?.();
            waiters.delete(request.requestId);
            waiter.resolve(WAIT_CANCELLED);
          }
          return;
        }
        const respond = (processing) =>
          processing
            .then(async (response) => {
              if (!response || !aliveRef.current) return;
              const { afterResponse, ...wireResponse } = response;
              await respondToAgentControlRequest(wireResponse);
              if (afterResponse && aliveRef.current) await afterResponse();
            })
            .catch(() => undefined);
        if (
          request?.method === "app.wait" ||
          request?.method === "measurement.wait" ||
          request?.method === "measurement.describe" ||
          request?.method === "measurement.inspect"
        ) {
          void respond(processRef.current(request));
          return;
        }
        queueRef.current = queueRef.current.then(() => processRef.current(request));
        void respond(queueRef.current);
      });
      if (cancelled) {
        stop();
        return;
      }
      unlisten = stop;
      await announceAgentControlFrontendReady();
      if (cancelled) {
        // Teardown ran during the announce, so it saw `ready` still false and left the broker
        // believing a frontend is listening. Undo both halves here.
        unlisten?.();
        unlisten = null;
        void announceAgentControlFrontendNotReady();
        return;
      }
      ready = true;
    };
    void install().catch(() => {
      unlisten?.();
      unlisten = null;
    });

    return () => {
      cancelled = true;
      aliveRef.current = false;
      const settlement = settlementRef.current;
      settlementRef.current = null;
      settlement?.reject(new Error("Agent-control bridge unmounted."));
      const presetSettlement = presetSettlementRef.current;
      presetSettlementRef.current = null;
      presetSettlement?.reject(new Error("Agent-control bridge unmounted."));
      const librarySettlement = librarySettlementRef.current;
      librarySettlementRef.current = null;
      librarySettlement?.reject(new Error("Agent-control bridge unmounted."));
      const loudnessProfileSettlement = loudnessProfileSettlementRef.current;
      loudnessProfileSettlementRef.current = null;
      loudnessProfileSettlement?.reject(new Error("Agent-control bridge unmounted."));
      const themeSettlement = themeSettlementRef.current;
      themeSettlementRef.current = null;
      themeSettlement?.reject(new Error("Agent-control bridge unmounted."));
      const settingsSettlement = settingsSettlementRef.current;
      settingsSettlementRef.current = null;
      settingsSettlement?.reject(new Error("Agent-control bridge unmounted."));
      const transportSettlement = transportSettlementRef.current;
      transportSettlementRef.current = null;
      transportSettlement?.reject(new Error("Agent-control bridge unmounted."));
      const dockSettlement = dockSettlementRef.current;
      dockSettlementRef.current = null;
      dockSettlement?.reject(new Error("Agent-control bridge unmounted."));
      for (const waiter of waiters.values()) {
        clearTimeout(waiter.timer);
        waiter.unsubscribe?.();
        waiter.reject(new Error("Agent-control bridge unmounted."));
      }
      waiters.clear();
      unlisten?.();
      unlisten = null;
      if (ready) void announceAgentControlFrontendNotReady();
    };
  }, [enabled]);
}
