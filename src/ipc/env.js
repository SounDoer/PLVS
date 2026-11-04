/** True when running inside the Tauri WebView (desktop shell). */
export function isTauri() {
  return Boolean(
    typeof import.meta !== "undefined" &&
    (import.meta.env?.TAURI_ENV_PLATFORM || import.meta.env?.TAURI_PLATFORM)
  );
}

/**
 * Throws when the page runs inside a Tauri webview but was served without the Tauri build
 * environment (for example a separately started `npm run dev`). `isTauri()` would otherwise be
 * false and the app would silently run in browser mode inside the native window.
 *
 * @param {{ __TAURI_INTERNALS__?: unknown } | undefined} [win]
 */
export function assertTauriBuildEnvironment(win = globalThis.window) {
  if (win?.__TAURI_INTERNALS__ && !isTauri()) {
    throw new Error(
      "PLVS frontend was served without TAURI_ENV_PLATFORM, so it would run in browser mode " +
        "inside the Tauri window. Start the app with `npm run desktop:dev`, or pass the Tauri " +
        "environment to a separately served Vite process."
    );
  }
}
