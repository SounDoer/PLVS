import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import {
  PANEL_SETTINGS_SURFACE_CLASS,
  POPOVER_SURFACE_CLASS,
} from "../../components/ui/surfaceStyles.js";
import { cn } from "../../lib/utils.js";
import { useAccessoryClient } from "./useAccessoryClient.js";
import { DockModulesEditor } from "../editors/DockModulesEditor.jsx";
import { DockModuleSettings } from "../editors/DockModuleSettings.jsx";
import { DockPresetsRow } from "../editors/DockPresetsRow.jsx";
import { resolvePanelDisplayName } from "../../workspace/panelInstances.js";
import { panelModuleIdForDockModuleId } from "../dockLayout.js";

export const DOCK_EDITOR_BLUR_CLOSE_DELAY_MS = 100;

export function measureDockEditorContent(root) {
  const shell = root?.querySelector("[data-dock-editor-shell]");
  const content = root?.querySelector("[data-dock-editor-content]");
  if (!shell || !content) return null;
  const header = shell.querySelector("header");
  const style = typeof getComputedStyle === "function" ? getComputedStyle(root) : null;
  const chromeHeight = style
    ? [style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderBottomWidth].reduce(
        (sum, value) => sum + (Number.parseFloat(value) || 0),
        0
      )
    : 0;
  return {
    width: Math.ceil(Math.max(root.scrollWidth, shell.scrollWidth, content.scrollWidth) + 2),
    height: Math.ceil((header?.offsetHeight || 0) + content.scrollHeight + (chromeHeight || 2)),
  };
}

export function DockEditorApp() {
  const { payload, action, pointer } = useAccessoryClient("dock-editor");
  const rootRef = useRef(null);
  const pointerActiveRef = useRef(false);
  const lastSizeRef = useRef(null);
  const onHoverModule = useCallback((panelId) => action("hover-module", { panelId }), [action]);

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
          () => action("close-editor", { view: payload?.view, reason: "blur" }),
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
    const measureNow = () => {
      const next = measureDockEditorContent(root);
      if (!next) return;
      if (
        lastSizeRef.current?.view === payload.view &&
        lastSizeRef.current?.width === next.width &&
        lastSizeRef.current?.height === next.height
      ) {
        return;
      }
      lastSizeRef.current = { ...next, view: payload.view };
      action("resize-editor", { ...next, view: payload.view });
    };
    const scheduleMeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measureNow);
    };
    // Hidden WKWebViews may not receive an animation frame. Measure once from
    // the committed DOM so the native window can be sized before it is shown.
    measureNow();
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(root);
    const mutationObserver = new MutationObserver(scheduleMeasure);
    mutationObserver.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
    };
  }, [action, payload?.view]);

  if (!payload) return null;
  const presetController = {
    ...payload.presets,
    apply: (presetId) => action("apply-preset", { presetId }),
    save: (name) => action("save-preset", { name }),
    update: (presetId) => action("update-preset", { presetId }),
    rename: (presetId, name) => action("rename-preset", { presetId, name }),
    remove: (presetId) => action("delete-preset", { presetId }),
  };
  const panelId = payload.view?.startsWith("module:") ? payload.view.slice(7) : null;
  const panel = panelId
    ? (payload.panelsById?.[panelId] ?? {
        id: panelId,
        moduleId: panelModuleIdForDockModuleId(panelId),
      })
    : null;
  return (
    <div
      ref={rootRef}
      data-testid="dock-editor"
      onPointerEnter={() => pointer(true)}
      onPointerLeave={() => pointer(false)}
      className={cn(
        "inline-block max-h-screen overflow-hidden",
        POPOVER_SURFACE_CLASS,
        payload.view?.startsWith("module:") && cn("p-1", PANEL_SETTINGS_SURFACE_CLASS),
        payload.view === "presets"
          ? "w-60"
          : payload.view === "modules"
            ? "w-max min-w-44"
            : "w-max min-w-48 max-w-[400px]"
      )}
    >
      {payload.view === "modules" ? (
        <DockModulesEditor
          panels={payload.panels}
          vectorscopeSettingsAvailable={payload.vectorscopeSettingsAvailable}
          onAdd={(moduleId) => action("add-module", { moduleId })}
          onRename={(panelId, name) => action("rename-module", { panelId, name })}
          onRemove={(panelId) => action("remove-module", { panelId })}
          onReorder={(panelOrder) => action("reorder-module", { panelOrder })}
          onHover={onHoverModule}
          onOpenSettings={(panelId) => action("open-module-settings", { panelId })}
        />
      ) : payload.view === "presets" ? (
        <DockPresetsRow presets={presetController} />
      ) : panel ? (
        <DockModuleSettings
          moduleId={panel.moduleId}
          title={resolvePanelDisplayName(
            { panelsById: payload.panelsById, panelOrder: payload.panelOrder },
            panel.id
          )}
          controls={payload.controlsByPanelId?.[panel.id]}
          vectorscopeOptions={payload.vectorscopeOptions}
          spectrumOptions={payload.spectrumOptions}
          channelCount={payload.channelCount}
          onChange={(controls) => action("update-module-controls", { panelId: panel.id, controls })}
          onReset={() => action("reset-module-controls", { panelId: panel.id })}
          onBack={() => action("open-editor", { view: "modules" })}
        />
      ) : null}
    </div>
  );
}
