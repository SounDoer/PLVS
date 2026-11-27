import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { Window } from "@tauri-apps/api/window";
import { TrayIcon } from "@tauri-apps/api/tray";
import { createNativeTrayMenu } from "../lib/nativeTrayMenu.js";
import { Image } from "@tauri-apps/api/image";
import { resolveResource } from "@tauri-apps/api/path";
import { isTauri } from "../ipc/env.js";
import { openAdditionalWorkbench } from "../ipc/commands.js";
import { isMacOS, isWindows } from "../lib/platform.js";
import {
  applicationSourceName,
  formatAudioDeviceLabel,
  isUnavailableApplicationSource,
} from "../lib/audioDeviceLabels.js";
import { isSourceMixId } from "../lib/sourceMixes.js";
import {
  clearCurrentTrayIcon,
  closeTrayIcon,
  PLVS_TRAY_ID,
  setCurrentTrayIcon,
} from "../lib/trayIconLifecycle.js";
import { useCoordinatorRole } from "../lib/runtimeRole.js";
import { useTaskbarColorScheme } from "./useTaskbarColorScheme.js";
import { issueInstanceCommand, quitAllInstances } from "../runtime/coordination.js";
import { createThemePublication } from "../theme/themeRuntime.js";
import {
  isTrayLocateAction,
  trayActionDismisses,
  trayPageTitle,
  TRAY_WORKBENCH_ACTION,
  TRAY_WORKBENCH_LABEL,
  TRAY_WORKBENCH_NOTICE,
  TRAY_WORKBENCH_PROBE,
  TRAY_WORKBENCH_STATE,
} from "../tray/trayWorkbenchProtocol.js";

// The dark icon is a white glyph for a dark surface; the light icon is a black glyph.
/**
 * @param {string} scheme
 */
async function loadTrayIcon(scheme) {
  const iconName = scheme === "light" ? "icons/tray-light.png" : "icons/tray-dark.png";
  return Image.fromPath(await resolveResource(iconName));
}

/**
 * @param {string} label
 */
function deviceMenuLabel(label) {
  const { primary, secondary } = formatAudioDeviceLabel(label);
  return {
    text: secondary ? `${primary} (${secondary})` : primary,
    display: { primary, secondary },
  };
}

function sourceLabelFor({
  safeAudioDeviceId,
  audioOutputs,
  audioInputs,
  captureApplications,
  sourceMixes,
  defaultOutputLabel,
}) {
  if (safeAudioDeviceId === "default") {
    const label = defaultOutputLabel ? deviceMenuLabel(defaultOutputLabel).text : "Automatic";
    return `Output · ${label}`;
  }
  if (isSourceMixId(safeAudioDeviceId)) {
    const mix = sourceMixes.find(({ id }) => id === safeAudioDeviceId);
    return `Mix · ${mix?.label ?? "Unavailable"}`;
  }
  const application = captureApplications.find((candidate) => candidate.id === safeAudioDeviceId);
  if (application) return `Application · ${application.label}`;
  if (isUnavailableApplicationSource(safeAudioDeviceId, captureApplications)) {
    return "Application · Not connected";
  }
  const output = audioOutputs.find((device) => device.id === safeAudioDeviceId);
  if (output) return `Output · ${deviceMenuLabel(output.label).text}`;
  const input = audioInputs.find((device) => device.id === safeAudioDeviceId);
  return input ? `Input · ${deviceMenuLabel(input.label).text}` : "Not connected";
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

const menuItem = (key, text, action, enabled = true) => ({ key, text, action, enabled });
async function reportNativeAction(action) {
  try {
    await action();
  } catch (error) {
    console.warn("Unable to activate Tray item", error);
  }
}

const separator = (key) => ({ key, kind: "separator" });

function sourceDefinitions(cfg, prefix) {
  /** @type {import("../lib/nativeTrayMenu.js").TrayMenuDefinition[]} */
  const items = [
    {
      ...menuItem(`${prefix}:default`, "Automatic", () => cfg.onSelectSource("default")),
      kind: "check",
      checked: cfg.safeAudioDeviceId === "default",
    },
  ];
  if (isUnavailableApplicationSource(cfg.safeAudioDeviceId, cfg.captureApplications)) {
    items.push(
      menuItem(`${prefix}:application-unavailable`, "Selected Application Unavailable", null, false)
    );
  }
  if (
    isSourceMixId(cfg.safeAudioDeviceId) &&
    !cfg.sourceMixes.some(({ id }) => id === cfg.safeAudioDeviceId)
  ) {
    items.push(menuItem(`${prefix}:mix-unavailable`, "Selected Mix Unavailable", null, false));
  }
  for (const [group, sources, labelFor] of [
    ["Output", cfg.audioOutputs, (source) => deviceMenuLabel(source.label)],
    ["Input", cfg.audioInputs, (source) => deviceMenuLabel(source.label)],
    [
      "Applications",
      cfg.captureApplications,
      (source) => ({
        text: source.label,
        display: { primary: source.displayName ?? applicationSourceName(source) },
      }),
    ],
    [
      "Mixes",
      cfg.sourceMixes,
      (source) => ({
        text: source.label,
        display: { primary: source.label, secondary: source.detail },
      }),
    ],
  ]) {
    if (!sources.length) continue;
    items.push({
      key: `${prefix}:${group}:header`,
      kind: "group",
      text: group,
      items: sources.map((source) => {
        const { text, display } = labelFor(source);
        return {
          ...menuItem(`${prefix}:source:${source.id}`, text, () => cfg.onSelectSource(source.id)),
          display,
          kind: "check",
          checked: cfg.safeAudioDeviceId === source.id,
        };
      }),
    });
  }
  return items;
}

function workbenchDefinitions(cfg, prefix) {
  return [
    menuItem(
      `${prefix}:window`,
      cfg.windowVisible ? "Hide" : "Show",
      cfg.onToggleWindow,
      !cfg.updateBusy
    ),
    menuItem(`${prefix}:transport`, cfg.running ? "Stop" : "Start", cfg.onToggleCapture),
    separator(`${prefix}:source-separator`),
    {
      key: `${prefix}:source`,
      kind: "submenu",
      text: `Source: ${sourceLabelFor(cfg)}`,
      enabled: !cfg.sourceBusy,
      items: sourceDefinitions(cfg, `${prefix}:source`),
    },
    {
      key: `${prefix}:preset`,
      kind: "submenu",
      text: cfg.presetsBlocked ? "Preset: Editing…" : `Preset: ${presetLabelFor(cfg)}`,
      enabled: !cfg.updateBusy,
      items: cfg.presetList.length
        ? cfg.presetList.map((preset) => ({
            ...menuItem(
              `${prefix}:preset:${preset.id}`,
              preset.id === cfg.presetActiveId && cfg.presetDirty
                ? `${preset.name} (modified)`
                : preset.name,
              () => cfg.onApplyPreset(preset.id),
              !cfg.presetsBlocked
            ),
            display: {
              primary: preset.name,
              modified: preset.id === cfg.presetActiveId && cfg.presetDirty,
            },
            kind: "check",
            checked: preset.id === cfg.presetActiveId,
          }))
        : [menuItem(`${prefix}:no-presets`, "No presets", null, false)],
    },
    menuItem(`${prefix}:settings`, "Settings…", cfg.onOpenSettings, !cfg.updateBusy),
  ];
}

function peerInputs(instance, cfg) {
  return {
    audioOutputs: [],
    audioInputs: [],
    captureApplications: [],
    sourceMixes: [],
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

function menuDefinitions(cfg) {
  const ownerId = window.__PLVS_INITIAL_STATE__?.instanceId ?? "local";
  const multi = cfg.instances.length > 1;
  const items = multi
    ? cfg.instances.map((instance) => {
        const local = instance.instanceId === ownerId;
        const prefix = `workbench:${instance.instanceId}`;
        const inputs = local ? cfg : peerInputs(instance, cfg);
        return {
          key: prefix,
          kind: "submenu",
          text: instance.displayName,
          items: [
            menuItem(
              `${prefix}:locate`,
              "Locate",
              local ? cfg.onLocateWindow : () => cfg.onInstanceAction(instance, "locate"),
              !inputs.updateBusy
            ),
            ...workbenchDefinitions(
              {
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
              },
              prefix
            ),
            separator(`${prefix}:quit-separator`),
            menuItem(
              `${prefix}:quit`,
              "Quit Workbench",
              () => cfg.onQuitInstance(instance),
              !cfg.updateBusy
            ),
          ],
        };
      })
    : workbenchDefinitions(cfg, `workbench:${ownerId}`);
  items.push(separator("app:separator"));
  items.push(menuItem("app:new-workbench", "New Workbench", cfg.onNewWorkbench, !cfg.updateBusy));
  items.push(separator("app:new-workbench-separator"));
  if (cfg.updateMenu) {
    items.push(
      menuItem(
        "app:update",
        cfg.updateMenu.text,
        cfg.onOpenUpdate,
        !cfg.updateBusy && cfg.updateMenu.enabled
      )
    );
    items.push(separator("app:update-separator"));
  }
  items.push(
    menuItem(
      "app:quit",
      multi ? "Quit PLVS" : "Quit",
      multi ? cfg.onQuitAll : cfg.onQuit,
      !cfg.updateBusy
    )
  );
  return items;
}

/**
 * @param {import("../lib/nativeTrayMenu.js").TrayMenuDefinition[]} items
 * @param {string} [ownerId]
 * @param {boolean} [includeDisplay]
 * @returns {import("../tray/trayWorkbenchProtocol.js").TrayPanelItem[]}
 */
function panelItems(items, ownerId, includeDisplay = false) {
  return items
    .filter(
      ({ key }) =>
        !/^(app:(new-workbench|update)-separator|workbench:[^:]+:(source|quit)-separator)$/.test(
          key
        )
    )
    .map(({ key, kind, text, enabled, checked, display, items: children }) => {
      const pageTitle = trayPageTitle(key);
      const items = children && panelItems(children, ownerId, includeDisplay);
      return {
        key,
        kind,
        text,
        enabled,
        checked,
        ...(includeDisplay && display ? { display } : {}),
        pageTitle,
        dismiss: trayActionDismisses(key, ownerId),
        items,
      };
    });
}

/**
 * @param {import("../lib/nativeTrayMenu.js").TrayMenuDefinition[]} items
 * @param {string} key
 */
function findTrayAction(items, key) {
  for (const item of items) {
    if (item.enabled === false) continue;
    if (item.key === key && item.action) return item;
    if (item.items) {
      const action = findTrayAction(item.items, key);
      if (action) return action;
    }
  }
  return null;
}

/**
 * @param {{
 *   running: boolean,
 *   windowVisible?: boolean,
 *   onStartClick: (...args: any[]) => any,
 *   onToggleWindow: (...args: any[]) => any,
 *   onLocateWindow?: () => Promise<void>,
 *   onQuit: (...args: any[]) => any,
 *   colorScheme: string,
 *   resolvedTheme?: any,
 *   interfaceSize?: string,
 *   updateBusy?: boolean,
 *   onOpenSettings?: (...args: any[]) => any,
 *   updateMenu?: { text: string, enabled: boolean, action: (...args: any[]) => any } | null,
 *   audioOutputs?: any[],
 *   audioInputs?: any[],
 *   captureApplications?: any[],
 *   sourceMixes?: { id: string, label: string, detail?: string }[],
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
  onLocateWindow,
  onQuit,
  colorScheme,
  resolvedTheme = null,
  interfaceSize = "default",
  updateBusy = false,
  onOpenSettings = () => {},
  updateMenu = null,
  audioOutputs = [],
  audioInputs = [],
  captureApplications = [],
  sourceMixes = [],
  safeAudioDeviceId = "default",
  defaultOutputLabel = "",
  sourceBusy = false,
  onSelectSource = () => {},
  presets = { list: [], activeId: null, dirty: false, blocked: false, apply: () => {} },
}) {
  const isMac = isMacOS();
  // Linux AppIndicator hosts own the menu and do not report clicks or the icon bounds.
  const useWorkbenchPanel = isWindows() || isMac;
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
  const nativeMenuRef = useRef(null);
  const [instances, setInstances] = useState([]);
  const instancesRef = useRef(instances);
  const updateInstances = useCallback((next) => {
    if (sameTrayInstances(instancesRef.current, next)) return;
    instancesRef.current = next;
    setInstances(next);
  }, []);
  const refreshInstancesRef = useRef(async () => {});
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
  const navigationRef = useRef({ onLocateWindow, onOpenSettings, updateMenu });
  useLayoutEffect(() => {
    updateBusyRef.current = updateBusy;
    navigationRef.current = { onLocateWindow, onOpenSettings, updateMenu };
  }, [updateBusy, onLocateWindow, onOpenSettings, updateMenu]);
  const stableLocateWindow = useCallback(() => {
    if (updateBusyRef.current) return;
    void navigationRef.current
      .onLocateWindow?.()
      .catch((error) => console.warn("Unable to locate PLVS workbench from Tray", error));
  }, []);
  const stableNewWorkbench = useCallback(() => {
    if (updateBusyRef.current) return false;
    return openAdditionalWorkbench();
  }, []);
  const stableOpenSettings = useCallback(() => {
    if (updateBusyRef.current) return false;
    return navigationRef.current.onOpenSettings();
  }, []);
  const stableOpenUpdate = useCallback(() => {
    const entry = navigationRef.current.updateMenu;
    if (updateBusyRef.current || !entry?.enabled) return false;
    return entry.action();
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
    if (updateBusyRef.current) return false;
    return onToggleWindowRef.current();
  }, []);
  const stableQuit = useCallback(() => {
    if (!updateBusyRef.current) onQuitRef.current();
  }, []);
  const stableSelectSource = useCallback((id) => onSelectSourceRef.current(id), []);
  const stableApplyPreset = useCallback((id) => {
    if (updateBusyRef.current) return false;
    return onApplyPresetRef.current(id);
  }, []);
  const stableToggleInstance = useCallback(
    async (instance) => {
      const action = instance.captureStatus === "running" ? "stop" : "start";
      const routedToPeer = await invoke("runtime_route_instance_transport", {
        instanceId: instance.instanceId,
        action,
      });
      if (!routedToPeer) return stableToggleCapture();
    },
    [stableToggleCapture]
  );
  const stableInstanceAction = useCallback((instance, action, payload = null) => {
    if (updateBusyRef.current) return;
    return issueInstanceCommand(instance.instanceId, action, payload)
      .then(() => refreshInstancesRef.current())
      .catch((error) => {
        console.warn("Unable to control PLVS workbench from Tray", error);
        if (action !== "locate")
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
      return issueInstanceCommand(instance.instanceId, "quitInstance")
        .then(() => {
          // Invalidate inventory reads started before the successful quit acknowledgement.
          inventoryGenerationRef.current += 1;
          departingInstancesRef.current.set(instance.instanceId, Date.now() + 10_000);
          updateInstances(
            instancesRef.current.filter((item) => item.instanceId !== instance.instanceId)
          );
        })
        .catch((error) => console.warn("Unable to quit PLVS workbench from Tray", error));
    },
    [stableQuit, updateInstances]
  );
  const quittingAllRef = useRef(false);
  const stableQuitAll = useCallback(async () => {
    if (updateBusyRef.current || quittingAllRef.current) return;
    quittingAllRef.current = true;
    try {
      await quitAllInstances();
    } catch (error) {
      console.warn("Unable to quit every PLVS workbench", error);
    } finally {
      quittingAllRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!isTauri() || !isMacOS()) return;
    const subscription = listen("app-quit-requested", stableQuitAll).catch((error) => {
      console.warn("Unable to listen for macOS Quit", error);
      return null;
    });
    return () => {
      void subscription.then((stop) => stop?.());
    };
  }, [stableQuitAll]);

  useEffect(() => {
    if (!isTauri() || !isCoordinator) {
      return undefined;
    }
    let cancelled = false;
    let latestRefresh = Promise.resolve();
    const refresh = () => {
      const generation = ++inventoryGenerationRef.current;
      const request = invoke("runtime_list_instances")
        .then((next) => {
          if (cancelled) return;
          if (generation !== inventoryGenerationRef.current) {
            // A queued action needs the new inventory even if a periodic read superseded this one.
            if (latestRefresh !== request) return latestRefresh;
            return;
          }
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
          updateInstances(normalized);
        })
        .catch(() => {});
      latestRefresh = request;
      return request;
    };
    refreshInstancesRef.current = refresh;
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => {
      cancelled = true;
      refreshInstancesRef.current = async () => {};
      clearInterval(timer);
    };
  }, [isCoordinator, updateInstances]);

  // Everything menuDefinitions reads that can change after creation. The ref keeps the
  // creation effect current if state changes while TrayIcon.new is still pending.
  const menuInputs = {
    windowVisible,
    running,
    updateBusy,
    audioOutputs,
    audioInputs,
    captureApplications,
    sourceMixes,
    safeAudioDeviceId,
    defaultOutputLabel,
    sourceBusy,
    presetList: presets.list,
    presetActiveId: presets.activeId,
    presetDirty: presets.dirty,
    presetsBlocked: presets.blocked === true,
    instances,
    updateMenu,
    resolvedTheme,
    interfaceSize,
  };
  const menuInputsRef = useRef(menuInputs);
  useLayoutEffect(() => {
    menuInputsRef.current = menuInputs;
  });

  const panelReady = useRef(false);
  const openingPanel = useRef(false);
  const panelOpenRequested = useRef(
    /** @type {import("../tray/trayWorkbenchProtocol.js").TrayNavigation | null} */ (null)
  );
  const panelDefinitions = useRef(
    /** @type {() => import("../lib/nativeTrayMenu.js").TrayMenuDefinition[]} */ (() => [])
  );
  const panelPresentation = useRef(0);
  const panelActionQueue = useRef(Promise.resolve());
  const renderedPanel = useRef(null);
  const inspectionVersion = useRef({ signature: "", generation: 0 });
  const publishPanel = useCallback(async (navigation = null) => {
    if (!panelReady.current) return;
    if (navigation) panelPresentation.current += 1;
    const { resolvedTheme, interfaceSize } = menuInputsRef.current;
    await emitTo(TRAY_WORKBENCH_LABEL, TRAY_WORKBENCH_STATE, {
      items: panelItems(
        panelDefinitions.current(),
        window.__PLVS_INITIAL_STATE__?.instanceId,
        true
      ),
      theme: createThemePublication(resolvedTheme),
      interfaceSize,
      presentation: panelPresentation.current,
      navigation,
    });
  }, []);

  /**
   * @param {import("@tauri-apps/api/tray").TrayIconEventBase<"Click">["rect"] | undefined} iconBounds
   * @param {import("../tray/trayWorkbenchProtocol.js").TrayNavigation} [navigation]
   */
  const stableOpenWorkbenchPanel = useCallback(
    async (iconBounds, navigation = {}) => {
      if (openingPanel.current) return null;
      openingPanel.current = true;
      try {
        panelOpenRequested.current = navigation;
        const presentation = panelPresentation.current + 1;
        if (isMac && iconBounds) {
          const { position, size } = iconBounds;
          await invoke("open_tray_workbench_panel", {
            clickedIcon: { x: position.x, y: position.y, width: size.width, height: size.height },
          });
        } else {
          await invoke("open_tray_workbench_panel");
        }
        if (!panelReady.current) await emitTo(TRAY_WORKBENCH_LABEL, TRAY_WORKBENCH_PROBE);
        void refreshInstancesRef.current();
        if (panelOpenRequested.current && panelReady.current) {
          const pendingNavigation = panelOpenRequested.current;
          panelOpenRequested.current = null;
          await publishPanel(pendingNavigation);
        }
        return presentation;
      } catch (error) {
        panelOpenRequested.current = null;
        throw error;
      } finally {
        openingPanel.current = false;
      }
    },
    [isMac, publishPanel]
  );

  /** @param {string} key @param {(() => Promise<void>) | undefined} [guard] */
  const activatePanelItem = useCallback((key, guard) => {
    const next = panelActionQueue.current.then(async () => {
      await guard?.();
      const item = findTrayAction(panelDefinitions.current(), key);
      if (!item) throw new Error("This Tray action is no longer available.");
      const holdFocus =
        isTrayLocateAction(key) || (/^workbench:[^:]+:window$/.test(key) && item.text === "Show");
      if (holdFocus) await invoke("set_tray_workbench_focus_hold", { active: true });
      try {
        if (guard && trayActionDismisses(key, window.__PLVS_INITIAL_STATE__?.instanceId)) {
          await (await Window.getByLabel(TRAY_WORKBENCH_LABEL))?.hide();
        }
        if ((await item.action()) === false)
          throw new Error("The Workbench refused this Tray action.");
      } finally {
        if (holdFocus) await invoke("set_tray_workbench_focus_hold", { active: false });
        await refreshInstancesRef.current();
      }
    });
    // The peer mailbox accepts one pending command while the panel stays open.
    panelActionQueue.current = next.catch(() => {});
    return next;
  }, []);

  useEffect(() => {
    if (!useWorkbenchPanel || !isTauri() || !isCoordinator) return;
    async function handleAction({ payload }) {
      const { kind, key } = payload;
      try {
        if (kind === "ready") {
          panelReady.current = true;
          if (!openingPanel.current) {
            const navigation = panelOpenRequested.current;
            panelOpenRequested.current = null;
            await publishPanel(navigation);
          }
          return;
        }
        if (kind === "rendered" && payload.presentation === panelPresentation.current) {
          renderedPanel.current = payload;
        }
        if (kind === "activate" && key) await activatePanelItem(key);
      } catch (error) {
        await emitTo(TRAY_WORKBENCH_LABEL, TRAY_WORKBENCH_NOTICE, String(error));
      }
    }
    const subscription = listen(TRAY_WORKBENCH_ACTION, handleAction);
    return () => {
      panelReady.current = false;
      panelOpenRequested.current = null;
      void subscription.then((stop) => stop());
    };
  }, [activatePanelItem, isCoordinator, publishPanel, useWorkbenchPanel]);

  const sourceStructureKey = JSON.stringify({
    outputs: audioOutputs.map(({ id, label }) => [id, label]),
    inputs: audioInputs.map(({ id, label }) => [id, label]),
    applications: captureApplications.map(({ id, label }) => [id, label]),
    mixes: sourceMixes.map(({ id, label }) => [id, label]),
  });

  // The native menu event channel does not await the handler's promise.
  const menuConfig = useCallback(
    (inputs) => ({
      ...inputs,
      onToggleCapture: stableToggleCapture,
      onToggleWindow: stableToggleWindow,
      onLocateWindow: stableLocateWindow,
      onNewWorkbench: () => reportNativeAction(stableNewWorkbench),
      onQuit: stableQuit,
      onSelectSource: stableSelectSource,
      onApplyPreset: (id) => reportNativeAction(() => stableApplyPreset(id)),
      onToggleInstance: (instance) => reportNativeAction(() => stableToggleInstance(instance)),
      onInstanceAction: stableInstanceAction,
      onQuitInstance: stableQuitInstance,
      onQuitAll: stableQuitAll,
      onOpenSettings: () => reportNativeAction(stableOpenSettings),
      onOpenUpdate: () => reportNativeAction(stableOpenUpdate),
    }),
    [
      stableToggleCapture,
      stableToggleWindow,
      stableLocateWindow,
      stableNewWorkbench,
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

  useLayoutEffect(() => {
    panelDefinitions.current = () => {
      const cfg = menuConfig(menuInputsRef.current);
      return menuDefinitions({
        ...cfg,
        // The next queued action can run before React commits the new menu.
        instances: instancesRef.current,
        onNewWorkbench: stableNewWorkbench,
        onApplyPreset: stableApplyPreset,
        onToggleInstance: stableToggleInstance,
        onOpenSettings: stableOpenSettings,
        onOpenUpdate: stableOpenUpdate,
        onLocateWindow: () => navigationRef.current.onLocateWindow?.(),
        onInstanceAction: (instance, action, payload = null) =>
          issueInstanceCommand(instance.instanceId, action, payload),
      });
    };
  }, [
    menuConfig,
    stableApplyPreset,
    stableNewWorkbench,
    stableOpenSettings,
    stableOpenUpdate,
    stableToggleInstance,
  ]);

  // Create tray once on mount.
  useEffect(() => {
    if (!isTauri() || !isCoordinator) return;
    let cancelled = false;

    (async () => {
      const snapshot = menuInputsRef.current;
      const nativeMenu = useWorkbenchPanel
        ? null
        : await createNativeTrayMenu(menuDefinitions(menuConfig(snapshot)));

      const createdScheme = iconSchemeRef.current;
      const icon = await loadTrayIcon(createdScheme);

      await closeTrayIcon();
      if (cancelled) {
        await nativeMenu?.close();
        return;
      }
      const tray = await TrayIcon.new({
        id: PLVS_TRAY_ID,
        icon,
        iconAsTemplate: true,
        tooltip: "PLVS",
        menu: nativeMenu?.menu,
        showMenuOnLeftClick: false,
        action: (event) => {
          if (event.type === "Enter" || (event.type === "Click" && event.buttonState === "Down")) {
            refreshInstancesRef.current();
          }
          if (event.type === "Click" && event.button === "Left" && event.buttonState === "Up") {
            stableToggleWindow();
          }
          if (
            useWorkbenchPanel &&
            event.type === "Click" &&
            event.button === "Right" &&
            event.buttonState === "Up"
          ) {
            void stableOpenWorkbenchPanel(event.rect).catch((error) =>
              console.warn("Unable to open the Workbench panel", error)
            );
          }
        },
      });

      if (cancelled) {
        await nativeMenu?.close();
        tray.close();
      } else {
        setCurrentTrayIcon(tray);
        trayRef.current = tray;
        nativeMenuRef.current = nativeMenu;
        // The icon effect skipped any scheme change made before trayRef was set.
        if (iconSchemeRef.current !== createdScheme) {
          await tray.setIcon(await loadTrayIcon(iconSchemeRef.current));
        }
        // Reconcile anything that changed during async creation without replacing the menu.
        await nativeMenu?.update(menuDefinitions(menuConfig(menuInputsRef.current)));
      }
    })();

    return () => {
      cancelled = true;
      trayRef.current?.close();
      clearCurrentTrayIcon(trayRef.current);
      trayRef.current = null;
      void nativeMenuRef.current?.close();
      nativeMenuRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCoordinator, useWorkbenchPanel]);

  // The attached menu and surviving action channels stay stable for every state change.
  useEffect(() => {
    if (!isTauri() || !isCoordinator) return;
    if (useWorkbenchPanel) {
      void publishPanel().catch((error) =>
        console.warn("Unable to update the Workbench panel", error)
      );
    }
    void nativeMenuRef.current
      ?.update(menuDefinitions(menuConfig(menuInputsRef.current)))
      .catch((error) => console.warn("Unable to update PLVS Tray menu", error));
  }, [
    menuConfig,
    isCoordinator,
    publishPanel,
    useWorkbenchPanel,
    windowVisible,
    running,
    updateBusy,
    updateMenu?.text,
    updateMenu?.enabled,
    sourceStructureKey,
    safeAudioDeviceId,
    defaultOutputLabel,
    sourceBusy,
    presets.list,
    presets.activeId,
    presets.dirty,
    presets.blocked,
    instances,
    resolvedTheme,
    interfaceSize,
  ]);

  // Update tray icon when the scheme it sits on changes.
  useEffect(() => {
    if (!isTauri() || !trayRef.current) return;
    (async () => {
      const icon = await loadTrayIcon(iconScheme);
      await trayRef.current?.setIcon(icon);
    })();
  }, [iconScheme]);

  return {
    owner: isCoordinator && isTauri(),
    customPanel: useWorkbenchPanel,
    async read({ refresh = false } = {}) {
      if (!trayRef.current) return null;
      if (refresh) await refreshInstancesRef.current();
      const panel = useWorkbenchPanel ? await Window.getByLabel(TRAY_WORKBENCH_LABEL) : null;
      const visible = useWorkbenchPanel ? ((await panel?.isVisible()) ?? false) : null;
      const rendered =
        visible && renderedPanel.current?.presentation === panelPresentation.current
          ? renderedPanel.current
          : null;
      const items = panelItems(
        panelDefinitions.current(),
        window.__PLVS_INITIAL_STATE__?.instanceId
      );
      const navigation = rendered?.navigation ?? {};
      const signature = JSON.stringify([items, visible, rendered?.presentation, navigation]);
      if (inspectionVersion.current.signature !== signature) {
        inspectionVersion.current = {
          signature,
          generation: inspectionVersion.current.generation + 1,
        };
      }
      return {
        items,
        visible,
        navigation,
        uiGeneration: inspectionVersion.current.generation,
        rendered,
      };
    },
    open: (navigation) => stableOpenWorkbenchPanel(undefined, navigation),
    async close() {
      await (await Window.getByLabel(TRAY_WORKBENCH_LABEL))?.hide();
    },
    activate: activatePanelItem,
  };
}
