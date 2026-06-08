import { useEffect, useRef } from "react";
import { TrayIcon } from "@tauri-apps/api/tray";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Image } from "@tauri-apps/api/image";
import { resolveResource } from "@tauri-apps/api/path";
import { exit } from "@tauri-apps/plugin-process";
import { isTauri } from "../ipc/env.js";

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

export function useTray({ running, pinned, togglePin, onStartClick, deviceName, onToggleWindow }) {
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
  const stableTogglePin = useRef(() => togglePinRef.current()).current;
  const stableToggleCapture = useRef(() => onStartClickRef.current()).current;
  const stableToggleWindow = useRef(() => onToggleWindowRef.current()).current;

  // Snapshot of state for the creation effect (refs keep it current after creation)
  const creationStateRef = useRef({ running, pinned, deviceName });
  useEffect(() => {
    creationStateRef.current = { running, pinned, deviceName };
  }, [running, pinned, deviceName]);

  // Create tray once on mount
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;

    (async () => {
      const { running: r, pinned: p, deviceName: d } = creationStateRef.current;
      const menu = await buildMenu({
        running: r,
        pinned: p,
        onToggleCapture: stableToggleCapture,
        onTogglePin: stableTogglePin,
        deviceName: d,
        onToggleWindow: stableToggleWindow,
      });

      const iconPath = await resolveResource("icons/tray.png");
      const icon = await Image.fromPath(iconPath);

      const tray = await TrayIcon.new({
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

      if (!cancelled) trayRef.current = tray;
    })();

    return () => {
      cancelled = true;
      trayRef.current?.close();
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
}
