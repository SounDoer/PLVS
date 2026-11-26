import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronRight } from "lucide-react";
import { MenuRow } from "../components/ui/row.jsx";
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
/** @typedef {{ main: Bounds, side: Bounds | null }} PanelLayout */

const SURFACE = cn(POPOVER_SURFACE_CLASS, "absolute overflow-x-hidden overflow-y-auto");
const ROW = "focus:bg-ui-hover disabled:pointer-events-none disabled:text-muted-foreground";
const initialBounds = { left: 0, top: 0, width: "var(--ui-surface-compact-w)", height: "100dvh" };

/** @param {{ open?: boolean, className?: string }} props */
function Disclosure({ open, className }) {
  return (
    <ChevronRight
      aria-hidden="true"
      className={cn("size-[1em] shrink-0 text-muted-foreground", open && "rotate-90", className)}
    />
  );
}

/** @param {{ item: TrayPanelItem, onAction: (item: TrayPanelItem) => void }} props */
function ChoiceRow({ item, onAction }) {
  return (
    <MenuRow
      className={cn(ROW, item.checked && "bg-ui-hover font-medium")}
      aria-pressed={item.kind === "check" ? Boolean(item.checked) : undefined}
      disabled={item.enabled === false}
      onClick={() => onAction(item)}
    >
      <span className="truncate" title={item.text}>
        {item.text}
      </span>
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
        <Disclosure open={open} />
        <span className="shrink-0 font-medium text-muted-foreground">{item.text}</span>
        {!open && selected && (
          <span className="min-w-0 truncate" title={selected.text}>
            {selected.text}
            <span className="sr-only">, selected</span>
          </span>
        )}
        <span className="ml-auto text-[length:var(--ui-fs-caption)] tabular-nums text-muted-foreground">
          {choices.length}
        </span>
      </MenuRow>
      <ul id={id} hidden={!open} className="pl-4">
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
 *   onToggleGroup?: (key: string) => void,
 *   onToggleBranch?: (item: TrayPanelItem, trigger: HTMLButtonElement) => void,
 *   onTogglePicker?: (item: TrayPanelItem, trigger: HTMLButtonElement, byKeyboard: boolean) => void,
 *   onAction: (item: TrayPanelItem) => void,
 * }} props
 */
function TrayRows({
  items,
  branchKey,
  pickerKey,
  groupKeys,
  onToggleGroup,
  onToggleBranch,
  onTogglePicker,
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
              <ChoiceRow item={item} onAction={onAction} />
            </li>
          );
        }
        const picker = Boolean(item.pageTitle);
        const expanded = item.key === (picker ? pickerKey : branchKey);
        const id = `${listId}-${index}`;
        return (
          <li key={item.key}>
            <MenuRow
              className={cn(ROW, (!picker || expanded) && "font-medium", expanded && "bg-ui-hover")}
              data-tray-menu-key={item.key}
              aria-controls={picker ? (expanded ? "tray-workbench-picker" : undefined) : id}
              aria-expanded={expanded}
              disabled={item.enabled === false}
              onClick={(event) => {
                if (picker) onTogglePicker?.(item, event.currentTarget, event.detail === 0);
                else onToggleBranch?.(item, event.currentTarget);
              }}
            >
              <span className="truncate" title={item.text}>
                {item.pageTitle ?? item.text}
              </span>
              <Disclosure open={!picker && expanded} className="ml-auto" />
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
                    onTogglePicker={onTogglePicker}
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
    /** @type {{ layout: PanelLayout, presentation: number, branchKey?: string, pickerKey?: string, groupKeys?: string[] } | null} */ (
      null
    )
  );
  const mainRef = useRef(/** @type {HTMLElement | null} */ (null));
  const contentsRef = useRef(null);
  const pickerRef = useRef(/** @type {HTMLElement | null} */ (null));
  const pickerContentsRef = useRef(null);
  const focusPicker = useRef(false);
  const lastLayout = useRef("");
  const pendingLayout = useRef(Promise.resolve());
  const presented = useRef(0);
  const receivedPresentation = useRef(0);
  const appliedInterfaceSize = useRef(null);
  const appliedThemeRevision = useRef(null);
  const expanded = snapshot.items.find((item) => item.key === navigation.branchKey);
  const picker = (expanded?.items ?? snapshot.items).find(
    (item) => item.key === navigation.pickerKey && item.pageTitle
  );
  const branchKey = expanded?.key;
  const pickerKey = picker?.key;
  const groupKeys = picker ? navigation.groupKeys : undefined;
  const sideBounds = placement?.pickerKey === pickerKey ? placement?.layout.side : null;

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
      void listeners.then((unlisten) => unlisten.forEach((stop) => stop()));
    };
  }, []);

  useEffect(() => {
    function onEscape(event) {
      if (event.key !== "Escape" || event.repeat) return;
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
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [branchKey, pickerKey]);

  useLayoutEffect(() => {
    if (!sideBounds || !focusPicker.current) return;
    focusPicker.current = false;
    /** @type {HTMLButtonElement | null | undefined} */ (
      pickerRef.current?.querySelector("button:enabled")
    )?.focus();
  }, [sideBounds]);

  useLayoutEffect(() => {
    const main = mainRef.current;
    const contents = contentsRef.current;
    const pickerSurface = pickerRef.current;
    const pickerContents = pickerContentsRef.current;
    const trigger = pickerKey ? findMenuTrigger(main, pickerKey) : null;
    if (!main || !contents || !snapshot.presentation) return;
    let frame;
    function applyLayout() {
      const styles = getComputedStyle(main);
      const width = parseFloat(styles.getPropertyValue("--ui-surface-compact-w"));
      const height = Math.ceil(contents.getBoundingClientRect().height) + 2;
      const side =
        pickerSurface && pickerContents && trigger
          ? {
              height: Math.min(
                Math.ceil(pickerContents.getBoundingClientRect().height) + 2,
                parseFloat(getComputedStyle(pickerSurface).maxHeight) || Infinity
              ),
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
        const show = snapshot.presentation > presented.current;
        try {
          const layout = /** @type {PanelLayout} */ (
            await invoke("layout_tray_workbench_panel", { width, height, side, webviewScale, show })
          );
          if (show) presented.current = snapshot.presentation;
          if (layout && key === lastLayout.current) {
            setPlacement({
              layout,
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
    main.addEventListener("scroll", scheduleLayout);
    window.addEventListener("resize", scheduleLayout);
    applyLayout();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      main.removeEventListener("scroll", scheduleLayout);
      window.removeEventListener("resize", scheduleLayout);
    };
  }, [snapshot.presentation, snapshot.interfaceSize, branchKey, pickerKey, groupKeys]);

  useEffect(() => {
    if (
      !placement ||
      placement.presentation !== snapshot.presentation ||
      placement.branchKey !== branchKey ||
      placement.pickerKey !== pickerKey ||
      (pickerKey && !placement.layout.side) ||
      placement.groupKeys !== groupKeys
    )
      return;
    // Report the rendered WebView client after its native placement and React commit.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        void emitTo("main", TRAY_WORKBENCH_ACTION, {
          kind: "rendered",
          presentation: placement.presentation,
          navigation: { branchKey, pickerKey, groupKeys },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          devicePixelRatio: window.devicePixelRatio,
        });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [placement, snapshot.presentation, branchKey, pickerKey, groupKeys]);

  /** @param {TrayPanelItem} item */
  async function request({ key, dismiss }) {
    setNotice("");
    try {
      if (dismiss) await getCurrentWindow().hide();
      await emitTo("main", TRAY_WORKBENCH_ACTION, { kind: "activate", key });
    } catch (error) {
      setNotice(String(error));
    }
  }

  return (
    <main className="relative h-dvh overflow-hidden">
      <nav
        ref={mainRef}
        className={SURFACE}
        style={placement?.layout.main ?? initialBounds}
        aria-label="PLVS tray"
      >
        <div ref={contentsRef} className="p-1">
          <TrayRows
            items={snapshot.items}
            branchKey={branchKey}
            pickerKey={pickerKey}
            onToggleBranch={(item) => {
              setNotice("");
              setNavigation(item.key === branchKey ? {} : { branchKey: item.key });
            }}
            onTogglePicker={(item, _trigger, byKeyboard) => {
              focusPicker.current = byKeyboard && item.key !== pickerKey;
              setNotice("");
              setNavigation({
                branchKey,
                pickerKey: item.key === pickerKey ? undefined : item.key,
              });
            }}
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
      {picker && (
        <section
          key={picker.key}
          id="tray-workbench-picker"
          ref={pickerRef}
          aria-label={picker.pageTitle}
          className={cn(SURFACE, "max-h-[calc(9*var(--ui-row-h)+10px)]")}
          style={sideBounds ?? { ...initialBounds, visibility: placement ? "hidden" : undefined }}
        >
          <div ref={pickerContentsRef} className="p-1">
            <TrayRows
              items={picker.items ?? []}
              groupKeys={groupKeys}
              onToggleGroup={(key) =>
                setNavigation((current) => {
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
    </main>
  );
}

const root = document.getElementById("root");
if (root) {
  installKeyboardNavigationTracking();
  createRoot(root).render(<TrayWorkbenchPanel />);
}
