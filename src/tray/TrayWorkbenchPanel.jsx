import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { MenuRow } from "../components/ui/row.jsx";
import { PresetOptionContent } from "../components/PresetOptionContent.jsx";
import { SourceGroupHeading, SourceOptionContent } from "../components/SourceOptionContent.jsx";
import { POPOVER_SURFACE_CLASS } from "../components/ui/surfaceStyles.js";
import { installKeyboardNavigationTracking } from "../lib/keyboardNavigation.js";
import { cn } from "../lib/utils.js";
import { applyResolvedThemeToDocument, isThemePublication } from "../theme/themeRuntime.js";
import {
  applyLayoutToDocument,
  resolveInterfacePreferencesForSurface,
  UI_PREFERENCES,
} from "../uiPreferences.js";
import "../index.css";
import {
  TRAY_WORKBENCH_ACTION,
  TRAY_WORKBENCH_NOTICE,
  TRAY_WORKBENCH_PROBE,
  TRAY_WORKBENCH_STATE,
} from "./trayWorkbenchProtocol.js";

/** @typedef {import("./trayWorkbenchProtocol.js").TrayPanelItem} TrayPanelItem */
/** @typedef {{ left: number, top: number, width: number, height: number }} Bounds */
/** @typedef {{ main: Bounds, side: Bounds | null, clipRevision?: number | null, viewport?: { width: number, height: number } }} PanelLayout */

const SURFACE = cn(POPOVER_SURFACE_CLASS, "absolute overflow-x-hidden");
const ROW = "disabled:pointer-events-none disabled:text-muted-foreground";
const CHEVRON = "size-[1em] shrink-0 text-muted-foreground";
const PICKER_HEIGHT_LIMIT = "max-h-[calc(9*var(--ui-row-h)+10px)]";
const PRESET_MEASUREMENT_WIDTH =
  "w-max min-w-[12em] max-w-[var(--ui-surface-compact-w)] text-[length:var(--ui-fs-control)]";
const PICKER_OPEN_DELAY_MS = 200;
const PICKER_CLOSE_DELAY_MS = 350;
const initialBounds = { left: 0, top: 0, width: "var(--ui-surface-compact-w)", height: "100dvh" };

/** @param {{ item: TrayPanelItem, preset?: boolean, onAction: (item: TrayPanelItem) => void }} props */
function ChoiceRow({ item, preset, onAction }) {
  const choice = item.kind === "check";
  const selected = Boolean(item.checked);
  const primary = item.display?.primary ?? item.text;
  return (
    <MenuRow
      className={cn(ROW, choice && "disabled:opacity-50")}
      aria-pressed={choice ? selected : undefined}
      aria-label={item.display?.secondary || item.display?.modified ? item.text : undefined}
      disabled={item.enabled === false}
      onClick={() => onAction(item)}
    >
      {choice ? (
        preset ? (
          <PresetOptionContent
            name={primary}
            selected={selected}
            modified={item.display?.modified}
          />
        ) : (
          <SourceOptionContent
            primary={primary}
            secondary={item.display?.secondary}
            selected={selected}
          />
        )
      ) : (
        <span className="truncate">{item.text}</span>
      )}
    </MenuRow>
  );
}

/** @param {{ item: TrayPanelItem, open: boolean, toggle: (key: string) => void, onAction: (item: TrayPanelItem) => void }} props */
function SourceGroup({ item, open, toggle, onAction }) {
  const id = useId();
  const choices = item.items ?? [];
  const selected = choices.find((choice) => choice.checked);
  return (
    <>
      <MenuRow
        className={ROW}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => toggle(item.key)}
      >
        <SourceGroupHeading
          label={item.text}
          count={choices.length}
          open={open}
          selectedSummary={selected?.display?.primary ?? selected?.text}
        />
      </MenuRow>
      <ul id={id} hidden={!open}>
        {open &&
          choices.map((choice) => (
            <li key={choice.key}>
              <ChoiceRow item={choice} onAction={onAction} />
            </li>
          ))}
      </ul>
    </>
  );
}

/**
 * @param {{
 *   items: TrayPanelItem[],
 *   branchKey?: string,
 *   pickerKey?: string,
 *   groupKeys?: string[],
 *   presetChoices?: boolean,
 *   onToggleGroup?: (key: string) => void,
 *   onToggleBranch?: (key: string) => void,
 *   onOpenPicker?: (key: string, byKeyboard: boolean) => void,
 *   onHoverPicker?: (event: React.PointerEvent<HTMLElement>, key?: string) => void,
 *   onAction: (item: TrayPanelItem) => void,
 * }} props
 */
function TrayRows({
  items,
  branchKey,
  pickerKey,
  groupKeys,
  presetChoices,
  onToggleGroup,
  onToggleBranch,
  onOpenPicker,
  onHoverPicker,
  onAction,
}) {
  const listId = useId();
  return (
    <ul>
      {items.map((item, index) => {
        if (item.kind === "separator") {
          return <li key={item.key} aria-hidden="true" className="my-1 border-t border-border" />;
        }
        if (item.kind === "group") {
          return (
            <li key={item.key}>
              <SourceGroup
                item={item}
                open={groupKeys?.includes(item.key) ?? false}
                toggle={onToggleGroup}
                onAction={onAction}
              />
            </li>
          );
        }
        if (item.kind !== "submenu") {
          return (
            <li key={item.key}>
              <ChoiceRow item={item} preset={presetChoices} onAction={onAction} />
            </li>
          );
        }
        const picker = Boolean(item.pageTitle);
        const expanded = item.key === (picker ? pickerKey : branchKey);
        const DisclosureIcon = picker ? ChevronRight : expanded ? ChevronUp : ChevronDown;
        const id = `${listId}-${index}`;
        return (
          <li key={item.key}>
            <MenuRow
              className={cn(ROW, (!picker || expanded) && "font-medium")}
              data-tray-menu-key={item.key}
              aria-controls={picker ? (expanded ? "tray-workbench-picker" : undefined) : id}
              aria-expanded={expanded}
              disabled={item.enabled === false}
              onPointerEnter={picker ? (event) => onHoverPicker?.(event, item.key) : undefined}
              onPointerLeave={picker ? (event) => onHoverPicker?.(event) : undefined}
              onClick={(event) => {
                if (picker) onOpenPicker?.(item.key, event.detail === 0);
                else onToggleBranch?.(item.key);
              }}
            >
              <span className="truncate">{item.pageTitle ?? item.text}</span>
              <DisclosureIcon
                aria-hidden="true"
                className={cn(CHEVRON, "ml-auto", expanded && "text-foreground")}
              />
            </MenuRow>
            {!picker && (
              <div
                id={id}
                hidden={!expanded}
                className={cn(
                  "mt-1",
                  items[index + 1]?.kind === "submenu" && "mb-1 border-b border-border pb-1"
                )}
              >
                {expanded && (
                  <TrayRows
                    items={item.items ?? []}
                    pickerKey={pickerKey}
                    onOpenPicker={onOpenPicker}
                    onHoverPicker={onHoverPicker}
                    onAction={onAction}
                  />
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** @param {HTMLElement | null} root @param {string} key */
function findMenuTrigger(root, key) {
  return Array.from(root?.querySelectorAll("button") ?? []).find(
    (button) => button.getAttribute("data-tray-menu-key") === key
  );
}

/** @param {HTMLElement | null} surface */
function focusFirstPickerChoice(surface) {
  /** @type {HTMLButtonElement | null | undefined} */ (
    surface?.querySelector("button:enabled")
  )?.focus();
}

/** @param {PanelLayout} layout */
function trayCaptureRect({ main, side }) {
  if (!side) return { x: main.left, y: main.top, width: main.width, height: main.height };
  const x = Math.min(main.left, side.left);
  const y = Math.min(main.top, side.top);
  return {
    x,
    y,
    width: Math.max(main.left + main.width, side.left + side.width) - x,
    height: Math.max(main.top + main.height, side.top + side.height) - y,
  };
}

export function TrayWorkbenchPanel() {
  const [snapshot, setSnapshot] = useState({
    items: /** @type {TrayPanelItem[]} */ ([]),
    interfaceSize: "default",
    presentation: 0,
  });
  const [navigation, setNavigation] = useState(
    /** @type {import("./trayWorkbenchProtocol.js").TrayNavigation} */ ({})
  );
  const [notice, setNotice] = useState("");
  const [placement, setPlacement] = useState(
    /** @type {{ layout: PanelLayout, pickerScrolls: boolean, presentation: number, branchKey?: string, pickerKey?: string, groupKeys?: string[] } | null} */ (
      null
    )
  );
  const mainRef = useRef(/** @type {HTMLElement | null} */ (null));
  const contentsRef = useRef(null);
  const pickerRef = useRef(/** @type {HTMLElement | null} */ (null));
  const pickerContentsRef = useRef(null);
  const pickerMeasurementRef = useRef(null);
  const focusPicker = useRef(false);
  const pickerHoverTimer = useRef(0);
  const lastLayout = useRef("");
  const pendingLayout = useRef(Promise.resolve());
  const presented = useRef(0);
  const receivedPresentation = useRef(0);
  const appliedInterfaceSize = useRef(null);
  const appliedThemeRevision = useRef(null);
  const expanded = snapshot.items.find((item) => item.key === navigation.branchKey);
  const rows = expanded?.items ?? snapshot.items;
  const picker = rows.find((item) => item.key === navigation.pickerKey && item.pageTitle);
  const branchKey = expanded?.key;
  const pickerKey = picker?.key;
  const groupKeys = picker ? navigation.groupKeys : undefined;
  const sideBounds = picker && placement?.branchKey === branchKey ? placement?.layout.side : null;
  const shownPicker = sideBounds
    ? rows.find((item) => item.key === placement?.pickerKey && item.pageTitle)
    : undefined;
  const shownPickerKey = shownPicker?.key;
  const sizePreset = picker?.pageTitle === "Preset";
  const needsMeasurement = Boolean(
    picker && (sizePreset || shownPickerKey !== pickerKey || placement?.groupKeys !== groupKeys)
  );
  const layoutReady =
    placement?.presentation === snapshot.presentation &&
    placement.branchKey === branchKey &&
    placement.pickerKey === pickerKey &&
    placement.groupKeys === groupKeys;

  const cancelPickerHover = useCallback(() => window.clearTimeout(pickerHoverTimer.current), []);

  useEffect(() => {
    const announceReady = () => emitTo("main", TRAY_WORKBENCH_ACTION, { kind: "ready" });
    const listeners = Promise.all([
      listen(TRAY_WORKBENCH_STATE, ({ payload }) => {
        const { theme, interfaceSize, items, presentation, navigation } = payload;
        const revision = theme && `${theme.id}:${theme.revision}`;
        if (isThemePublication(theme) && revision !== appliedThemeRevision.current) {
          applyResolvedThemeToDocument(theme);
          appliedThemeRevision.current = revision;
        }
        if (interfaceSize !== appliedInterfaceSize.current) {
          applyLayoutToDocument(
            resolveInterfacePreferencesForSurface(UI_PREFERENCES, interfaceSize, null)
          );
          appliedInterfaceSize.current = interfaceSize;
        }
        if (presentation !== receivedPresentation.current) {
          receivedPresentation.current = presentation;
          cancelPickerHover();
          focusPicker.current = false;
          setNavigation(navigation ?? {});
          setNotice("");
        }
        setSnapshot({ items, interfaceSize, presentation });
      }),
      listen(TRAY_WORKBENCH_NOTICE, ({ payload }) => setNotice(String(payload))),
      listen(TRAY_WORKBENCH_PROBE, () => void announceReady()),
    ]);
    void listeners.then(announceReady);
    return () => {
      cancelPickerHover();
      void listeners.then((unlisten) => unlisten.forEach((stop) => stop()));
    };
  }, [cancelPickerHover]);

  useEffect(() => {
    function onKeyDown(event) {
      cancelPickerHover();
      if (event.key !== "Escape" || event.repeat) return;
      focusPicker.current = false;
      if (pickerKey) {
        setNavigation({ branchKey });
        findMenuTrigger(mainRef.current, pickerKey)?.focus({ preventScroll: true });
      } else if (branchKey) {
        setNavigation({});
        findMenuTrigger(mainRef.current, branchKey)?.focus({ preventScroll: true });
      } else {
        void getCurrentWindow().hide();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", cancelPickerHover);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", cancelPickerHover);
    };
  }, [branchKey, pickerKey, cancelPickerHover]);

  useLayoutEffect(() => {
    if (pickerRef.current) pickerRef.current.scrollTop = 0;
  }, [shownPickerKey]);

  useLayoutEffect(() => {
    if (!sideBounds || shownPickerKey !== pickerKey || !focusPicker.current) return;
    focusPicker.current = false;
    focusFirstPickerChoice(pickerRef.current);
  }, [sideBounds, shownPickerKey, pickerKey]);

  useLayoutEffect(() => {
    if (!layoutReady || placement.presentation <= presented.current) return;
    // Show after the first layout has been applied to the DOM inside the native window.
    presented.current = placement.presentation;
    void invoke("show_tray_workbench_panel").catch((error) => setNotice(String(error)));
  }, [placement, layoutReady]);

  useLayoutEffect(() => {
    const main = mainRef.current;
    const contents = contentsRef.current;
    const pickerContents = pickerMeasurementRef.current ?? pickerContentsRef.current;
    const pickerSurface = pickerContents?.parentElement;
    const trigger = pickerKey ? findMenuTrigger(main, pickerKey) : null;
    if (!main || !contents || !snapshot.presentation) return;
    let frame;
    function applyLayout() {
      const styles = getComputedStyle(main);
      const width = parseFloat(styles.getPropertyValue("--ui-surface-compact-w"));
      const height = Math.ceil(contents.getBoundingClientRect().height) + 2;
      const pickerContentHeight = pickerContents
        ? pickerContents.getBoundingClientRect().height + 2
        : 0;
      const pickerHeightLimit = pickerSurface
        ? parseFloat(getComputedStyle(pickerSurface).maxHeight) || Infinity
        : Infinity;
      const side =
        pickerSurface && pickerContents && trigger
          ? {
              width: sizePreset ? pickerSurface.getBoundingClientRect().width : undefined,
              height: Math.min(Math.ceil(pickerContentHeight), pickerHeightLimit),
              triggerTop: Math.max(
                0,
                Math.round(
                  trigger.getBoundingClientRect().top - main.getBoundingClientRect().top - 5
                )
              ),
            }
          : null;
      const webviewScale = window.devicePixelRatio;
      const key = JSON.stringify([
        width,
        height,
        side,
        pickerContentHeight,
        webviewScale,
        snapshot.presentation,
        branchKey,
        pickerKey,
        groupKeys,
      ]);
      if (key === lastLayout.current) return;
      lastLayout.current = key;
      pendingLayout.current = pendingLayout.current.then(async () => {
        if (key !== lastLayout.current) return;
        try {
          const layout = /** @type {PanelLayout} */ (
            await invoke("layout_tray_workbench_panel", { width, height, side, webviewScale })
          );
          if (layout && key === lastLayout.current) {
            setPlacement({
              layout,
              // Scroll only when the settled layout needs it. The WebView can still report the
              // previous client height when the rows and new bounds are committed together.
              pickerScrolls: Boolean(
                layout.side &&
                pickerContentHeight - Math.min(layout.side.height, pickerHeightLimit) >
                  1 / webviewScale
              ),
              presentation: snapshot.presentation,
              branchKey,
              pickerKey,
              groupKeys,
            });
          }
        } catch (error) {
          setNotice(String(error));
        }
      });
    }
    function scheduleLayout() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(applyLayout);
    }
    const observer = new ResizeObserver(scheduleLayout);
    observer.observe(contents);
    if (pickerContents) observer.observe(pickerContents);
    if (sizePreset && pickerSurface) observer.observe(pickerSurface);
    main.addEventListener("scroll", scheduleLayout);
    window.addEventListener("resize", scheduleLayout);
    applyLayout();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      main.removeEventListener("scroll", scheduleLayout);
      window.removeEventListener("resize", scheduleLayout);
    };
  }, [
    snapshot.presentation,
    snapshot.interfaceSize,
    branchKey,
    pickerKey,
    groupKeys,
    needsMeasurement,
    sizePreset,
  ]);

  useEffect(() => {
    if (!layoutReady || (placement.pickerKey && !placement.layout.side)) return;
    let active = true;
    async function reportLayout() {
      const { layout, presentation, branchKey, pickerKey, groupKeys } = placement;
      try {
        if (layout.clipRevision != null) {
          await invoke("commit_tray_workbench_clip", { revision: layout.clipRevision });
        }
        if (!active) return;
        await emitTo("main", TRAY_WORKBENCH_ACTION, {
          kind: "rendered",
          presentation,
          navigation: { branchKey, pickerKey, groupKeys },
          rect: trayCaptureRect(layout),
          viewport: layout.viewport ?? { width: window.innerWidth, height: window.innerHeight },
          devicePixelRatio: window.devicePixelRatio,
        });
      } catch (error) {
        if (active) setNotice(String(error));
      }
    }
    // Report the rendered WebView client after its native placement and React commit.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        void reportLayout();
      });
    });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
    };
  }, [placement, layoutReady]);

  /** @param {string} key @param {boolean} byKeyboard */
  function openPicker(key, byKeyboard) {
    cancelPickerHover();
    if (key === pickerKey) {
      if (byKeyboard) {
        if (shownPickerKey === key) focusFirstPickerChoice(pickerRef.current);
        else focusPicker.current = true;
      }
      return;
    }
    focusPicker.current = byKeyboard;
    setNotice("");
    setNavigation({ branchKey, pickerKey: key });
  }

  /** @param {React.PointerEvent<HTMLElement>} event @param {string} [key] */
  function hoverPicker(event, key) {
    if (event.pointerType !== "mouse") return;
    cancelPickerHover();
    if (key) {
      if (key === pickerKey || event.buttons) return;
      const trigger = event.currentTarget;
      pickerHoverTimer.current = window.setTimeout(() => {
        if (trigger.isConnected && !trigger.matches(":disabled")) openPicker(key, false);
      }, PICKER_OPEN_DELAY_MS);
    } else if (pickerKey) {
      // The pointer can cross the gap or briefly pass over another row on its way to the picker.
      pickerHoverTimer.current = window.setTimeout(() => {
        focusPicker.current = false;
        if (pickerRef.current?.contains(document.activeElement)) {
          findMenuTrigger(mainRef.current, pickerKey)?.focus({ preventScroll: true });
        }
        setNavigation({ branchKey });
      }, PICKER_CLOSE_DELAY_MS);
    }
  }

  /** @param {TrayPanelItem} item */
  async function request({ key, dismiss }) {
    setNotice("");
    try {
      if (dismiss) {
        cancelPickerHover();
        await getCurrentWindow().hide();
      }
      await emitTo("main", TRAY_WORKBENCH_ACTION, { kind: "activate", key });
    } catch (error) {
      setNotice(String(error));
    }
  }

  return (
    <main className="relative h-dvh select-none overflow-hidden">
      <nav
        ref={mainRef}
        className={cn(SURFACE, "overflow-y-auto")}
        style={placement?.layout.main ?? initialBounds}
        aria-label="PLVS tray"
      >
        <div ref={contentsRef} className="p-1">
          <TrayRows
            items={snapshot.items}
            branchKey={branchKey}
            pickerKey={shownPickerKey}
            onToggleBranch={(key) => {
              cancelPickerHover();
              focusPicker.current = false;
              setNotice("");
              setNavigation(key === branchKey ? {} : { branchKey: key });
            }}
            onOpenPicker={openPicker}
            onHoverPicker={hoverPicker}
            onAction={request}
          />
          {notice && (
            <p
              role="status"
              className="break-words px-2 py-1 text-[length:var(--ui-fs-status)] text-muted-foreground"
            >
              {notice}
            </p>
          )}
        </div>
      </nav>
      {shownPicker && sideBounds && (
        <section
          id="tray-workbench-picker"
          ref={pickerRef}
          aria-label={shownPicker.pageTitle}
          className={cn(
            SURFACE,
            PICKER_HEIGHT_LIMIT,
            placement?.pickerScrolls ? "overflow-y-auto" : "overflow-y-hidden"
          )}
          style={sideBounds}
          onPointerEnter={cancelPickerHover}
          onPointerLeave={hoverPicker}
        >
          <div ref={pickerContentsRef} className="p-1">
            <TrayRows
              items={shownPicker.items ?? []}
              groupKeys={placement?.groupKeys}
              presetChoices={shownPicker.pageTitle === "Preset"}
              onToggleGroup={(key) =>
                setNavigation((current) => {
                  if (current.pickerKey !== shownPickerKey) return current;
                  const groups = current.groupKeys ?? [];
                  return {
                    ...current,
                    groupKeys: groups.includes(key)
                      ? groups.filter((group) => group !== key)
                      : [...groups, key],
                  };
                })
              }
              onAction={request}
            />
          </div>
        </section>
      )}
      {picker && needsMeasurement && (
        <div
          inert
          aria-hidden="true"
          className={cn(
            SURFACE,
            PICKER_HEIGHT_LIMIT,
            "invisible overflow-y-hidden",
            sizePreset ? PRESET_MEASUREMENT_WIDTH : "w-[var(--ui-surface-compact-w)]"
          )}
        >
          <div ref={pickerMeasurementRef} className="p-1">
            <TrayRows
              items={picker.items ?? []}
              groupKeys={groupKeys}
              presetChoices={sizePreset}
              onAction={request}
            />
          </div>
        </div>
      )}
    </main>
  );
}

const root = document.getElementById("root");
if (root) {
  installKeyboardNavigationTracking();
  createRoot(root).render(<TrayWorkbenchPanel />);
}
