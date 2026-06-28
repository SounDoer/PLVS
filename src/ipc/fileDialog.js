import { open } from "@tauri-apps/plugin-dialog";

export const MEDIA_EXTENSIONS = [
  "wav",
  "aiff",
  "aif",
  "flac",
  "mp3",
  "m4a",
  "aac",
  "ogg",
  "opus",
  "mp4",
  "m4v",
  "mov",
  "mkv",
  "webm",
  "avi",
  "ts",
  "m2ts",
  "wmv",
];

/** @returns {Promise<string | null>} Absolute path, or null if the user cancelled. */
export async function pickMediaFile() {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Media", extensions: MEDIA_EXTENSIONS }],
  });
  return typeof selected === "string" ? selected : null;
}
