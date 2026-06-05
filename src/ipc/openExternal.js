import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "./env.js";

export async function openExternalUrl(url) {
  if (!url) return;

  if (isTauri()) {
    await openUrl(url);
    return;
  }

  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
