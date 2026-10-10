import { dockStateSignature } from "../dockControl.js";
import { transportLifecycleSignature } from "../transportControl.js";
import { viewStateSignature } from "../viewControl.js";
import {
  controllableWorkspaceMatches,
  measuredAudioState,
  ordinarySettingsStateSignature,
  presetStateSignature,
  requestedDeviceSignature,
  settingsStateSignature,
} from "./signatures.js";

/**
 * A domain is one area of app state the bridge observes. After every React commit its watcher
 * decides whether the public revision advances and whether a settlement parked on the domain has
 * been rendered.
 *
 * @typedef {{
 *   inputs: Record<string, any>,
 *   memory: Record<string, any>,
 *   clock: ReturnType<typeof import("./revisionClock.js").createRevisionClock>,
 *   settlement: ReturnType<typeof import("./settlement.js").createSettlementRegistry>,
 *   recordings: Map<string, any>,
 * }} DomainObservation
 *
 * @typedef {{
 *   name: string,
 *   init: (inputs: Record<string, any>) => Record<string, any>,
 *   deps: (inputs: Record<string, any>) => any[],
 *   observe: (observation: DomainObservation) => void,
 * }} Domain
 */

/// Resolved by the watcher for a library the `*.import` in flight actually wrote -- which is
/// `planLibraryImport`'s `writes`, not the family the request named. A Preset pack can write the
/// Loudness library alone, and waiting on the Preset watcher there times out on a commit that
/// succeeded. `commit` writes both stores synchronously, so when it writes two libraries both
/// watchers fire in the same React commit and the first to arrive is the right answer.
///
/// Import does not bump the revision itself. Every library it can write is watched -- the theme,
/// Loudness Profile and Preset domains below -- and each watcher bumps when the write reaches
/// React. Doing both moved the revision by two for a single import (measured, not reasoned about:
/// `clock.bump`'s same-turn guard has already reset by the time the re-render lands). Nothing
/// about that is visible -- no error, an ordinary-looking number -- except that every later
/// `--expected-revision` starts conflicting.
function resolveLibrary(settlement, family) {
  const pending = settlement.peek("library");
  if (!pending || !pending.families.includes(family)) return;
  settlement.resolve("library");
}

/// A Loudness Profile change can rewrite Presets that reference the profile, so its settlement
/// lists every store it expects and resolves once each has rendered its expected signature.
function observeLoudnessProfileStore(settlement, store, signature) {
  const pending = settlement.peek("loudnessProfile");
  if (!pending || pending.expected[store] !== signature) return;
  pending.observed.add(store);
  if (Object.keys(pending.expected).every((key) => pending.observed.has(key))) {
    settlement.resolve("loudnessProfile");
  }
}

function pushRecordingAudioState(recordings, visualControl, audioState) {
  for (const [recordingId, metadata] of recordings) {
    if (metadata.audio !== "measuredSource") continue;
    void visualControl
      ?.updateRecordingAudioState?.({ recordingId, state: audioState })
      .catch(() => undefined);
  }
}

/** @type {Domain} */
const view = {
  name: "view",
  init: (inputs) => ({ signature: viewStateSignature(inputs.viewContext.view) }),
  deps: (inputs) => [inputs.viewContext],
  observe({ inputs, memory, clock, settlement }) {
    const signature = viewStateSignature(inputs.viewContext.view);
    if (signature !== memory.signature) {
      memory.signature = signature;
      clock.bump();
      clock.scheduleWake();
    }
    const pending = settlement.peek("view");
    if (pending && pending.signature === signature) settlement.resolve("view");
  },
};

/** @type {Domain} */
const workspace = {
  name: "workspace",
  init: (inputs) => ({ workspace: inputs.workspace }),
  deps: (inputs) => [inputs.workspace],
  observe({ inputs, memory, clock, settlement }) {
    const changed = !controllableWorkspaceMatches(memory.workspace, inputs.workspace);
    memory.workspace = inputs.workspace;
    if (changed) clock.bumpWorkspace();
    const pending = settlement.peek("workspace");
    if (pending && pending.matches(inputs.workspace)) settlement.resolve("workspace");
  },
};

/** @type {Domain} */
const presets = {
  name: "presets",
  init: (inputs) => ({ signature: presetStateSignature(inputs.presets) }),
  deps: (inputs) => [inputs.presets],
  observe({ inputs, memory, clock, settlement }) {
    const signature = presetStateSignature(inputs.presets);
    if (signature !== memory.signature) {
      memory.signature = signature;
      clock.bump();
      clock.scheduleWake();
      resolveLibrary(settlement, "preset");
    }
    const pending = settlement.peek("presets");
    if (pending && signature === pending.signature) settlement.resolve("presets");
    observeLoudnessProfileStore(settlement, "presets", signature);
  },
};

/** @type {Domain} */
const theme = {
  name: "theme",
  init: (inputs) => ({ signature: inputs.themeSignature }),
  deps: (inputs) => [inputs.themeControl, inputs.themeSignature, inputs.themeState],
  observe({ inputs, memory, clock, settlement }) {
    const signature = inputs.themeSignature;
    if (signature !== memory.signature) {
      memory.signature = signature;
      clock.bump();
      clock.scheduleWake();
      resolveLibrary(settlement, "theme");
    }
    const pending = settlement.peek("theme");
    if (pending && pending.signature === signature) settlement.resolve("theme");
  },
};

/** @type {Domain} */
const loudnessProfile = {
  name: "loudnessProfile",
  init: (inputs) => ({ signature: inputs.loudnessSignature }),
  deps: (inputs) => [inputs.loudnessSignature],
  observe({ inputs, memory, clock, settlement }) {
    const signature = inputs.loudnessSignature;
    if (signature !== memory.signature) {
      memory.signature = signature;
      clock.bump();
      clock.scheduleWake();
      resolveLibrary(settlement, "loudnessProfile");
    }
    observeLoudnessProfileStore(settlement, "loudnessProfile", signature);
  },
};

/// `openAtLogin` and `clearShortcut` are read from the operating system after startup. Their first
/// real value replacing the placeholder is not a change anyone made, so each counts only once its
/// source has reported ready.
/** @type {Domain} */
const settings = {
  name: "settings",
  init: (inputs) => ({
    ordinary: ordinarySettingsStateSignature(inputs.settings),
    openAtLogin: {
      ready: inputs.settingsContext.autostartReady === true,
      value: inputs.settings?.openAtLogin,
    },
    clearShortcut: {
      ready: inputs.settingsContext.clearShortcutReady === true,
      signature: JSON.stringify(inputs.settings?.clearShortcut ?? null),
    },
  }),
  deps: (inputs) => [
    inputs.settings,
    inputs.settingsContext.autostartReady,
    inputs.settingsContext.clearShortcutReady,
  ],
  observe({ inputs, memory, clock, settlement }) {
    const signature = settingsStateSignature(inputs.settings);
    const ordinarySignature = ordinarySettingsStateSignature(inputs.settings);
    let changed = false;
    if (ordinarySignature !== memory.ordinary) {
      memory.ordinary = ordinarySignature;
      changed = true;
    }

    const openAtLogin = memory.openAtLogin;
    if (inputs.settingsContext.autostartReady === true) {
      if (openAtLogin.ready && openAtLogin.value !== inputs.settings?.openAtLogin) changed = true;
      openAtLogin.ready = true;
      openAtLogin.value = inputs.settings?.openAtLogin;
    } else {
      openAtLogin.ready = false;
    }

    const clearShortcut = memory.clearShortcut;
    const clearShortcutSignature = JSON.stringify(inputs.settings?.clearShortcut ?? null);
    if (inputs.settingsContext.clearShortcutReady === true) {
      if (clearShortcut.ready && clearShortcut.signature !== clearShortcutSignature) changed = true;
      clearShortcut.ready = true;
      clearShortcut.signature = clearShortcutSignature;
    } else {
      clearShortcut.ready = false;
    }

    if (changed) {
      clock.bump();
      clock.scheduleWake();
    }
    const pending = settlement.peek("settings");
    if (pending && signature === pending.signature) settlement.resolve("settings");
  },
};

/** @type {Domain} */
const transport = {
  name: "transport",
  init: (inputs) => ({ signature: transportLifecycleSignature(inputs.transport) }),
  deps: (inputs) => [inputs.transport],
  observe({ inputs, memory, clock, settlement, recordings }) {
    const visualControl = inputs.visual;
    const runtime = visualControl?.getRuntime?.() ?? {};
    pushRecordingAudioState(
      recordings,
      visualControl,
      measuredAudioState(runtime, inputs.transport)
    );
    const signature = transportLifecycleSignature(inputs.transport);
    if (signature !== memory.signature) {
      memory.signature = signature;
      clock.bump();
      clock.scheduleWake();
    }
    const pending = settlement.peek("transport");
    if (pending && pending.matches(inputs.transport)) settlement.resolve("transport");
  },
};

/** @type {Domain} */
const device = {
  name: "device",
  init: (inputs) => ({ requestedId: requestedDeviceSignature(inputs.device) }),
  deps: (inputs) => [inputs.device],
  observe({ inputs, memory, clock, settlement, recordings }) {
    const visualControl = inputs.visual;
    const runtime = visualControl?.getRuntime?.() ?? {};
    const audioState =
      inputs.device?.live?.transition != null
        ? "liveRestart"
        : measuredAudioState(runtime, inputs.transport);
    pushRecordingAudioState(recordings, visualControl, audioState);
    const requestedId = requestedDeviceSignature(inputs.device);
    if (requestedId !== memory.requestedId) {
      memory.requestedId = requestedId;
      clock.bump();
      clock.scheduleWake();
    }
    const pending = settlement.peek("device");
    if (pending && requestedId === pending.requestedId) settlement.resolve("device");
  },
};

/** @type {Domain} */
const dock = {
  name: "dock",
  init: (inputs) => ({ signature: dockStateSignature(inputs.dock) }),
  deps: (inputs) => [inputs.dock],
  observe({ inputs, memory, clock, settlement }) {
    const signature = dockStateSignature(inputs.dock);
    if (signature !== memory.signature) {
      memory.signature = signature;
      clock.bumpWorkspace();
    }
    const pending = settlement.peek("dock");
    if (pending && pending.matches(inputs.dock)) settlement.resolve("dock");
  },
};

/// The order is the order the watchers run in within one commit. It is load-bearing: the Device
/// watcher reads the Transport of the same commit, and a library import that writes two libraries
/// is settled by whichever of them comes first here.
/** @type {readonly Domain[]} */
export const DOMAINS = Object.freeze([
  view,
  workspace,
  presets,
  theme,
  loudnessProfile,
  settings,
  transport,
  device,
  dock,
]);

export const DOMAIN_NAMES = Object.freeze(DOMAINS.map(({ name }) => name));

/**
 * @param {{
 *   clock: DomainObservation["clock"],
 *   settlement: DomainObservation["settlement"],
 *   recordings: Map<string, any>,
 *   initialInputs: Record<string, any>,
 * }} options
 */
export function createDomainRunner({ clock, settlement, recordings, initialInputs }) {
  const states = DOMAINS.map((domain) => ({
    domain,
    /** @type {any[] | null} */
    deps: null,
    memory: domain.init(initialInputs),
  }));
  /**
   * Call once per React commit. A domain whose `deps` did not change is skipped, exactly as an
   * effect with unchanged dependencies does not run, so a settlement is examined only when its own
   * domain rendered something new.
   *
   * @param {Record<string, any>} inputs
   */
  return function observeCommit(inputs) {
    for (const state of states) {
      const deps = state.domain.deps(inputs);
      const previous = state.deps;
      if (previous && deps.every((value, index) => Object.is(value, previous[index]))) continue;
      state.deps = deps;
      state.domain.observe({ inputs, memory: state.memory, clock, settlement, recordings });
    }
  };
}
