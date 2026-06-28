import { useCallback, useEffect, useRef } from "react";
import { TrayIcon } from "@tauri-apps/api/tray";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Image } from "@tauri-apps/api/image";
import { resolveResource } from "@tauri-apps/api/path";
import { exit } from "@tauri-apps/plugin-process";
import { isTauri } from "../ipc/env.js";
import {
  clearCurrentTrayIcon,
  closeTrayIcon,
  PLVS_TRAY_ID,
  setCurrentTrayIcon,
} from "../lib/trayIconLifecycle.js";

async function buildMenu({
  running,
  pinned,
  onToggleCapture,
  onTogglePin,
  deviceName,
  onToggleWindow,
}) {
  const win = getCurrentWindow();
  const isVisible = await win.isVisible();

  return Menu.new({
    items: [
      await MenuItem.new({
        text: isVisible ? "Hide Window" : "Show Window",
        action: onToggleWindow,
      }),
      await MenuItem.new({
        text: pinned ? "Unpin Window" : "Pin Window",
        action: onTogglePin,
      }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({
        text: running ? "Stop" : "Start",
        action: onToggleCapture,
      }),
      await MenuItem.new({
        text: deviceName ?? "No device",
        enabled: false,
      }),
      await PredefinedMenuItem.new({ item: "Separator" }),
      await MenuItem.new({
        text: "Quit",
        action: () => exit(0),
      }),
    ],
  });
}

export function useTray({
  running,
  pinned,
  togglePin,
  onStartClick,
  deviceName,
  onToggleWindow,
  colorScheme,
}) {
  const trayRef = useRef(null);
  const togglePinRef = useRef(togglePin);
  const onStartClickRef = useRef(onStartClick);
  const onToggleWindowRef = useRef(onToggleWindow);

  useEffect(() => {
    togglePinRef.current = togglePin;
  }, [togglePin]);
  useEffect(() => {
    onStartClickRef.current = onStartClick;
  }, [onStartClick]);
  useEffect(() => {
    onToggleWindowRef.current = onToggleWindow;
  }, [onToggleWindow]);

  // Stable callbacks that always call the latest ref
  const stableTogglePin = useCallback(() => togglePinRef.current(), []);
  const stableToggleCapture = useCallback(() => onStartClickRef.current(), []);
  const stableToggleWindow = useCallback(() => onToggleWindowRef.current(), []);

  // Snapshot of state for the creation effect (refs keep it current after creation)
  const creationStateRef = useRef({ running, pinned, deviceName, colorScheme });
  useEffect(() => {
    creationStateRef.current = { running, pinned, deviceName, colorScheme };
  }, [running, pinned, deviceName, colorScheme]);

  // Create tray once on mount
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;

    (async () => {
      const { running: r, pinned: p, deviceName: d, colorScheme: cs } = creationStateRef.current;
      const menu = await buildMenu({
        running: r,
        pinned: p,
        onToggleCapture: stableToggleCapture,
        onTogglePin: stableTogglePin,
        deviceName: d,
        onToggleWindow: stableToggleWindow,
      });

      const iconName = cs === "light" ? "icons/tray-light.png" : "icons/tray-dark.png";
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
        // State (e.g. deviceName) may have changed while the tray was being created.
        // Rebuild the menu once with whatever is current to avoid showing stale values.
        const cur = creationStateRef.current;
        if (cur.running !== r || cur.pinned !== p || cur.deviceName !== d) {
          const updatedMenu = await buildMenu({
            running: cur.running,
            pinned: cur.pinned,
            onToggleCapture: stableToggleCapture,
            onTogglePin: stableTogglePin,
            deviceName: cur.deviceName,
            onToggleWindow: stableToggleWindow,
          });
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Rebuild menu when state changes
  useEffect(() => {
    if (!isTauri() || !trayRef.current) return;

    (async () => {
      const menu = await buildMenu({
        running,
        pinned,
        onToggleCapture: stableToggleCapture,
        onTogglePin: stableTogglePin,
        deviceName,
        onToggleWindow: stableToggleWindow,
      });
      await trayRef.current.setMenu(menu);
    })();
  }, [running, pinned, deviceName, stableToggleCapture, stableTogglePin, stableToggleWindow]);

  // Update tray icon when color scheme changes
  useEffect(() => {
    if (!isTauri() || !trayRef.current) return;

    (async () => {
      const iconName = colorScheme === "light" ? "icons/tray-light.png" : "icons/tray-dark.png";
      const iconPath = await resolveResource(iconName);
      const icon = await Image.fromPath(iconPath);
      await trayRef.current.setIcon(icon);
    })();
  }, [colorScheme]);
}
