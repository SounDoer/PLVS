import { useEffect } from "react";
import { preventNativeContextMenu } from "../lib/contextMenu.js";
import { cleanupLegacyKeys } from "../persistence/cleanupLegacyKeys.js";

export function useAppGlobalEffects() {
  useEffect(() => {
    cleanupLegacyKeys();
  }, []);

  useEffect(() => {
    window.addEventListener("contextmenu", preventNativeContextMenu);
    return () => window.removeEventListener("contextmenu", preventNativeContextMenu);
  }, []);
}
