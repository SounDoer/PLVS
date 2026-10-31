import { useEffect, useLayoutEffect, useState } from "react";
import { DockHeader } from "./DockHeader.jsx";
import { useAccessoryClient } from "./useAccessoryClient.js";
import { useSuppressNativeContextMenu } from "../../hooks/useSuppressNativeContextMenu.js";

/**
 * Where each editor button's centre is, so the main window can anchor an editor it opens itself
 * exactly where a click on that button would.
 */
function readEditorAnchors() {
  /** @type {Record<string, number>} */
  const anchors = {};
  for (const element of /** @type {NodeListOf<HTMLElement>} */ (
    document.querySelectorAll("[data-tour-target]")
  )) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0) anchors[element.dataset.tourTarget] = rect.left + rect.width / 2;
  }
  return anchors;
}

export function DockHeaderApp() {
  const { payload, action } = useAccessoryClient("dock-header");
  useSuppressNativeContextMenu();
  // Keep the last visible content while native hide is in flight. Publishing Ready/Start into
  // the still-visible window would flash the stopped transport on exit from Snapshot.
  const [visiblePayload, setVisiblePayload] = useState(payload);
  if (payload?.visible !== false && payload !== visiblePayload) setVisiblePayload(payload);
  const hasStatus = Boolean(payload?.statusItems);
  useLayoutEffect(() => {
    if (payload?.visible && Number.isSafeInteger(payload.presentationId)) {
      void action("header-ready", {
        presentationId: payload.presentationId,
        anchors: readEditorAnchors(),
      });
    }
  }, [action, payload?.visible, payload?.presentationId, hasStatus]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !event.repeat && !event.defaultPrevented) {
        action("dismiss-toolbar");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [action]);

  useEffect(() => {
    // Showing the toolbar activates this window, which would hand focus back to the button used
    // last and raise its tip over the neighbouring buttons.
    const onBlur = () => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

  return <DockHeader state={visiblePayload} onAction={action} />;
}
