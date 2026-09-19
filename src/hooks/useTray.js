import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { TrayIcon } from "@tauri-apps/api/tray";
import { Menu, Submenu, MenuItem, CheckMenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Image } from "@tauri-apps/api/image";
import { resolveResource } from "@tauri-apps/api/path";
import { exit } from "@tauri-apps/plugin-process";
import { isTauri } from "../ipc/env.js";
import { isMacOS } from "../lib/platform.js";
import { formatAudioDeviceLabel } from "../lib/audioDeviceLabels.js";
import {
  clearCurrentTrayIcon,
  closeTrayIcon,
  PLVS_TRAY_ID,
  setCurrentTrayIcon,
} from "../lib/trayIconLifecycle.js";

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
  const items = [
    await CheckMenuItem.new({
      text: "Automatic (default system output)",
      checked: safeAudioDeviceId === "default",
      action: () => onSelectSource("default"),
    }),
  ];
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
      items.push(
        await CheckMenuItem.new({
          text: isApplication ? source.label : menuDeviceText(source.label),
          checked: safeAudioDeviceId === source.id,
          action: () => onSelectSource(source.id),
        })
      );
    }
  }
  return items;
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

  items.push(
    await MenuItem.new({
      text: running ? "Stop" : "Start",
      action: onToggleCapture,
    }),
    await PredefinedMenuItem.new({ item: "Separator" }),
    await Submenu.new({
      text: `Source: ${sourceLabelFor({
        safeAudioDeviceId,
        audioOutputs,
        audioInputs,
        captureApplications,
        defaultOutputLabel,
      })}`,
      items: await buildSourceItems({
        audioOutputs,
        audioInputs,
        captureApplications,
        safeAudioDeviceId,
        onSelectSource,
      }),
    }),
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

  return Menu.new({ items });
}

export function useTray({
  running,
  onStartClick,
  onToggleWindow,
  colorScheme,
  updateBusy = false,
  audioOutputs = [],
  audioInputs = [],
  captureApplications = [],
  safeAudioDeviceId = "default",
  defaultOutputLabel = "",
  onSelectSource = () => {},
  presets = { list: [], activeId: null, dirty: false, blocked: false, apply: () => {} },
}) {
  const isMac = isMacOS();
  const trayRef = useRef(null);

  const onStartClickRef = useRef(onStartClick);
  const onToggleWindowRef = useRef(onToggleWindow);
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
    if (!updateBusyRef.current) exit(0);
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
    presetList: presets.list,
    presetActiveId: presets.activeId,
    presetDirty: presets.dirty,
    presetsBlocked: presets.blocked === true,
  };
  const menuInputsRef = useRef(menuInputs);
  useEffect(() => {
    menuInputsRef.current = menuInputs;
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
    if (!isTauri()) return;
    let cancelled = false;

    (async () => {
      const snapshot = menuInputsRef.current;
      const menu = await buildMenu(menuConfig(snapshot));

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
        menu,
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
        // State may have changed while the tray was being created; rebuild once
        // with whatever is current so no stale value shows.
        if (menuInputsRef.current !== snapshot) {
          const updatedMenu = await buildMenu(menuConfig(menuInputsRef.current));
          await tray.setMenu(updatedMenu);
        }
      }
    })();

    return () => {
      cancelled = true;
      trayRef.current?.close();
      clearCurrentTrayIcon(trayRef.current);
      trayRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild menu when any displayed state changes.
  useEffect(() => {
    if (!isTauri() || !trayRef.current) return;
    (async () => {
      const menu = await buildMenu(menuConfig(menuInputsRef.current));
      // trayRef may have been cleared by unmount cleanup during the await above.
      await trayRef.current?.setMenu(menu);
    })();
  }, [
    menuConfig,
    running,
    updateBusy,
    safeAudioDeviceId,
    defaultOutputLabel,
    audioOutputs,
    audioInputs,
    captureApplications,
    presets.list,
    presets.activeId,
    presets.dirty,
    presets.blocked,
  ]);

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
