export const TRAY_WORKBENCH_LABEL = "tray-workbench";
export const TRAY_WORKBENCH_STATE = "tray-workbench://state";
export const TRAY_WORKBENCH_ACTION = "tray-workbench://action";
export const TRAY_WORKBENCH_NOTICE = "tray-workbench://notice";
export const TRAY_WORKBENCH_PROBE = "tray-workbench://probe";

/**
 * @typedef {{ key: string, kind?: string, text?: string, enabled?: boolean,
 * checked?: boolean, dismiss: boolean, pageTitle?: "Source" | "Loudness Profile" | "Preset" | undefined,
 * display?: import("../lib/nativeTrayMenu.js").TrayChoiceDisplay,
 * items?: TrayPanelItem[] }} TrayPanelItem
 */

/** @param {string} key */
export function trayPageTitle(key) {
  if (/^workbench:[^:]+:source$/.test(key)) return "Source";
  if (/^workbench:[^:]+:loudness-profile$/.test(key)) return "Loudness Profile";
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

/** @typedef {{ branchKey?: string, pickerKey?: string, groupKeys?: string[] }} TrayNavigation */

/** @param {TrayPanelItem[]} items @param {string} key @returns {TrayNavigation | null} */
export function trayNavigationFor(items, key) {
  /** @param {TrayPanelItem[]} rows @param {string} [branchKey] */
  function findPicker(rows, branchKey) {
    for (const picker of rows) {
      if (!picker.pageTitle || picker.enabled === false) continue;
      if (picker.key === key) return { branchKey, pickerKey: key };
      if (picker.items?.some((item) => item.key === key && item.kind === "group")) {
        return { branchKey, pickerKey: picker.key, groupKeys: [key] };
      }
    }
    return null;
  }
  for (const branch of items) {
    if (branch.kind !== "submenu" || branch.pageTitle || branch.enabled === false) continue;
    if (branch.key === key) return { branchKey: key };
    const navigation = findPicker(branch.items ?? [], branch.key);
    if (navigation) return navigation;
  }
  return findPicker(items);
}

/** @param {TrayPanelItem[]} items @param {TrayNavigation} navigation @param {string} key */
export function findPresentedTrayChoice(items, navigation, key) {
  const branch = items.find((item) => item.key === navigation.branchKey && item.enabled !== false);
  const rows = [...items, ...(branch?.items ?? [])];
  const picker = rows.find(
    (item) => item.key === navigation.pickerKey && item.pageTitle && item.enabled !== false
  );
  const choices = rows.concat(
    picker?.items?.flatMap((item) =>
      item.kind !== "group"
        ? [item]
        : navigation.groupKeys?.includes(item.key)
          ? (item.items ?? [])
          : []
    ) ?? []
  );
  return choices.find(
    (item) =>
      item.key === key && item.enabled !== false && [undefined, "item", "check"].includes(item.kind)
  );
}
