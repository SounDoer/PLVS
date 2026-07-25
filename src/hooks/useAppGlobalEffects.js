import { useEffect } from "react";
import { cleanupLegacyKeys } from "../persistence/cleanupLegacyKeys.js";
import { useSuppressNativeContextMenu } from "./useSuppressNativeContextMenu.js";

export function useAppGlobalEffects() {
  useEffect(() => {
    cleanupLegacyKeys();
  }, []);

  useSuppressNativeContextMenu();
}
