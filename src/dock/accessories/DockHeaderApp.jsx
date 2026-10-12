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

  return <DockHeader state={payload} onAction={action} />;
}
