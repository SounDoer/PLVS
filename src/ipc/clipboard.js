import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { isTauri } from "./env.js";

/// The desktop app reads through the native clipboard plugin: WebView2's `navigator.clipboard`
/// raises a browser-style "localhost wants to see your clipboard" prompt, and remembers a Block.
export async function readClipboardText() {
  if (isTauri()) return readText();
  return navigator.clipboard.readText();
}

/// Agent Control can copy while another app has focus, when WebView clipboard writes can fail.
export async function writeClipboardText(value) {
  if (isTauri()) return writeText(value);
  return navigator.clipboard.writeText(value);
}
