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

function deviceLabelFor({ safeAudioDeviceId, audioOutputs, audioInputs, defaultOutputLabel }) {
  if (safeAudioDeviceId === "default") {
    return defaultOutputLabel ? formatAudioDeviceLabel(defaultOutputLabel) : "Automatic";
  }
  const match = [...audioOutputs, ...audioInputs].find((d) => d.id === safeAudioDeviceId);
  return match ? formatAudioDeviceLabel(match.label) : "Automatic";
}

async function buildDeviceItems({ audioOutputs, audioInputs, safeAudioDeviceId, onSelectDevice }) {
  const items = [
    await CheckMenuItem.new({
      text: "Automatic (default system output)",
      checked: safeAudioDeviceId === "default",
      action: () => onSelectDevice("default"),
    }),
  ];
  for (const [header, devices] of [
    ["Output", audioOutputs],
    ["Input", audioInputs],
  ]) {
    if (!devices.length) continue;
    items.push(await PredefinedMenuItem.new({ item: "Separator" }));
    items.push(await MenuItem.new({ text: header, enabled: false }));
    for (const d of devices) {
      items.push(
        await CheckMenuItem.new({
          text: formatAudioDeviceLabel(d.label),
          checked: safeAudioDeviceId === d.id,
          action: () => onSelectDevice(d.id),
        })
      );
    }
  }
  return items;
}

async function buildPresetItems({ presetList, presetActiveId, presetDirty, onApplyPreset }) {
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
    safeAudioDeviceId,
    defaultOutputLabel,
    onSelectDevice,
    presetList,
    presetActiveId,
    presetDirty,
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
      text: `Device: ${deviceLabelFor({
        safeAudioDeviceId,
        audioOutputs,
        audioInputs,
        defaultOutputLabel,
      })}`,
      items: await buildDeviceItems({
        audioOutputs,
        audioInputs,
        safeAudioDeviceId,
        onSelectDevice,
      }),
    }),
    await Submenu.new({
      text: "Presets",
      enabled: !updateBusy,
      items: await buildPresetItems({ presetList, presetActiveId, presetDirty, onApplyPreset }),
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
  safeAudioDeviceId = "default",
  defaultOutputLabel = "",
  onSelectDevice = () => {},
  presets = { list: [], activeId: null, dirty: false, apply: () => {} },
}) {
  const isMac = isMacOS();
  const trayRef = useRef(null);

  const onStartClickRef = useRef(onStartClick);
  const onToggleWindowRef = useRef(onToggleWindow);
  const onSelectDeviceRef = useRef(onSelectDevice);
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
    onSelectDeviceRef.current = onSelectDevice;
  }, [onSelectDevice]);
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
  const stableSelectDevice = useCallback((id) => onSelectDeviceRef.current(id), []);
  const stableApplyPreset = useCallback((id) => {
    if (!updateBusyRef.current) onApplyPresetRef.current(id);
  }, []);

  // Everything buildMenu reads that can change after creation. The ref keeps the
  // creation effect current if state changes while TrayIcon.new is still pending.
  const menuInputs = {
    isMac,
    running,
    updateBusy,
    audioOutputs,
    audioInputs,
    safeAudioDeviceId,
    defaultOutputLabel,
    presetList: presets.list,
    presetActiveId: presets.activeId,
    presetDirty: presets.dirty,
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
      onSelectDevice: stableSelectDevice,
      onApplyPreset: stableApplyPreset,
    }),
    [stableToggleCapture, stableToggleWindow, stableQuit, stableSelectDevice, stableApplyPreset]
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
    presets.list,
    presets.activeId,
    presets.dirty,
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
