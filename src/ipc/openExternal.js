import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "./env.js";

export const PRIVACY_POLICY_URL = "https://plvs.soundoer.com/privacy/";
export const DOCS_URL = "https://plvs.soundoer.com/docs/";
export const RELEASES_INDEX_URL = "https://github.com/SounDoer/PLVS/releases";
export const SHARESETS_URL = "https://plvs.soundoer.com/sharesets/";

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
