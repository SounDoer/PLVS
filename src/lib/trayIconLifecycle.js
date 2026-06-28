import { TrayIcon } from "@tauri-apps/api/tray";
import { isTauri } from "../ipc/env.js";

export const PLVS_TRAY_ID = "plvs-main-tray";

let currentTray = null;

export function setCurrentTrayIcon(tray) {
  currentTray = tray;
}

export function clearCurrentTrayIcon(tray) {
  if (!tray || currentTray === tray) currentTray = null;
}

export async function closeTrayIcon() {
  if (!isTauri()) return;
  try {
    currentTray?.close();
  } catch (_) {}
  currentTray = null;
  try {
    const existing = await TrayIcon.getById(PLVS_TRAY_ID);
    existing?.close();
  } catch (_) {}
  try {
    await TrayIcon.removeById(PLVS_TRAY_ID);
  } catch (_) {}
}
