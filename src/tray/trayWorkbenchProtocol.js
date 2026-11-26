export const TRAY_WORKBENCH_LABEL = "tray-workbench";
export const TRAY_WORKBENCH_STATE = "tray-workbench://state";
export const TRAY_WORKBENCH_ACTION = "tray-workbench://action";
export const TRAY_WORKBENCH_NOTICE = "tray-workbench://notice";
export const TRAY_WORKBENCH_PROBE = "tray-workbench://probe";

/**
 * @typedef {{ key: string, kind?: string, text?: string, enabled?: boolean,
 * checked?: boolean, dismiss: boolean, pageTitle?: "Source" | "Preset" | undefined,
 * items?: TrayPanelItem[] }} TrayPanelItem
 */

/** @param {string} key */
export function trayPageTitle(key) {
  if (/^workbench:[^:]+:source$/.test(key)) return "Source";
  if (/^workbench:[^:]+:preset$/.test(key)) return "Preset";
}

/** @param {string} key */
export function isTrayLocateAction(key) {
  return /^workbench:[^:]+:locate$/.test(key);
}

/** @param {string} key @param {string} [ownerId] */
export function trayActionDismisses(key, ownerId) {
  return (
    ["app:new-workbench", "app:update", "app:quit"].includes(key) ||
    /^workbench:[^:]+:settings$/.test(key) ||
    key === `workbench:${ownerId}:quit`
  );
}
