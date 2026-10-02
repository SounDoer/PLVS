import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../ipc/env.js";

export async function syncSurfaceOpacityWindowShadow(surfaceOpacity) {
  if (!isTauri()) return false;
  await invoke("sync_surface_opacity_shadow", { surfaceOpacity });
  return true;
}

export function useSurfaceOpacityWindowShadow(surfaceOpacity) {
  const isFullyTransparent = surfaceOpacity === 0;
  useEffect(() => {
    // Only the zero/non-zero boundary changes native window state. Rust owns
    // the platform policy and defers the actual update while Dock is active.
    void syncSurfaceOpacityWindowShadow(isFullyTransparent ? 0 : 100).catch(() => {});
  }, [isFullyTransparent]);
}
