import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TrayIcon } from "@tauri-apps/api/tray";
import { Menu, Submenu, MenuItem, CheckMenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { Image } from "@tauri-apps/api/image";
import { resolveResource } from "@tauri-apps/api/path";
import { isTauri } from "../ipc/env.js";
import { isMacOS } from "../lib/platform.js";
import { formatAudioDeviceLabel } from "../lib/audioDeviceLabels.js";
import {
  clearCurrentTrayIcon,
  closeTrayIcon,
  PLVS_TRAY_ID,
  setCurrentTrayIcon,
} from "../lib/trayIconLifecycle.js";
import { useCoordinatorRole } from "../lib/runtimeRole.js";
import { useTaskbarColorScheme } from "./useTaskbarColorScheme.js";
import { issueInstanceCommand, quitAllInstances } from "../runtime/coordination.js";

// The dark icon is a white glyph for a dark surface; the light icon is a black glyph.
/**
 * @param {string} scheme
 */
async function loadTrayIcon(scheme) {
  const iconName = scheme === "light" ? "icons/tray-light.png" : "icons/tray-dark.png";
  return Image.fromPath(await resolveResource(iconName));
}

// formatAudioDeviceLabel returns { primary, secondary, full }; a menu item's
// text must be a single string. Reconstruct the picker's compact form.
/**
 * @param {string} label
 */
function menuDeviceText(label) {
  const { primary, secondary } = formatAudioDeviceLabel(label);
  return secondary ? `${primary} (${secondary})` : primary;
}

function sourceLabelFor({
  safeAudioDeviceId,
  audioOutputs,
  audioInputs,
  captureApplications,
  defaultOutputLabel,
}) {
  if (safeAudioDeviceId === "default") {
    const label = defaultOutputLabel ? menuDeviceText(defaultOutputLabel) : "Automatic";
    return `Output · ${label}`;
  }
  const application = captureApplications.find((candidate) => candidate.id === safeAudioDeviceId);
  if (application) return `Application · ${application.label}`;
  const output = audioOutputs.find((device) => device.id === safeAudioDeviceId);
  if (output) return `Output · ${menuDeviceText(output.label)}`;
  const input = audioInputs.find((device) => device.id === safeAudioDeviceId);
  return input ? `Input · ${menuDeviceText(input.label)}` : "Not connected";
}

async function buildSourceItems({
  audioOutputs,
  audioInputs,
  captureApplications,
  safeAudioDeviceId,
  onSelectSource,
}) {
  const handles = new Map();
  const automatic = await CheckMenuItem.new({
    text: "Automatic",
    checked: safeAudioDeviceId === "default",
    action: () => onSelectSource("default"),
  });
  handles.set("default", automatic);
  /** @type {Array<CheckMenuItem | PredefinedMenuItem | MenuItem>} */
  const items = [automatic];
  for (const [header, sources] of [
    ["Output", audioOutputs],
    ["Input", audioInputs],
    ["Applications", captureApplications],
  ]) {
    if (!sources.length) continue;
    items.push(await PredefinedMenuItem.new({ item: "Separator" }));
    items.push(await MenuItem.new({ text: header, enabled: false }));
    for (const source of sources) {
      const isApplication = header === "Applications";
      const item = await CheckMenuItem.new({
        text: isApplication ? source.label : menuDeviceText(source.label),
        checked: safeAudioDeviceId === source.id,
        action: () => onSelectSource(source.id),
      });
      handles.set(source.id, item);
      items.push(item);
    }
  }
  return { items, handles };
}

async function syncSourceMenu(controls, inputs) {
  if (!controls) return;
  await Promise.all([
    controls.submenu.setText(`Source: ${sourceLabelFor(inputs)}`),
    controls.submenu.setEnabled(!inputs.sourceBusy),
    ...[...controls.items].map(([id, item]) => item.setChecked(id === inputs.safeAudioDeviceId)),
  ]);
}

function sameTrayInstances(current, next) {
  return (
    current.length === next.length &&
    current.every((instance, index) => {
      const candidate = next[index];
      return (
        instance.instanceId === candidate?.instanceId &&
        instance.displayName === candidate.displayName &&
        instance.captureStatus === candidate.captureStatus &&
        instance.visible === candidate.visible &&
        JSON.stringify(instance.trayState) === JSON.stringify(candidate.trayState)
      );
    })
  );
}

function presetLabelFor({ presetList, presetActiveId, presetDirty }) {
  const active = presetList.find((p) => p.id === presetActiveId);
  if (!active) return "None";
  return presetDirty ? `${active.name} (modified)` : active.name;
}

async function buildPresetItems({
  presetList,
  presetActiveId,
  presetDirty,
  presetsBlocked,
  onApplyPreset,
}) {
  if (!presetList.length) {
    return [await MenuItem.new({ text: "No presets", enabled: false })];
  }
  const items = [];
  for (const p of presetList) {
    const active = p.id === presetActiveId;
    items.push(
      await CheckMenuItem.new({
        text: active && presetDirty ? `${p.name} (modified)` : p.name,
        checked: active,
        // Applying a preset replaces the scene, so it is refused while a draft-style editor is
        // open. The tray has nowhere to show a caption, so the submenu title carries the reason.
        enabled: !presetsBlocked,
        action: () => onApplyPreset(p.id),
      })
    );
  }
  return items;
}

// Every workbench uses this same group, whether flat or nested.
async function buildWorkbenchItems(cfg) {
  const sourceItems = await buildSourceItems(cfg);
  const sourceSubmenu = await Submenu.new({
    text: `Source: ${sourceLabelFor(cfg)}`,
    enabled: !cfg.sourceBusy,
    items: sourceItems.items,
  });
  return {
    items: [
      await MenuItem.new({
        text: cfg.windowVisible ? "Hide" : "Show",
        enabled: !cfg.updateBusy,
        action: cfg.onToggleWindow,
      }),
      await MenuItem.new({ text: cfg.running ? "Stop" : "Start", action: cfg.onToggleCapture }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      sourceSubmenu,
      await Submenu.new({
        text: cfg.presetsBlocked ? "Preset: Editing…" : `Preset: ${presetLabelFor(cfg)}`,
        enabled: !cfg.updateBusy,
        items: await buildPresetItems(cfg),
      }),
      await MenuItem.new({
        text: "Settings…",
        enabled: !cfg.updateBusy,
        action: cfg.onOpenSettings,
      }),
    ],
    sourceControls: { submenu: sourceSubmenu, items: sourceItems.handles },
  };
}

function peerInputs(instance, cfg) {
  return {
    audioOutputs: [],
    audioInputs: [],
    captureApplications: [],
    safeAudioDeviceId: "default",
    defaultOutputLabel: "",
    sourceBusy: true,
    presetList: [],
    presetActiveId: null,
    presetDirty: false,
    presetsBlocked: true,
    ...instance.trayState,
    updateBusy: cfg.updateBusy || instance.trayState?.updateBusy === true,
    windowVisible: instance.visible,
    running: instance.captureStatus === "running",
  };
}

async function syncWorkbenchSources(controls, cfg) {
  for (const entry of controls ?? []) {
    const instance = cfg.instances.find((item) => item.instanceId === entry.instanceId);
    const inputs = entry.local ? cfg : instance ? peerInputs(instance, cfg) : null;
    if (!inputs) continue;
    if (entry.parent && instance) await entry.parent.setText(instance.displayName);
    await syncSourceMenu(entry.controls, inputs);
  }
}

// Source selection and Source-derived workbench names are updated in place. Replacing a native
// menu in response to its source action can disconnect the next action on Windows.
function instanceStructureKey(instances) {
  return JSON.stringify(
    instances.map(({ instanceId, captureStatus, visible, trayState }) => ({
      instanceId,
      captureStatus,
      visible,
      ...trayState,
      safeAudioDeviceId: undefined,
      defaultOutputLabel: undefined,
      sourceBusy: undefined,
    }))
  );
}

async function buildMenu(cfg) {
  const items = [];
  const sourceControls = [];
  const ownerId = window.__PLVS_INITIAL_STATE__?.instanceId;
  const multi = cfg.instances.length > 1;
  if (multi) {
    const workbenches = [];
    for (const instance of cfg.instances) {
      const local = instance.instanceId === ownerId;
      const inputs = local ? cfg : peerInputs(instance, cfg);
      const group = await buildWorkbenchItems({
        ...inputs,
        onToggleWindow: local
          ? cfg.onToggleWindow
          : () => cfg.onInstanceAction(instance, instance.visible ? "hide" : "show"),
        onToggleCapture: () => cfg.onToggleInstance(instance),
        onSelectSource: local
          ? cfg.onSelectSource
          : (id) => cfg.onInstanceAction(instance, "selectSource", id),
        onApplyPreset: local
          ? cfg.onApplyPreset
          : (id) => cfg.onInstanceAction(instance, "applyPreset", id),
        onOpenSettings: local
          ? cfg.onOpenSettings
          : () => cfg.onInstanceAction(instance, "settings"),
      });
      const parent = await Submenu.new({
        text: instance.displayName,
        items: [
          ...group.items,
          await PredefinedMenuItem.new({ item: "Separator" }),
          await MenuItem.new({
            text: "Quit Workbench",
            enabled: !cfg.updateBusy,
            action: () => cfg.onQuitInstance(instance),
          }),
        ],
      });
      workbenches.push(parent);
      sourceControls.push({
        instanceId: instance.instanceId,
        local,
        parent,
        controls: group.sourceControls,
      });
    }
    items.push(await Submenu.new({ text: "Workbenches", items: workbenches }));
  } else {
    const group = await buildWorkbenchItems(cfg);
    items.push(...group.items);
    sourceControls.push({ local: true, controls: group.sourceControls });
  }
  items.push(await PredefinedMenuItem.new({ item: "Separator" }));
  if (cfg.updateMenu) {
    items.push(
      await MenuItem.new({
        text: cfg.updateMenu.text,
        enabled: !cfg.updateBusy && cfg.updateMenu.enabled,
        action: cfg.onOpenUpdate,
      })
    );
    items.push(await PredefinedMenuItem.new({ item: "Separator" }));
  }
  items.push(
    await MenuItem.new({
      text: multi ? "Quit PLVS" : "Quit",
      enabled: !cfg.updateBusy,
      action: multi ? cfg.onQuitAll : cfg.onQuit,
    })
  );
  return { menu: await Menu.new({ items }), sourceControls };
}

/**
 * @param {{
 *   running: boolean,
 *   windowVisible?: boolean,
 *   onStartClick: (...args: any[]) => any,
 *   onToggleWindow: (...args: any[]) => any,
 *   onQuit: (...args: any[]) => any,
 *   colorScheme: string,
 *   updateBusy?: boolean,
 *   onOpenSettings?: (...args: any[]) => any,
 *   updateMenu?: { text: string, enabled: boolean, action: (...args: any[]) => any } | null,
 *   audioOutputs?: any[],
 *   audioInputs?: any[],
 *   captureApplications?: any[],
 *   safeAudioDeviceId?: string,
 *   defaultOutputLabel?: string,
 *   sourceBusy?: boolean,
 *   onSelectSource?: (...args: any[]) => any,
 *   presets?: import("./usePresets.js").PresetsMenu,
 * }} options
 */
export function useTray({
  running,
  windowVisible = true,
  onStartClick,
  onToggleWindow,
  onQuit,
  colorScheme,
  updateBusy = false,
  onOpenSettings = () => {},
  updateMenu = null,
  audioOutputs = [],
  audioInputs = [],
  captureApplications = [],
  safeAudioDeviceId = "default",
  defaultOutputLabel = "",
  sourceBusy = false,
  onSelectSource = () => {},
  presets = { list: [], activeId: null, dirty: false, blocked: false, apply: () => {} },
}) {
  const isMac = isMacOS();
  const isCoordinator = useCoordinatorRole();
  // On Windows the icon sits on the taskbar, whose mode is independent of the PLVS theme. The
  // PLVS theme remains the fallback until the taskbar mode is known and on other platforms.
  const taskbarColorScheme = useTaskbarColorScheme(isCoordinator && !isMac);
  const iconScheme = taskbarColorScheme ?? colorScheme;
  const iconSchemeRef = useRef(iconScheme);
  useLayoutEffect(() => {
    iconSchemeRef.current = iconScheme;
  }, [iconScheme]);
  const trayRef = useRef(null);
  const sourceControlsRef = useRef(null);
  const sourceSyncQueueRef = useRef(Promise.resolve());
  const [instances, setInstances] = useState([]);
  const refreshInstancesRef = useRef(() => {});
  const inventoryGenerationRef = useRef(0);
  // Quit is acknowledged just before the peer process exits. Ignore its trailing heartbeat until
  // the registry observes the exit; if the process fails to exit, make it available again.
  const departingInstancesRef = useRef(new Map());

  const onStartClickRef = useRef(onStartClick);
  const onToggleWindowRef = useRef(onToggleWindow);
  const onQuitRef = useRef(onQuit);
  const onSelectSourceRef = useRef(onSelectSource);
  const onApplyPresetRef = useRef(presets.apply);
  const updateBusyRef = useRef(updateBusy);
  const navigationRef = useRef({ onOpenSettings, updateMenu });
  useLayoutEffect(() => {
    updateBusyRef.current = updateBusy;
    navigationRef.current = { onOpenSettings, updateMenu };
  }, [updateBusy, onOpenSettings, updateMenu]);
  const stableOpenSettings = useCallback(() => {
    if (updateBusyRef.current) return;
    void Promise.resolve(navigationRef.current.onOpenSettings()).catch((error) =>
      console.warn("Unable to open Settings from Tray", error)
    );
  }, []);
  const stableOpenUpdate = useCallback(() => {
    const entry = navigationRef.current.updateMenu;
    if (updateBusyRef.current || !entry?.enabled) return;
    void Promise.resolve(entry.action()).catch((error) =>
      console.warn("Unable to open updates from Tray", error)
    );
  }, []);
  useEffect(() => {
    onStartClickRef.current = onStartClick;
  }, [onStartClick]);
  useEffect(() => {
    onToggleWindowRef.current = onToggleWindow;
  }, [onToggleWindow]);
  useEffect(() => {
    onQuitRef.current = onQuit;
  }, [onQuit]);
  useEffect(() => {
    onSelectSourceRef.current = onSelectSource;
  }, [onSelectSource]);
  useEffect(() => {
    onApplyPresetRef.current = presets.apply;
  }, [presets.apply]);

  // Stable callbacks that always call the latest ref.
  const stableToggleCapture = useCallback(() => onStartClickRef.current(), []);
  const stableToggleWindow = useCallback(() => {
    if (!updateBusyRef.current) onToggleWindowRef.current();
  }, []);
  const stableQuit = useCallback(() => {
    if (!updateBusyRef.current) onQuitRef.current();
  }, []);
  const stableSelectSource = useCallback((id) => onSelectSourceRef.current(id), []);
  const stableApplyPreset = useCallback((id) => {
    if (updateBusyRef.current) return;
    // The items are disabled while the guard is up, but the menu is rebuilt asynchronously and a
    // click can land against the previous one. The controller refuses it either way; the tray has
    // no surface to report that on, so the rejection is dropped here rather than left unhandled.
    const result = onApplyPresetRef.current(id);
    if (result && typeof result.catch === "function") result.catch(() => {});
  }, []);
  const queueSourceSync = useCallback((controls, inputs) => {
    const sync = sourceSyncQueueRef.current
      .catch(() => {})
      .then(() => syncWorkbenchSources(controls, inputs));
    sourceSyncQueueRef.current = sync;
    return sync;
  }, []);
  const stableToggleInstance = useCallback(
    (instance) => {
      const action = instance.captureStatus === "running" ? "stop" : "start";
      invoke("runtime_route_instance_transport", { instanceId: instance.instanceId, action })
        .then((routedToPeer) => {
          if (!routedToPeer) stableToggleCapture();
        })
        .catch((error) => console.warn("Unable to control PLVS workbench from Tray", error));
    },
    [stableToggleCapture]
  );
  const stableInstanceAction = useCallback((instance, action, payload = null) => {
    if (updateBusyRef.current) return;
    void issueInstanceCommand(instance.instanceId, action, payload).catch((error) => {
      console.warn("Unable to control PLVS workbench from Tray", error);
      void issueInstanceCommand(instance.instanceId, "show").catch(() => {});
    });
  }, []);
  const stableQuitInstance = useCallback(
    (instance) => {
      if (updateBusyRef.current) return;
      if (instance.instanceId === window.__PLVS_INITIAL_STATE__?.instanceId) {
        stableQuit();
        return;
      }
      void issueInstanceCommand(instance.instanceId, "quitInstance")
        .then(() => {
          // Invalidate inventory reads started before the successful quit acknowledgement.
          inventoryGenerationRef.current += 1;
          departingInstancesRef.current.set(instance.instanceId, Date.now() + 10_000);
          setInstances((current) =>
            current.filter((item) => item.instanceId !== instance.instanceId)
          );
        })
        .catch((error) => console.warn("Unable to quit PLVS workbench from Tray", error));
    },
    [stableQuit]
  );
  const stableQuitAll = useCallback(() => {
    if (updateBusyRef.current) return;
    void quitAllInstances().catch((error) =>
      console.warn("Unable to quit every PLVS workbench", error)
    );
  }, []);

  useEffect(() => {
    if (!isTauri() || !isCoordinator) {
      return undefined;
    }
    let cancelled = false;
    const refresh = () => {
      const generation = ++inventoryGenerationRef.current;
      invoke("runtime_list_instances")
        .then((next) => {
          if (cancelled || generation !== inventoryGenerationRef.current) return;
          const inventory = Array.isArray(next) ? next : [];
          for (const [instanceId, deadline] of departingInstancesRef.current) {
            if (
              !inventory.some((item) => item.instanceId === instanceId) ||
              Date.now() >= deadline
            ) {
              departingInstancesRef.current.delete(instanceId);
            }
          }
          const normalized = inventory.filter(
            (item) => !departingInstancesRef.current.has(item.instanceId)
          );
          setInstances((current) =>
            sameTrayInstances(current, normalized) ? current : normalized
          );
        })
        .catch(() => {});
    };
    refreshInstancesRef.current = refresh;
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => {
      cancelled = true;
      refreshInstancesRef.current = () => {};
      clearInterval(timer);
    };
  }, [isCoordinator]);

  // Everything buildMenu reads that can change after creation. The ref keeps the
  // creation effect current if state changes while TrayIcon.new is still pending.
  const menuInputs = {
    windowVisible,
    running,
    updateBusy,
    audioOutputs,
    audioInputs,
    captureApplications,
    safeAudioDeviceId,
    defaultOutputLabel,
    sourceBusy,
    presetList: presets.list,
    presetActiveId: presets.activeId,
    presetDirty: presets.dirty,
    presetsBlocked: presets.blocked === true,
    instances,
    updateMenu,
  };
  const menuInputsRef = useRef(menuInputs);
  useEffect(() => {
    menuInputsRef.current = menuInputs;
  });
  const peerStructureKey = instanceStructureKey(instances);
  const sourceStructureKey = JSON.stringify({
    outputs: audioOutputs.map(({ id, label }) => [id, label]),
    inputs: audioInputs.map(({ id, label }) => [id, label]),
    applications: captureApplications.map(({ id, label }) => [id, label]),
  });

  const menuConfig = useCallback(
    (inputs) => ({
      ...inputs,
      onToggleCapture: stableToggleCapture,
      onToggleWindow: stableToggleWindow,
      onQuit: stableQuit,
      onSelectSource: stableSelectSource,
      onApplyPreset: stableApplyPreset,
      onToggleInstance: stableToggleInstance,
      onInstanceAction: stableInstanceAction,
      onQuitInstance: stableQuitInstance,
      onQuitAll: stableQuitAll,
      onOpenSettings: stableOpenSettings,
      onOpenUpdate: stableOpenUpdate,
    }),
    [
      stableToggleCapture,
      stableToggleWindow,
      stableQuit,
      stableSelectSource,
      stableApplyPreset,
      stableToggleInstance,
      stableInstanceAction,
      stableQuitInstance,
      stableQuitAll,
      stableOpenSettings,
      stableOpenUpdate,
    ]
  );

  // Create tray once on mount.
  useEffect(() => {
    if (!isTauri() || !isCoordinator) return;
    let cancelled = false;

    (async () => {
      const snapshot = menuInputsRef.current;
      const built = await buildMenu(menuConfig(snapshot));

      const createdScheme = iconSchemeRef.current;
      const icon = await loadTrayIcon(createdScheme);

      await closeTrayIcon();
      if (cancelled) return;
      const tray = await TrayIcon.new({
        id: PLVS_TRAY_ID,
        icon,
        iconAsTemplate: true,
        tooltip: "PLVS",
        menu: built.menu,
        showMenuOnLeftClick: false,
        action: (event) => {
          if (event.type === "Enter" || (event.type === "Click" && event.buttonState === "Down")) {
            refreshInstancesRef.current();
          }
          if (event.type === "Click" && event.button === "Left" && event.buttonState === "Up") {
            stableToggleWindow();
          }
        },
      });

      if (cancelled) {
        tray.close();
      } else {
        setCurrentTrayIcon(tray);
        trayRef.current = tray;
        sourceControlsRef.current = built.sourceControls;
        // The icon effect skipped any scheme change made before trayRef was set.
        if (iconSchemeRef.current !== createdScheme) {
          await tray.setIcon(await loadTrayIcon(iconSchemeRef.current));
        }
        // State may have changed while the tray was being created; rebuild once
        // with whatever is current so no stale value shows.
        if (menuInputsRef.current !== snapshot) {
          const updated = await buildMenu(menuConfig(menuInputsRef.current));
          await tray.setMenu(updated.menu);
          sourceControlsRef.current = updated.sourceControls;
          await queueSourceSync(updated.sourceControls, menuInputsRef.current);
        }
      }
    })();

    return () => {
      cancelled = true;
      trayRef.current?.close();
      clearCurrentTrayIcon(trayRef.current);
      trayRef.current = null;
      sourceControlsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCoordinator]);

  // Rebuild only when menu structure or non-source state changes. Replacing a Windows tray menu
  // from the selection event that belongs to the old menu can leave the replacement visible but
  // disconnected from its action channels. Source selection is therefore synchronized in place.
  useEffect(() => {
    if (!isTauri() || !trayRef.current) return;
    let cancelled = false;
    (async () => {
      const built = await buildMenu(menuConfig(menuInputsRef.current));
      if (cancelled || !trayRef.current) return;
      // trayRef may have been cleared by unmount cleanup during the await above.
      await trayRef.current?.setMenu(built.menu);
      if (cancelled || !trayRef.current) return;
      sourceControlsRef.current = built.sourceControls;
      await queueSourceSync(built.sourceControls, menuInputsRef.current);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    menuConfig,
    windowVisible,
    running,
    updateBusy,
    updateMenu?.text,
    updateMenu?.enabled,
    sourceStructureKey,
    queueSourceSync,
    presets.list,
    presets.activeId,
    presets.dirty,
    presets.blocked,
    peerStructureKey,
  ]);

  useEffect(() => {
    if (!isTauri()) return;
    void queueSourceSync(sourceControlsRef.current, menuInputsRef.current);
  }, [safeAudioDeviceId, defaultOutputLabel, sourceBusy, instances, queueSourceSync]);

  // Update tray icon when the scheme it sits on changes.
  useEffect(() => {
    if (!isTauri() || !trayRef.current) return;
    (async () => {
      const icon = await loadTrayIcon(iconScheme);
      await trayRef.current?.setIcon(icon);
    })();
  }, [iconScheme]);
}
