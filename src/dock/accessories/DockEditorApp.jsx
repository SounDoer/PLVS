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
import { SettingsMenuRoomContext } from "../../components/panel-settings/SettingsWidgets.jsx";

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
// How long to wait for the native window to report its new size before opening the menu anyway.
const SELECT_MENU_ROOM_TIMEOUT_MS = 250;

/**
 * Extra window height that lets a settings select open its menu whole from `trigger`. This window
 * is only as large as the editor and a floating menu is confined to the window, so without it a
 * menu is squeezed down to its scroll buttons. The room is always for the tallest menu: the real
 * height is unknown until the menu is up, when resizing would close it, and the window is
 * transparent, so spare room shows nothing. The window grows away from the Dock strip, below the
 * editor on a top Dock and above it on a bottom Dock.
 *
 * @param {HTMLElement} root
 * @param {HTMLElement} trigger
 * @param {string} [edge]
 */
export function measureSelectMenuRoom(root, trigger, edge) {
  const remPx = Number.parseFloat(getComputedStyle(root.ownerDocument.documentElement).fontSize);
  const needed = SELECT_MENU_MAX_HEIGHT_REM * (remPx || 16) + SELECT_MENU_MARGIN_PX;
  const rootRect = root.getBoundingClientRect();
  const triggerRect = trigger.getBoundingClientRect();
  const available =
    edge === "bottom" ? triggerRect.top - rootRect.top : rootRect.bottom - triggerRect.bottom;
  return Math.max(0, Math.ceil(needed - available));
}

export function DockEditorApp() {
  const { payload, action } = useAccessoryClient("dock-editor");
  const rootRef = useRef(null);
  const pointerActiveRef = useRef(false);
  const lastSizeRef = useRef(null);
  // The select trigger whose menu the window currently holds room for, and whether that menu has
  // yet to appear.
  const menuRoomRef = useRef({ trigger: null, pending: false });
  const measureRef = useRef(/** @type {() => boolean} */ (() => false));
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
      if (!content) return false;
      const menuRoom = menuRoomRef.current;
      if (root.ownerDocument.querySelector("[data-settings-select-menu]")) {
        menuRoom.pending = false;
      } else if (!menuRoom.pending || !menuRoom.trigger?.isConnected) {
        menuRoom.trigger = null;
        menuRoom.pending = false;
      }
      const next = {
        width: content.width,
        height:
          content.height +
          (menuRoom.trigger ? measureSelectMenuRoom(root, menuRoom.trigger, payload.edge) : 0),
      };
      if (
        lastSizeRef.current?.view === payload.view &&
        lastSizeRef.current?.width === next.width &&
        lastSizeRef.current?.height === next.height
      ) {
        return false;
      }
      lastSizeRef.current = { ...next, view: payload.view };
      action("resize-editor", { ...next, view: payload.view });
      return true;
    };
    measureRef.current = measureNow;
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
    // The whole body, not only the editor: a select menu is portalled beside it.
    mutationObserver.observe(root.ownerDocument.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      measureRef.current = () => false;
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
    };
  }, [action, payload?.view, payload?.edge]);

  const reserveMenuRoom = useCallback(
    (trigger) =>
      new Promise((resolve) => {
        if (!trigger) {
          resolve();
          return;
        }
        menuRoomRef.current = { trigger, pending: true };
        let settled = false;
        const open = () => {
          window.removeEventListener("pointerup", open, true);
          window.removeEventListener("pointercancel", open, true);
          resolve();
          // Release the room if the menu never came up after all.
          setTimeout(() => {
            menuRoomRef.current.pending = false;
            measureRef.current();
          }, SELECT_MENU_ROOM_TIMEOUT_MS * 2);
        };
        const settle = () => {
          if (settled) return;
          settled = true;
          window.removeEventListener("resize", settle);
          clearTimeout(timer);
          // Growing above the editor moves the page origin under a pointer that is still down.
          // The select would read that as a drag ending outside its menu and close again, so the
          // menu waits for the press that asked for it to end.
          if (pointerActiveRef.current) {
            window.addEventListener("pointerup", open, true);
            window.addEventListener("pointercancel", open, true);
          } else {
            open();
          }
        };
        window.addEventListener("resize", settle);
        const timer = setTimeout(settle, SELECT_MENU_ROOM_TIMEOUT_MS);
        if (!measureRef.current()) settle();
      }),
    []
  );

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
        // Against the strip's side of the window, so the editor stays put while the window grows
        // away from the strip for an open select menu.
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
      {payload.view === "modules" ? (
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
      ) : panel ? (
        // LoudnessSettingsRows (inside DockModuleSettings for the loudness module) calls
        // useLoudnessProfile(), which throws outside a provider. This accessory boots its own React
        // root (see main.jsx), so it never inherits App's provider and needs its own instance --
        // backed by the same persisted settingsStore, so it stays in sync with the main window.
        // It never seeds a cold library: that write belongs to the main window.
        <LoudnessProfileProvider seedColdStart={false}>
          <SettingsMenuRoomContext.Provider value={reserveMenuRoom}>
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
              onChange={(controls) =>
                action("update-module-controls", { panelId: panel.id, controls })
              }
              onReset={() => action("reset-module-controls", { panelId: panel.id })}
              onBack={() => action("open-editor", { view: "modules" })}
            />
          </SettingsMenuRoomContext.Provider>
        </LoudnessProfileProvider>
      ) : null}
    </div>
  );
}
