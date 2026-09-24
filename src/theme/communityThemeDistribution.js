import {
  hashPortableTheme,
  serializePortableTheme,
  validatePortableTheme,
} from "./portableTheme.js";

const FILE_EXTENSION = "plvstheme";

function safeFileBase(name) {
  return (
    String(name)
      .replace(/[\\/:*?"<>|]/g, "-")
      .trim() || "plvs-theme"
  );
}

/**
 * Build both public delivery choices from the exact same canonical bytes. The website can change
 * button presentation without creating a clipboard-only or download-only Theme representation.
 */
export async function buildCommunityThemeDistribution(raw) {
  const document = validatePortableTheme(raw);
  const contents = serializePortableTheme(document);
  const contentHash = await hashPortableTheme(document);
  return {
    contentHash,
    mediaType: "application/json",
    clipboard: {
      label: "Copy Theme",
      text: contents,
    },
    download: {
      label: "Download .plvstheme",
      fileName: `${safeFileBase(document.name)}.${FILE_EXTENSION}`,
      contents,
    },
  };
}
