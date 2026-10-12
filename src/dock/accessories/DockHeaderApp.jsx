import { useEffect } from "react";
import { DockHeader } from "./DockHeader.jsx";
import { useAccessoryClient } from "./useAccessoryClient.js";
import { useSuppressNativeContextMenu } from "../../hooks/useSuppressNativeContextMenu.js";

export function DockHeaderApp() {
  const { payload, action } = useAccessoryClient("dock-header");
  useSuppressNativeContextMenu();

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") action("dismiss-toolbar");
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

  return <DockHeader state={payload} onAction={action} />;
}
