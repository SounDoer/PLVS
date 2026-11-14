import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isLinux } from "../lib/platform.js";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { UI_PREFERENCES, resolveInterfacePreferences } from "../uiPreferences.js";
import { onDockNativeGeometryChanged } from "../ipc/events.js";
import { KEYBOARD_SHORTCUT_ACTIONS } from "../data/keyboardShortcutActions.js";
import { isTauri } from "../ipc/env.js";
import {
  emitDockAccessoryState,
  listenDockAccessoryAction,
  listenDockAccessoryReady,
} from "../ipc/dockAccessoryEvents.js";
import { createAccessorySnapshot, normalizeAccessoryAction } from "./accessoryProtocol.js";
import { settingsViewSnapshot, createSettingsDispatcher } from "./settingsTransport.js";
import { createThemePublication, themeRuntime } from "../theme/themeRuntime.js";
import {
  UI_SETTINGS_SECTIONS,
  createUiNavigationError,
} from "../uiNavigation/uiNavigationModel.js";
import { useUiSurfaceRegistry } from "../uiNavigation/UiNavigationContext.jsx";
import { useOptionalEditorDraftRegistry } from "../agentControl/EditorDraftContext.jsx";

const REMOTE_KINDS = new Set([
  "settings",
  "confirmation",
  "dropdown",
  "libraryExport",
  "libraryPicker",
]);

export const SETTINGS_IDLE_RETIRE_MS = 60_000;

/** Main owns every operation. Only presentation data and explicitly named actions cross WebViews.
 * @param {any} options
 */
export function useDockSettingsWindow(options) {
  const surface = options.surface ?? "dock-settings";
  const registry = useUiSurfaceRegistry();
  const drafts = useOptionalEditorDraftRegistry();
  const latest = useRef(options);
  const revision = useRef(0);
  const clientReady = useRef(false);
  const readySession = useRef(null);
  const focusedPresentation = useRef(null);
  const pending = useRef(new Map());
  const serial = useRef(0);
  const registrations = useRef([]);
  const remoteRegistry = useRef(null);
  const [prepared, setPrepared] = useState(false);
  const [destroying, setDestroying] = useState(false);
  const [layout, setLayout] = useState(null);
  const retiring = useRef(false);
  const idleTimer = useRef(null);
  const [geometryEpoch, setGeometryEpoch] = useState(0);
  const [ready, setReady] = useState(null);
  const [error, setError] = useState("");
  const [navigation, setNavigation] = useState(null);
  const [reply, setReply] = useState(null);
  useLayoutEffect(() => {
    latest.current = options;
    if (options.enabled && options.active && idleTimer.current !== null) {
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
  });

  const reportError = useCallback((cause) => {
    const message = String(cause);
    setError(message);
    if (latest.current.enabled)
      void Promise.resolve(latest.current.onError?.(message)).catch(() => {});
  }, []);

  const clearRegistry = useCallback(() => {
    for (const dispose of registrations.current) dispose();
    registrations.current = [];
  }, []);
  const requestUi = useCallback(
    (kind, id, method, target = {}) =>
      new Promise((resolve, reject) => {
        const idNumber = ++serial.current;
        const timeout = setTimeout(() => {
          pending.current.delete(idNumber);
          reject(
            Object.assign(new Error("Settings did not respond in time."), {
              reason: "uiNotSettled",
            })
          );
        }, 3500);
        pending.current.set(idNumber, { resolve, reject, timeout });
        setNavigation({ id: idNumber, kind, key: id, method, target });
      }),
    []
  );
  const mirrorRegistry = useCallback(
    (snapshot) => {
      clearRegistry();
      if (
        !registry ||
        !snapshot ||
        !readySession.current ||
        snapshot.session !== latest.current.session
      )
        return;
      for (const item of snapshot.surfaces ?? []) {
        if (!REMOTE_KINDS.has(item.descriptor?.kind) || typeof item.id !== "string") continue;
        registrations.current.push(
          registry.registerUiSurface(item.id, item.descriptor, {
            current: {
              close: () => requestUi("surface", item.id, "close"),
              cancel: () => requestUi("surface", item.id, "cancel"),
              choices: item.descriptor.choices?.map((choice) => ({
                ...choice,
                run: () => requestUi("surface", item.id, "decide", { choice: choice.id }),
                ...(choice.dryRun && {
                  preview: () =>
                    requestUi("surface", item.id, "decide", { choice: choice.id, dryRun: true }),
                }),
                afterDelivery: choice.afterDelivery,
              })),
            },
          })
        );
      }
      for (const key of snapshot.targets ?? []) {
        if (!key.startsWith("dropdown:")) continue;
        registrations.current.push(
          registry.registerUiTarget(key, {
            current: { show: (target) => requestUi("target", key, "show", target) },
          })
        );
      }
      for (const item of snapshot.decisions ?? []) {
        if (!drafts || !["theme", "loudnessProfile"].includes(item.editorKind)) continue;
        registrations.current.push(
          drafts.registerDraftDecision(item.id, item.editorKind, item.editorSurfaceId, {
            current: () => requestUi("decision", item.id, "discard"),
          })
        );
      }
    },
    [clearRegistry, drafts, registry, requestUi]
  );

  const dispatch = useRef(null);
  useEffect(() => {
    dispatch.current = createSettingsDispatcher({
      read: () => latest.current,
      commit: (callback) => {
        let returned;
        flushSync(() => {
          returned = callback();
        });
        return returned;
      },
    });
  }, []);
  const publish = useCallback(async () => {
    if (!clientReady.current) return;
    const current = latest.current;
    const active = current.enabled && current.active;
    const snapshot = active ? settingsViewSnapshot(current.view, current.model) : null;
    await emitDockAccessoryState(
      surface,
      createAccessorySnapshot(surface, ++revision.current, {
        session: active ? current.session : null,
        view: active ? current.view : null,
        snapshot,
        interfaceSize: current.interfaceSize,
        keyboard: current.keyboard,
        theme: createThemePublication(themeRuntime.getSnapshot()),
        navigation,
        reply,
      })
    );
  }, [navigation, reply, surface]);
  const publishRef = useRef(publish);
  useLayoutEffect(() => {
    publishRef.current = publish;
  });

  useEffect(() => {
    if (!isTauri()) return undefined;
    let disposed = false;
    const requests = pending.current;
    const disposers = [];
    const result = (value) => {
      if (!disposed) flushSync(() => setReply(value));
    };
    const retireIdleHost = () => {
      if (
        disposed ||
        (latest.current.enabled && latest.current.active) ||
        retiring.current ||
        !clientReady.current
      )
        return;
      retiring.current = true;
      clientReady.current = false;
      readySession.current = null;
      clearRegistry();
      setReady(null);
      setDestroying(true);
      void invoke("destroy_dock_settings_window", { surface })
        .then(() => {
          setPrepared(false);
          remoteRegistry.current = null;
        })
        .catch((error) => {
          clientReady.current = true;
          reportError(error);
        })
        .finally(() => {
          retiring.current = false;
          setDestroying(false);
        });
    };
    void Promise.allSettled([
      listenDockAccessoryReady((event) => {
        if (event?.surface !== surface) return;
        clientReady.current = true;
        void publishRef.current().catch((error) => reportError(error));
      }),
      listenDockAccessoryAction((raw) => {
        const action = normalizeAccessoryAction(raw);
        if (action?.surface !== surface) return;
        const value = action.payload;
        if (action.type === "settings-idle") {
          if (
            (latest.current.enabled && latest.current.active) ||
            retiring.current ||
            !clientReady.current
          )
            return;
          if (surface === "dock-authoring") retireIdleHost();
          else if (idleTimer.current === null)
            idleTimer.current = setTimeout(() => {
              idleTimer.current = null;
              retireIdleHost();
            }, SETTINGS_IDLE_RETIRE_MS);
          return;
        }

        if (action.type === "settings-ui-result") {
          const request = pending.current.get(value.id);
          if (!request) return;
          clearTimeout(request.timeout);
          pending.current.delete(value.id);
          if (value.error)
            request.reject(Object.assign(new Error(value.error.message), value.error));
          else request.resolve(value.result);
          return;
        }
        if (action.type === "settings-action") {
          result({ sequence: value.sequence, session: value.session, pending: true });
          void dispatch.current(value).then(
            (returned) =>
              result({
                sequence: value.sequence,
                session: value.session,
                value: JSON.parse(JSON.stringify(returned ?? null)),
              }),
            (error) =>
              result({
                sequence: value.sequence,
                session: value.session,
                error: String(error.message ?? error),
              })
          );
          return;
        }
        if (
          value.session !== latest.current.session ||
          !latest.current.active ||
          !latest.current.enabled
        )
          return;
        if (action.type === "settings-layout") {
          if (
            Number.isFinite(value.width) &&
            Number.isFinite(value.height) &&
            value.width > 0 &&
            value.height > 0
          )
            setLayout({
              session: value.session,
              width: value.width,
              height: value.height,
              preview: value.preview === true,
              webviewScale:
                Number.isFinite(value.webviewScale) && value.webviewScale > 0
                  ? value.webviewScale
                  : window.devicePixelRatio,
            });
          return;
        }
        if (action.type === "open-settings") {
          latest.current.openSection();
          return;
        }
        if (
          action.type === "keyboard-shortcut" &&
          KEYBOARD_SHORTCUT_ACTIONS.some(({ id }) => id === value.actionId)
        ) {
          latest.current.onShortcut?.(value.actionId);
          return;
        }
        if (action.type === "settings-ready") setReady(value.session);
        else if (action.type === "settings-registry") {
          remoteRegistry.current = { ...value.registry, session: value.session };
          mirrorRegistry(remoteRegistry.current);
        } else if (action.type === "ui-targets") latest.current.onTargets?.(value.targets ?? []);
      }),
    ]).then((results) => {
      for (const result of results) {
        if (result.status === "fulfilled") {
          if (disposed) result.value();
          else disposers.push(result.value);
        } else if (!disposed) reportError(result.reason);
      }
    });
    return () => {
      disposed = true;
      clearTimeout(idleTimer.current);
      idleTimer.current = null;
      disposers.forEach((dispose) => dispose());
      for (const request of requests.values()) {
        clearTimeout(request.timeout);
        request.reject(new Error("Settings host closed."));
      }
      requests.clear();
    };
  }, [clearRegistry, mirrorRegistry, reportError, surface]);

  const needed = options.enabled && options.active;
  useEffect(() => {
    if (!isTauri() || !needed || prepared || destroying) return undefined;
    let canceled = false;
    void invoke("prepare_dock_settings_window", { surface })
      .then(() => {
        if (!canceled) setPrepared(true);
      })
      .catch((error) => {
        if (!canceled) reportError(error);
      });
    return () => {
      canceled = true;
    };
  }, [needed, prepared, destroying, reportError, surface]);
  // Only Settings data changes trigger publication; capture frames never cross this boundary.
  const snapshotKey = JSON.stringify(
    needed ? settingsViewSnapshot(options.view, options.model) : null
  );
  const keyboardKey = JSON.stringify(options.keyboard);
  useEffect(() => {
    if (clientReady.current) void publish().catch((error) => reportError(error));
  }, [
    snapshotKey,
    keyboardKey,
    options.session,
    options.interfaceSize,
    needed,
    publish,
    reportError,
  ]);
  useEffect(() => {
    if (!needed) return undefined;
    return themeRuntime.subscribe(
      (value) => value,
      () => void publishRef.current().catch((error) => reportError(error))
    );
  }, [needed, reportError]);

  useEffect(() => {
    if (!isTauri() || !needed) return undefined;
    let disposed = false;
    let stop;
    void onDockNativeGeometryChanged(() => setGeometryEpoch((value) => value + 1))
      .then((dispose) => {
        if (disposed) dispose();
        else stop = dispose;
      })
      .catch((error) => reportError(error));
    return () => {
      disposed = true;
      stop?.();
    };
  }, [needed, reportError]);
  const preferences = resolveInterfacePreferences(UI_PREFERENCES, options.interfaceSize);
  const reportedLayout = layout?.session === options.session ? layout : null;
  const logicalWidth =
    surface === "dock-authoring"
      ? (reportedLayout?.width ?? preferences.layout.editor.preferredWidthPx + 16)
      : preferences.layout.drawer.preferredWidthPx;
  const logicalHeight = surface === "dock-authoring" ? (reportedLayout?.height ?? 400) : 800;
  const preview = reportedLayout?.preview ?? false;
  const { maxHeightPx, maxViewportFraction } = preferences.layout.editor;
  const webviewScale = reportedLayout?.webviewScale ?? window.devicePixelRatio;
  const visible = needed && !options.suspended && ready === options.session;
  useEffect(() => {
    if (!isTauri()) return undefined;
    let canceled = false;
    const focusKey = `${options.session}:${options.focusEpoch ?? 0}`;
    const focus = visible && focusedPresentation.current !== focusKey;
    void invoke("set_dock_settings_window", {
      surface,
      visible,
      layout: {
        logicalWidth,
        logicalHeight,
        preview,
        ...(["theme", "profile"].includes(options.view)
          ? { editorHeightPolicy: { maxHeightPx, maxViewportFraction } }
          : {}),
      },
      edge: options.edge ?? "top",
      webviewScale,
      focus,
    })
      .then((rect) => {
        if (canceled) return;
        focusedPresentation.current = visible ? focusKey : null;
        readySession.current = visible ? latest.current.session : null;
        mirrorRegistry(visible ? remoteRegistry.current : null);
        latest.current.onReady?.(visible ? latest.current.session : null);
        latest.current.onGeometry?.(
          rect
            ? {
                visible: true,
                windowLabel: surface,
                devicePixelRatio: webviewScale,
                width: rect.width / webviewScale,
                height: rect.height / webviewScale,
              }
            : null
        );
      })
      .catch((error) => {
        if (!canceled) reportError(error);
      });
    return () => {
      canceled = true;
    };
  }, [
    visible,
    options.session,
    options.edge,
    options.focusEpoch,
    geometryEpoch,
    logicalWidth,
    logicalHeight,
    maxHeightPx,
    maxViewportFraction,
    options.view,
    webviewScale,
    preview,
    surface,
    mirrorRegistry,
    reportError,
  ]);
  useEffect(() => () => clearRegistry(), [clearRegistry]);
  useEffect(() => {
    if (!registry || !options.enabled || surface !== "dock-settings") return undefined;
    return registry.registerUiTarget("settings", {
      current: {
        show: async ({ section }) => {
          if (!UI_SETTINGS_SECTIONS.includes(section))
            throw createUiNavigationError("uiTargetNotFound", { kind: "settings", section });
          latest.current.openSection(section);
          // A cold WebKitGTK renderer can take longer to hydrate the hidden settings host.
          const deadline = Date.now() + (isLinux() ? 8000 : 3000);
          while (!readySession.current || latest.current.view !== "settings") {
            if (Date.now() >= deadline)
              throw Object.assign(new Error("Settings did not become visible."), {
                reason: "uiNotSettled",
              });
            await new Promise((resolve) => setTimeout(resolve, 16));
          }
          await requestUi("target", "settings", "show", { section });
        },
      },
    });
  }, [options.enabled, registry, requestUi, surface]);
  return { error };
}
