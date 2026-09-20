import { resolveResource } from "@tauri-apps/api/path";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "./env.js";

export const LICENSE_NOTICES_URL =
  "https://github.com/SounDoer/PLVS/blob/main/THIRD-PARTY-NOTICES.md";

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

export async function openLicenseNotices() {
  if (isTauri()) {
    const path = await resolveResource("licenses/THIRD-PARTY-NOTICES.txt");
    await openPath(path);
    return;
  }

  await openExternalUrl(LICENSE_NOTICES_URL);
}
