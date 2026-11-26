import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button } from "../components/ui/button.jsx";
import "../index.css";
import {
  isTrayLocateAction,
  TRAY_WORKBENCH_ACTION,
  TRAY_WORKBENCH_NOTICE,
  TRAY_WORKBENCH_PROBE,
  TRAY_WORKBENCH_STATE,
} from "./trayWorkbenchProtocol.js";

/**
 * @param {{
 *   items: import("../lib/nativeTrayMenu.js").TrayMenuDefinition[],
 *   onAction: (key: string) => void,
 * }} props
 */
function TrayPanelItems({ items, onAction }) {
  return (
    <ul className="space-y-0.5">
      {items.map(({ key, kind, text, enabled, checked, items: children }) => {
        if (kind === "separator") {
          return <li key={key} aria-hidden="true" className="my-1 border-t border-border" />;
        }
        if (kind === "submenu") {
          return (
            <li key={key}>
              {enabled === false ? (
                <span className="block px-2 py-1 text-sm text-muted-foreground">{text}</span>
              ) : (
                <details>
                  <summary className="cursor-pointer rounded-md px-2 py-1 text-sm hover:bg-ui-hover">
                    {text}
                  </summary>
                  <div className="ml-3 border-l border-border pl-2">
                    <TrayPanelItems items={children} onAction={onAction} />
                  </div>
                </details>
              )}
            </li>
          );
        }
        return (
          <li key={key}>
            <Button
              variant="ghost"
              className="w-full justify-start"
              aria-pressed={kind === "check" ? Boolean(checked) : undefined}
              disabled={enabled === false}
              onClick={() => onAction(key)}
            >
              {kind === "check" && (
                <span aria-hidden="true" className="w-3">
                  {checked ? "✓" : ""}
                </span>
              )}
              {text}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

function TrayWorkbenchPanel() {
  const [items, setItems] = useState(
    /** @type {import("../lib/nativeTrayMenu.js").TrayMenuDefinition[]} */ ([])
  );
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const announceReady = () => emitTo("main", TRAY_WORKBENCH_ACTION, { kind: "ready" });
    const listeners = Promise.all([
      listen(TRAY_WORKBENCH_STATE, ({ payload }) => setItems(payload)),
      listen(TRAY_WORKBENCH_NOTICE, ({ payload }) => setNotice(String(payload))),
      listen(TRAY_WORKBENCH_PROBE, () => void announceReady()),
    ]);
    void listeners.then(announceReady);
    function onEscape(event) {
      if (event.key === "Escape") void getCurrentWindow().hide();
    }
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("keydown", onEscape);
      void listeners.then((unlisten) => unlisten.forEach((stop) => stop()));
    };
  }, []);

  /** @param {string} key */
  async function request(key) {
    setNotice("");
    try {
      if (!isTrayLocateAction(key)) await getCurrentWindow().hide();
      await emitTo("main", TRAY_WORKBENCH_ACTION, { kind: "activate", key });
    } catch (error) {
      setNotice(String(error));
    }
  }

  return (
    <main className="flex h-dvh flex-col gap-3 border border-border bg-background p-3 text-foreground">
      <nav className="min-h-0 flex-1 overflow-auto" aria-label="PLVS tray">
        <TrayPanelItems items={items} onAction={(key) => void request(key)} />
      </nav>
      {notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      )}
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<TrayWorkbenchPanel />);
