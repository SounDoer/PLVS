import { DockViews } from "../editors/DockViews.jsx";
import { AppStatusList } from "../../components/AppStatus.jsx";
import { DockEditorShell } from "../editors/DockEditorShell.jsx";
import { DeviceSelectionContent } from "../../components/DeviceSelectionContent.jsx";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { POPOVER_SURFACE_CLASS } from "../../components/ui/surfaceStyles.js";
import { cn } from "../../lib/utils.js";
import { useAccessoryClient } from "./useAccessoryClient.js";
import { DockModulesEditor } from "../editors/DockModulesEditor.jsx";
import { DockModuleSettings } from "../editors/DockModuleSettings.jsx";
import { DockPresetsRow } from "../editors/DockPresetsRow.jsx";
import { DockLoudnessProfileRow } from "../editors/DockLoudnessProfileRow.jsx";
import { LOUDNESS_PROFILE_OFF } from "../../lib/loudnessProfileCatalog.js";
import { resolvePanelDisplayName } from "../../workspace/panelInstances.js";
import { panelModuleIdForDockModuleId } from "../dockLayout.js";
import { useSuppressNativeContextMenu } from "../../hooks/useSuppressNativeContextMenu.js";
import { LoudnessProfileProvider } from "../../hooks/LoudnessProfileContext.jsx";

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

// Radix keeps a floating menu 10px clear of the window edge; the rest covers the menu's own offset
// from its trigger.
const SELECT_MENU_MARGIN_PX = 16;
// The tallest a settings select menu gets; see SettingsSelect.
const SELECT_MENU_MAX_HEIGHT_REM = 24;

/**
 * Extra window height that lets every settings select in the editor open its menu whole. A
 * floating menu is confined to its window, and a window only as large as the editor squeezes a
 * menu down to its scroll buttons, so the window carries transparent room on the side away from
 * the Dock strip: below the editor on a top Dock, above it on a bottom Dock.
 *
 * The room is there for as long as the editor shows selects and is sized for the tallest menu,
 * because the window must not change while a menu opens. The select closes on any window resize,
 * and growing a window upward shows its old picture displaced for a frame.
 *
 * @param {HTMLElement} root
 * @param {string} [edge]
 */
export function measureSelectMenuRoom(root, edge) {
  const triggers = root.querySelectorAll('[data-slot="select-trigger"]');
  if (triggers.length === 0) return 0;
  const remPx = Number.parseFloat(getComputedStyle(root.ownerDocument.documentElement).fontSize);
  const needed = SELECT_MENU_MAX_HEIGHT_REM * (remPx || 16) + SELECT_MENU_MARGIN_PX;
  const rootRect = root.getBoundingClientRect();
  let room = 0;
  for (const trigger of triggers) {
    const rect = trigger.getBoundingClientRect();
    const available = edge === "bottom" ? rect.top - rootRect.top : rootRect.bottom - rect.bottom;
    room = Math.max(room, Math.ceil(needed - available));
  }
  return room;
}

export function DockEditorApp() {
  const { payload, action } = useAccessoryClient("dock-editor");
  const rootRef = useRef(null);
  const pointerActiveRef = useRef(false);
  const lastSizeRef = useRef(null);
  const onHoverModule = useCallback((panelId) => action("hover-module", { panelId }), [action]);
  useSuppressNativeContextMenu();

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
      const inside =
        rootRef.current?.contains(event.target) === true ||
        event.target.closest?.("[data-settings-select-menu]") != null;
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
      const content = measureDockEditorContent(root);
      if (!content) return;
      const next = {
        width: content.width,
        height: content.height + measureSelectMenuRoom(root, payload.edge),
      };
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
  }, [action, payload?.view, payload?.edge]);

  if (!payload) return null;
  const presetController = {
    ...payload.presets,
    apply: (presetId) => action("apply-preset", { presetId }),
    save: (name) => action("save-preset", { name }),
    update: (presetId) => action("update-preset", { presetId }),
    rename: (presetId, name) => action("rename-preset", { presetId, name }),
    remove: (presetId) => action("delete-preset", { presetId }),
    reorder: (presetIds) => action("reorder-preset", { presetIds }),
  };
  const loudnessProfileController = {
    active: payload.loudnessProfile?.active ?? LOUDNESS_PROFILE_OFF,
    document: null,
    profiles: payload.loudnessProfile?.profiles ?? [],
    draftBlocksLibraryActions: payload.loudnessProfile?.draftBlocksLibraryActions === true,
    select: (selection) => action("select-loudness-profile", { selection }),
    selectOff: () => action("select-loudness-profile", { selection: LOUDNESS_PROFILE_OFF }),
    reorderProfiles: (profileIds) => action("reorder-loudness-profiles", { profileIds }),
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
      data-visual-capture-surface="dockEditor"
      data-visual-capture-ready="true"
      className={cn(
        "inline-block max-h-screen overflow-hidden",
        // Against the strip's side of the window: the transparent room for select menus is on the
        // far side.
        payload.edge === "bottom" && "fixed bottom-0 left-0",
        POPOVER_SURFACE_CLASS,
        payload.view?.startsWith("module:") && "p-1",
        // Presets owns a minimum width that follows Interface Size; the other library menus grow
        // to fit their rows up to the shared 18rem cap. No cap here is viewport-relative: this
        // window is resized to what is measured, so a `vw` cap would feed back into itself.
        payload.view === "presets"
          ? "w-max min-w-40 max-w-[400px]"
          : payload.view === "loudness-profile" || payload.view === "modules"
            ? "w-max min-w-40 max-w-[18rem]"
            : "w-max min-w-48 max-w-[400px]"
      )}
    >
      {payload.view === "status" ? (
        <DockEditorShell title="Status">
          <AppStatusList
            accessory
            showTitle={false}
            items={payload.statusItems ?? []}
            onAction={(value) => action("status-action", { action: value })}
          />
        </DockEditorShell>
      ) : payload.view === "modules" ? (
        <DockModulesEditor
          panels={payload.panels}
          vectorscopeSettingsAvailable={payload.vectorscopeSettingsAvailable}
          isDefault={payload.isDefault}
          onAdd={(moduleId) => action("add-module", { moduleId })}
          onRename={(panelId, name) => action("rename-module", { panelId, name })}
          onRemove={(panelId) => action("remove-module", { panelId })}
          onReorder={(panelOrder) => action("reorder-module", { panelOrder })}
          onReset={() => action("reset-modules")}
          onHover={onHoverModule}
          onOpenSettings={(panelId) => action("open-module-settings", { panelId })}
        />
      ) : payload.view === "presets" ? (
        <DockPresetsRow presets={presetController} />
      ) : payload.view === "loudness-profile" ? (
        <DockLoudnessProfileRow profile={loudnessProfileController} />
      ) : payload.view === "views" ? (
        <DockViews state={payload} onAction={action} />
      ) : payload.view === "device" ? (
        <DockEditorShell title="Device">
          <DeviceSelectionContent
            {...payload.device}
            onSelect={(deviceId) => action("select-device", { deviceId })}
          />
        </DockEditorShell>
      ) : panel ? (
        // LoudnessSettingsRows (inside DockModuleSettings for the loudness module) calls
        // useLoudnessProfile(), which throws outside a provider. This accessory boots its own React
        // root (see main.jsx), so it never inherits App's provider and needs its own instance --
        // backed by the same persisted settingsStore, so it stays in sync with the main window.
        // It never seeds a cold library: that write belongs to the main window.
        <LoudnessProfileProvider seedColdStart={false}>
          <DockModuleSettings
            moduleId={panel.moduleId}
            title={resolvePanelDisplayName(
              { panelsById: payload.panelsById, panelOrder: payload.panelOrder },
              panel.id
            )}
            controls={payload.controlsByPanelId?.[panel.id]}
            sharedFrequencyViewport={payload.sharedFrequencyViewport}
            onSharedFrequencyChange={(viewport) =>
              action("update-frequency-viewport", { panelId: panel.id, viewport })
            }
            sharedTimeViewport={payload.sharedTimeViewport}
            onSharedTimeChange={(viewport) =>
              action("update-time-viewport", { panelId: panel.id, viewport })
            }
            vectorscopeOptions={payload.vectorscopeOptions}
            spectrumOptions={payload.spectrumOptions}
            channelCount={payload.channelCount}
            onChange={(controls) =>
              action("update-module-controls", { panelId: panel.id, controls })
            }
            onReset={() => action("reset-module-controls", { panelId: panel.id })}
            onBack={() => action("open-editor", { view: "modules" })}
          />
        </LoudnessProfileProvider>
      ) : null}
    </div>
  );
}
