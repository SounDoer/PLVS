import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../ipc/env.js";

export async function setGlassEffect(enabled, dark) {
  if (!isTauri()) return false;
  await invoke("set_glass_effect", {
    enabled: enabled === true,
    dark: dark === true,
  });
  return true;
}

export function useGlassEffect(enabled, dark) {
  useEffect(() => {
    void setGlassEffect(enabled, dark).catch(() => {});
  }, [enabled, dark]);
}
