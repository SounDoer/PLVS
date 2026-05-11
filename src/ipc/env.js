/** True when running inside the Tauri WebView (desktop shell). */
export function isTauri() {
  return Boolean(
    typeof import.meta !== "undefined" &&
    (import.meta.env?.TAURI_ENV_PLATFORM || import.meta.env?.TAURI_PLATFORM)
  );
}
