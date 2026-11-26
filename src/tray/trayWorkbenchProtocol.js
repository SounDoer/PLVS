export const TRAY_WORKBENCH_LABEL = "tray-workbench";
export const TRAY_WORKBENCH_STATE = "tray-workbench://state";
export const TRAY_WORKBENCH_ACTION = "tray-workbench://action";
export const TRAY_WORKBENCH_NOTICE = "tray-workbench://notice";
export const TRAY_WORKBENCH_PROBE = "tray-workbench://probe";

/** @param {string} key */
export function isTrayLocateAction(key) {
  return /^workbench:[^:]+:locate$/.test(key);
}
