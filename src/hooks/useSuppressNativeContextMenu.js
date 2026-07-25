import { useEffect } from "react";
import { preventNativeContextMenu } from "../lib/contextMenu.js";

// Suppress the OS right-click menu window-wide. Shared by the main app and the
// dock accessory roots so dock windows behave like normal mode.
export function useSuppressNativeContextMenu() {
  useEffect(() => {
    window.addEventListener("contextmenu", preventNativeContextMenu);
    return () => window.removeEventListener("contextmenu", preventNativeContextMenu);
  }, []);
}
