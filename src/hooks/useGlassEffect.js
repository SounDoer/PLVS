import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../ipc/env.js";

export function useGlassEffect(enabled, dark) {
  useEffect(() => {
    if (!isTauri()) return;
    void invoke("set_glass_effect", {
      enabled: enabled === true,
      dark: dark === true,
    }).catch(() => {});
  }, [enabled, dark]);
}
