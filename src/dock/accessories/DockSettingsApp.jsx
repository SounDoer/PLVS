import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FloatingPanelHostProvider } from "../../hooks/FloatingPanelHostContext.jsx";
import { useAuthoringLayout } from "./useAuthoringLayout.js";
import { LAYER_PRIORITY } from "../../components/ui/layers.js";
import { useSuppressNativeContextMenu } from "../../hooks/useSuppressNativeContextMenu.js";
import { SettingsContent } from "../../components/SettingsContent.jsx";
import { SettingsWindowFrame } from "../../components/settings/SettingsFrames.jsx";
import { ThemeEditor } from "../../components/ThemeEditor.jsx";
import { LoudnessProfileEditor } from "../../components/LoudnessProfileEditor.jsx";
import { FeedbackContent } from "../../components/FeedbackDialog.jsx";
import { LibraryExportDialog } from "../../components/LibraryExportDialog.jsx";
import { UiSurfaceRegistryProvider } from "../../uiNavigation/UiNavigationContext.jsx";
import { EditorDraftRegistryProvider } from "../../agentControl/EditorDraftContext.jsx";
import {
  emitDockAccessoryAction,
  emitDockAccessoryReady,
  listenDockAccessoryState,
  listenDockAccessoryAction,
} from "../../ipc/dockAccessoryEvents.js";
import { acceptAccessorySnapshot } from "../accessoryProtocol.js";
import { applyResolvedThemeToDocument, isThemePublication } from "../../theme/themeRuntime.js";
import {
  UI_PREFERENCES,
  applyLayoutToDocument,
  resolveInterfacePreferencesForSurface,
} from "../../uiPreferences.js";
import { settingsActionArguments, optimisticSettingsValue } from "../settingsTransport.js";
import { useAccessoryKeyboardShortcuts } from "./useAccessoryKeyboardShortcuts.js";
import { useAccessoryTargetReport } from "./useAccessoryTargetReport.js";

/** Presentation only: no settings stores, capture engines, shortcuts, or native file operations. */
export function DockSettingsApp({ surface = "dock-settings" }) {
  useSuppressNativeContextMenu();
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const revision = useRef(-1);
  const sequence = useRef(0);
  const outstanding = useRef(new Map());
  const latest = useRef(null);
  latest.current = payload;
  useEffect(() => {
    let disposed = false;
    const operations = outstanding.current;
    let unlisten;
    void listenDockAccessoryState((snapshot) => {
      const accepted = acceptAccessorySnapshot(revision.current, snapshot, surface);
      if (!accepted) return;
      revision.current = accepted.revision;
      const value = accepted.payload;
      if (value.session && value.session !== latest.current?.session) setError("");
      if (isThemePublication(value.theme)) applyResolvedThemeToDocument(value.theme);
      applyLayoutToDocument(
        resolveInterfacePreferencesForSurface(
          UI_PREFERENCES,
          value.interfaceSize ?? "default",
          surface
        )
      );
      if (value.reply) {
        const operation = outstanding.current.get(value.reply.sequence);
        if (operation && operation.session === value.reply.session) {
          clearTimeout(operation.timeout);
          if (value.reply.pending) operation.pending = true;
          else {
            outstanding.current.delete(value.reply.sequence);
            if (value.reply.error) {
              operation.reject(new Error(value.reply.error));
              setError(value.reply.error);
            } else operation.resolve(value.reply.value);
          }
        }
      }

      for (const [id, operation] of outstanding.current) {
        if (operation.session === value.session) continue;
        clearTimeout(operation.timeout);
        // A successful Save/Cancel can replace the view before its reply is published.
        // Keep its promise until the explicit reply rather than claiming success on a view change.
        if (!operation.pending && !operation.settling) {
          operation.settling = true;
          operation.timeout = setTimeout(() => {
            outstanding.current.delete(id);
            operation.reject(new Error("Settings session changed."));
          }, 3500);
        }
      }
      setPayload(value);
    })
      .then((dispose) => {
        if (disposed) dispose();
        else {
          unlisten = dispose;
          void emitDockAccessoryReady(surface);
        }
      })
      .catch((error) => setError(String(error)));
    return () => {
      disposed = true;
      unlisten?.();
      for (const operation of operations.values()) {
        clearTimeout(operation.timeout);
        operation.reject(new Error("Settings window closed."));
      }
      operations.clear();
    };
  }, [surface]);
  const send = useCallback(
    (type, values = {}) =>
      emitDockAccessoryAction({
        surface: surface,
        type,
        payload: { ...values, session: values.session ?? latest.current?.session },
      }),
    [surface]
  );
  const call = useCallback(
    (session, name, args) => {
      const id = ++sequence.current;
      setError("");
      const promise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          outstanding.current.delete(id);
          reject(new Error("Settings action timed out."));
          setError("Settings action timed out. Reopen Settings to refresh its state.");
        }, 10000);
        outstanding.current.set(id, {
          session,
          sequence: id,
          name,
          args,
          resolve,
          reject,
          timeout,
        });
      });
      // React input controls must retain their latest typed value until the owner acknowledges it.
      setPayload((value) => ({ ...value }));
      void send("settings-action", { session, sequence: id, name, args }).catch((error) =>
        setError(String(error))
      );
      // Event handlers often intentionally ignore return values. Report the error in the host as well.
      void promise.catch(() => {});
      return promise;
    },
    [send]
  );
  useEffect(() => {
    if (payload && !payload.session && outstanding.current.size === 0) void send("settings-idle");
  }, [payload, send]);
  let model = payload?.snapshot?.values;
  if (model) {
    for (const operation of outstanding.current.values()) {
      if (operation.session === payload.session)
        model = optimisticSettingsValue(payload.view, model, operation.name, operation.args);
    }
    model = { ...model };
    for (const name of payload.snapshot.actions)
      model[name] = (...args) => call(payload.session, name, settingsActionArguments(name, args));
  }
  return (
    <main
      className={`h-screen overflow-hidden text-foreground ${surface === "dock-authoring" ? "grid place-items-center bg-transparent p-2" : "bg-card"}`}
      data-visual-capture-surface="dockSettings"
      data-visual-capture-ready={payload?.session ? "true" : "false"}
    >
      {error ? (
        <div
          role="alert"
          className={`${LAYER_PRIORITY} absolute inset-x-0 bottom-0 border border-destructive bg-card p-2 text-[length:var(--ui-fs-control)]`}
        >
          {error}
        </div>
      ) : null}
      {payload?.session && model ? (
        <SettingsSession
          key={payload.session}
          surface={surface}
          payload={payload}
          model={model}
          send={send}
          onError={setError}
        />
      ) : null}
    </main>
  );
}

function SettingsSession({ surface, payload, model, send: sendToMain, onError }) {
  const send = useCallback(
    (type, values = {}) => sendToMain(type, { ...values, session: payload.session }),
    [payload.session, sendToMain]
  );
  const surfaces = useRef(new Map());
  const targets = useRef(new Map());
  const decisions = useRef(new Map());
  const scheduled = useRef(false);
  const report = useCallback(() => {
    if (scheduled.current) return;
    scheduled.current = true;
    queueMicrotask(() => {
      scheduled.current = false;
      void send("settings-registry", {
        registry: {
          surfaces: [...surfaces.current].map(([id, value]) => ({
            id,
            descriptor: value.descriptor,
          })),
          targets: [...targets.current.keys()],
          decisions: [...decisions.current].map(([id, value]) => ({
            id,
            editorKind: value.editorKind,
            editorSurfaceId: value.editorSurfaceId,
          })),
        },
      });
    });
  }, [send]);
  const registry = useMemo(
    () => ({
      registerUiSurface: (id, descriptor, actions) => {
        surfaces.current.set(id, { descriptor, actions });
        report();
        return () => {
          surfaces.current.delete(id);
          report();
        };
      },
      updateUiSurface: (id, descriptor) => {
        const old = surfaces.current.get(id);
        if (old) {
          surfaces.current.set(id, { ...old, descriptor });
          report();
        }
      },
      registerUiTarget: (key, controller) => {
        targets.current.set(key, controller);
        report();
        return () => {
          targets.current.delete(key);
          report();
        };
      },
      reportUiStatus: () => {},
    }),
    [report]
  );
  const draftRegistry = useMemo(
    () => ({
      registerDraftDecision: (id, editorKind, editorSurfaceId, actionRef) => {
        decisions.current.set(id, { editorKind, editorSurfaceId, actionRef });
        report();
        return () => {
          decisions.current.delete(id);
          report();
        };
      },
    }),
    [report]
  );
  const action = useCallback((type, values = {}) => send(type, values), [send]);
  useAccessoryTargetReport(action);
  useAuthoringLayout(surface === "dock-authoring", payload.interfaceSize, action, payload.view);
  useAccessoryKeyboardShortcuts(payload.keyboard, action);
  useLayoutEffect(() => {
    report();
    void send("settings-ready");
  }, [report, send]);
  const dismiss = useRef(null);
  useLayoutEffect(() => {
    dismiss.current = () => {
      if (payload.view === "theme" || payload.view === "profile") return model.onDismiss?.();
      if (payload.view === "feedback" || payload.view === "libraryExport") return model.onClose?.();
      return model.setSettingsOpen?.(false);
    };
  });
  useEffect(() => {
    let disposed = false;
    let stop;
    // Native close enters the same ordered action stream as typing and the visible Cancel button.
    void listenDockAccessoryAction((event) => {
      if (event?.surface === surface && event.type === "settings-dismiss") void dismiss.current?.();
    }).then((dispose) => {
      if (disposed) dispose();
      else stop = dispose;
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [surface]);
  const handled = useRef(0);
  useEffect(() => {
    const request = payload.navigation;
    if (!request || request.id <= handled.current) return;
    handled.current = request.id;
    const execute = async () => {
      if (request.kind === "target") {
        const controller = targets.current.get(request.key)?.current;
        if (!controller?.[request.method])
          throw new Error("The requested Settings control is unavailable.");
        await controller[request.method](request.target);
      } else if (request.kind === "surface") {
        const actions = surfaces.current.get(request.key)?.actions.current;
        if (request.method === "decide") {
          const choice = actions?.choices?.find((item) => item.id === request.target.choice);
          const callback = request.target.dryRun ? choice?.preview : choice?.run;
          if (!callback || choice.disabled)
            throw new Error("The requested Settings choice is unavailable.");
          return callback();
        }
        const callback = actions?.[request.method];
        if (!callback) throw new Error("The requested Settings surface is unavailable.");
        await callback();
      } else if (request.kind === "decision") {
        const decision = decisions.current.get(request.key);
        if (!decision) throw new Error("The requested draft decision is unavailable.");
        await decision.actionRef.current();
      }
    };
    void execute().then(
      (result) => send("settings-ui-result", { id: request.id, result }),
      (error) =>
        send("settings-ui-result", {
          id: request.id,
          error: {
            message: error.message,
            reason: error.reason ?? "uiNotSettled",
            details: error.details,
          },
        })
    );
  }, [payload.navigation, send]);
  useEffect(() => {
    const onPaste = (event) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      )
        return;
      const text = event.clipboardData?.getData("text/plain");
      if (text) {
        event.preventDefault();
        void send("import-paste", { text });
      }
    };
    window.addEventListener("paste", onPaste);
    const onKey = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Nested Radix dialogs and dropdowns own Escape first.
      if (
        document.querySelector(
          '[role="alertdialog"], [data-slot="select-content"], [data-slot="popover-content"]'
        )
      )
        return;
      void dismiss.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  }, [model, payload.view, send]);
  const getModalBackdropElement = useCallback(
    () => document.querySelector("[data-settings-editor]"),
    []
  );
  // The session key resets local expansion and focus only when the owning flow changes.
  return (
    <UiSurfaceRegistryProvider registry={registry}>
      <EditorDraftRegistryProvider registry={draftRegistry}>
        <FloatingPanelHostProvider
          getModalBackdropElement={surface === "dock-authoring" ? getModalBackdropElement : null}
          startDragging={
            surface === "dock-authoring"
              ? () =>
                  getCurrentWindow()
                    .startDragging()
                    .catch((error) => onError(String(error)))
              : null
          }
        >
          {payload.view === "settings" ? (
            <SettingsContent {...model} Frame={SettingsWindowFrame} />
          ) : null}
          {payload.view === "theme" ? <ThemeEditor {...model} onMove={() => {}} /> : null}
          {payload.view === "profile" ? (
            <LoudnessProfileEditor {...model} onMove={() => {}} />
          ) : null}
          {payload.view === "feedback" ? (
            <FeedbackContent
              controller={model}
              onClose={model.onClose}
              onPrivacy={model.onPrivacy}
            />
          ) : null}
          {payload.view === "libraryExport" ? <LibraryExportDialog {...model} /> : null}
        </FloatingPanelHostProvider>
      </EditorDraftRegistryProvider>
    </UiSurfaceRegistryProvider>
  );
}
