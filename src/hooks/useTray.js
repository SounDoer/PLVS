import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { TrayIcon } from "@tauri-apps/api/tray";
import { Menu, Submenu, MenuItem, CheckMenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
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

// formatAudioDeviceLabel returns { primary, secondary, full }; a menu item's
// text must be a single string. Reconstruct the picker's compact form.
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
    text: "Automatic (default system output)",
    checked: safeAudioDeviceId === "default",
    action: () => onSelectSource("default"),
  });
  handles.set("default", automatic);
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

async function buildMenu(cfg) {
  const {
    isMac,
    running,
    updateBusy,
    onToggleCapture,
    onToggleWindow,
    onQuit,
    audioOutputs,
    audioInputs,
    captureApplications,
    safeAudioDeviceId,
    defaultOutputLabel,
    sourceBusy,
    onSelectSource,
    presetList,
    presetActiveId,
    presetDirty,
    presetsBlocked,
    onApplyPreset,
  } = cfg;

  const items = [];

  if (isMac) {
    const isVisible = await getCurrentWindow().isVisible();
    items.push(
      await MenuItem.new({
        text: isVisible ? "Hide Window" : "Show Window",
        enabled: !updateBusy,
        action: onToggleWindow,
      }),
      await PredefinedMenuItem.new({ item: "Separator" })
    );
  }

  const sourceItems = await buildSourceItems({
    audioOutputs,
    audioInputs,
    captureApplications,
    safeAudioDeviceId,
    onSelectSource,
  });
  const sourceSubmenu = await Submenu.new({
    text: `Source: ${sourceLabelFor({
      safeAudioDeviceId,
      audioOutputs,
      audioInputs,
      captureApplications,
      defaultOutputLabel,
    })}`,
    enabled: !sourceBusy,
    items: sourceItems.items,
  });

  items.push(
    await MenuItem.new({
      text: running ? "Stop" : "Start",
      action: onToggleCapture,
    }),
    await PredefinedMenuItem.new({ item: "Separator" }),
    sourceSubmenu,
    await Submenu.new({
      text: presetsBlocked
        ? "Preset: Editing…"
        : `Preset: ${presetLabelFor({ presetList, presetActiveId, presetDirty })}`,
      enabled: !updateBusy,
      items: await buildPresetItems({
        presetList,
        presetActiveId,
        presetDirty,
        presetsBlocked,
        onApplyPreset,
      }),
    }),
    await PredefinedMenuItem.new({ item: "Separator" }),
    await MenuItem.new({
      text: "Quit",
      enabled: !updateBusy,
      action: onQuit,
    })
  );

  return {
    menu: await Menu.new({ items }),
    sourceControls: { submenu: sourceSubmenu, items: sourceItems.handles },
  };
}

export function useTray({
  running,
  onStartClick,
  onToggleWindow,
  onQuit,
  colorScheme,
  updateBusy = false,
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
  const trayRef = useRef(null);
  const sourceControlsRef = useRef(null);
  const sourceSyncQueueRef = useRef(Promise.resolve());

  const onStartClickRef = useRef(onStartClick);
  const onToggleWindowRef = useRef(onToggleWindow);
  const onQuitRef = useRef(onQuit);
  const onSelectSourceRef = useRef(onSelectSource);
  const onApplyPresetRef = useRef(presets.apply);
  const updateBusyRef = useRef(updateBusy);
  useLayoutEffect(() => {
    updateBusyRef.current = updateBusy;
  }, [updateBusy]);
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
      .then(() => syncSourceMenu(controls, inputs));
    sourceSyncQueueRef.current = sync;
    return sync;
  }, []);

  // Everything buildMenu reads that can change after creation. The ref keeps the
  // creation effect current if state changes while TrayIcon.new is still pending.
  const menuInputs = {
    isMac,
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
  };
  const menuInputsRef = useRef(menuInputs);
  useEffect(() => {
    menuInputsRef.current = menuInputs;
  });
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
    }),
    [stableToggleCapture, stableToggleWindow, stableQuit, stableSelectSource, stableApplyPreset]
  );

  // Create tray once on mount.
  useEffect(() => {
    if (!isTauri() || !isCoordinator) return;
    let cancelled = false;

    (async () => {
      const snapshot = menuInputsRef.current;
      const built = await buildMenu(menuConfig(snapshot));

      const iconName = colorScheme === "light" ? "icons/tray-light.png" : "icons/tray-dark.png";
      const iconPath = await resolveResource(iconName);
      const icon = await Image.fromPath(iconPath);

      await closeTrayIcon();
      if (cancelled) return;
      const tray = await TrayIcon.new({
        id: PLVS_TRAY_ID,
        icon,
        iconAsTemplate: true,
        tooltip: "PLVS",
        menu: built.menu,
        menuOnLeftClick: false,
        action: (e) => {
          if (e.type === "Click" && e.button === "Left") {
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
    (async () => {
      const built = await buildMenu(menuConfig(menuInputsRef.current));
      // trayRef may have been cleared by unmount cleanup during the await above.
      await trayRef.current?.setMenu(built.menu);
      if (!trayRef.current) return;
      sourceControlsRef.current = built.sourceControls;
      await queueSourceSync(built.sourceControls, menuInputsRef.current);
    })();
  }, [
    menuConfig,
    running,
    updateBusy,
    sourceStructureKey,
    queueSourceSync,
    presets.list,
    presets.activeId,
    presets.dirty,
    presets.blocked,
  ]);

  useEffect(() => {
    if (!isTauri()) return;
    void queueSourceSync(sourceControlsRef.current, menuInputsRef.current);
  }, [safeAudioDeviceId, defaultOutputLabel, sourceBusy, queueSourceSync]);

  // Update tray icon when color scheme changes.
  useEffect(() => {
    if (!isTauri() || !trayRef.current) return;
    (async () => {
      const iconName = colorScheme === "light" ? "icons/tray-light.png" : "icons/tray-dark.png";
      const iconPath = await resolveResource(iconName);
      const icon = await Image.fromPath(iconPath);
      await trayRef.current?.setIcon(icon);
    })();
  }, [colorScheme]);
}
