import { useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "../../lib/utils.js";
import { useAccessoryClient } from "./useAccessoryClient.js";
import { DockModulesEditor } from "../editors/DockModulesEditor.jsx";
import { DockModuleSettings } from "../editors/DockModuleSettings.jsx";
import { DockPresetsRow } from "../editors/DockPresetsRow.jsx";

export const DOCK_EDITOR_BLUR_CLOSE_DELAY_MS = 100;

export function measureDockEditorContent(root) {
  const shell = root?.querySelector("[data-dock-editor-shell]");
  const content = root?.querySelector("[data-dock-editor-content]");
  if (!shell || !content) return null;
  const header = shell.querySelector("header");
  return {
    width: Math.ceil(Math.max(root.scrollWidth, shell.scrollWidth, content.scrollWidth) + 2),
    height: Math.ceil((header?.offsetHeight || 0) + content.scrollHeight + 2),
  };
}

export function DockEditorApp() {
  const { payload, action, pointer } = useAccessoryClient("dock-editor");
  const rootRef = useRef(null);
  const pointerActiveRef = useRef(false);
  const lastSizeRef = useRef(null);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") action("close-editor");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [action]);

  useEffect(() => {
    let blurTimer = null;
    const onPointerDown = (event) => {
      const inside = rootRef.current?.contains(event.target) === true;
      pointerActiveRef.current = inside;
      if (!inside) action("close-editor");
    };
    const onPointerEnd = () => {
      pointerActiveRef.current = false;
    };
    const onBlur = () => {
      if (!pointerActiveRef.current) {
        blurTimer = setTimeout(
          () => action("close-editor", { view: payload?.view }),
          DOCK_EDITOR_BLUR_CLOSE_DELAY_MS
        );
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerEnd, true);
    window.addEventListener("pointercancel", onPointerEnd, true);
    window.addEventListener("blur", onBlur);
    return () => {
      if (blurTimer) clearTimeout(blurTimer);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerEnd, true);
      window.removeEventListener("pointercancel", onPointerEnd, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [action, payload?.view]);

  useLayoutEffect(() => {
    if (!payload?.view) {
      lastSizeRef.current = null;
      return;
    }
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = measureDockEditorContent(root);
        if (!next) return;
        if (
          lastSizeRef.current?.width === next.width &&
          lastSizeRef.current?.height === next.height
        ) {
          return;
        }
        lastSizeRef.current = next;
        action("resize-editor", next);
      });
    };
    measure();
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resizeObserver?.observe(root);
    const mutationObserver = new MutationObserver(measure);
    mutationObserver.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
    };
  }, [action, payload?.view]);

  if (!payload) return null;
  const close = () => action("close-editor");
  const presetController = {
    ...payload.presets,
    apply: (presetId) => action("apply-preset", { presetId }),
    save: (name) => action("save-preset", { name }),
    update: (presetId) => action("update-preset", { presetId }),
    rename: (presetId, name) => action("rename-preset", { presetId, name }),
    remove: (presetId) => action("delete-preset", { presetId }),
  };
  const moduleId = payload.view?.startsWith("module:") ? payload.view.slice(7) : null;
  return (
    <div
      ref={rootRef}
      data-testid="dock-editor"
      onPointerEnter={() => pointer(true)}
      onPointerLeave={() => pointer(false)}
      className={cn(
        "inline-block max-h-screen overflow-hidden border border-border/70 bg-background/95 text-foreground shadow-lg backdrop-blur-sm",
        payload.view === "presets"
          ? "w-60"
          : payload.view === "modules"
            ? "w-max min-w-44"
            : "w-[400px]"
      )}
    >
      {payload.view === "modules" ? (
        <DockModulesEditor
          modules={payload.modules}
          onAdd={(moduleId) => action("add-module", { moduleId })}
          onRemove={(moduleId) => action("remove-module", { moduleId })}
          onReorder={(modules) => action("reorder-module", { modules })}
          onOpenSettings={(moduleId) => action("open-module-settings", { moduleId })}
          onDone={close}
        />
      ) : payload.view === "presets" ? (
        <DockPresetsRow presets={presetController} onDone={close} />
      ) : moduleId ? (
        <DockModuleSettings
          moduleId={moduleId}
          controls={payload.controlsByModuleId[moduleId]}
          onChange={(controls) => action("update-module-controls", { moduleId, controls })}
          onReset={() => action("reset-module-controls", { moduleId })}
          onBack={() => action("open-editor", { view: "modules" })}
          onDone={close}
        />
      ) : null}
    </div>
  );
}
