import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "./env.js";

export const PRIVACY_POLICY_URL = "https://plvs.soundoer.com/privacy/";

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
