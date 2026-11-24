/**
 * @param {string} label
 */
function splitPrimaryAndSecondary(label) {
  const open = label.indexOf(" (");
  if (open <= 0 || !label.endsWith(")")) {
    return { primary: label, secondary: "" };
  }

  const primary = label.slice(0, open).trim();
  const secondary = label.slice(open + 2, -1).trim();
  if (!primary || !secondary || primary === secondary) {
    return { primary: label, secondary: "" };
  }
  return { primary, secondary };
}

/**
 * @param {string} label
 */
export function formatAudioDeviceLabel(label) {
  const full = typeof label === "string" && label.trim() ? label.trim() : "Unknown device";
  const compact = full.split(/\s+[—–]\s+/)[0]?.trim() || full;
  return { ...splitPrimaryAndSecondary(compact), full };
}
export function isUnavailableApplicationSource(sourceId, applications) {
  return (
    /^app-[0-9a-f]{32}$/.test(sourceId) &&
    !applications.some((application) => application.id === sourceId)
  );
}

const APPLICATION_NAMES = {
  applemusic: "Apple Music",
  chrome: "Chrome",
  explorer: "File Explorer",
  githubdesktop: "GitHub Desktop",
  systemsettings: "Settings",
};

function applicationNameKey(value) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function applicationSourceName({ label, windowTitle }) {
  const key = applicationNameKey(label);
  if (Object.hasOwn(APPLICATION_NAMES, key)) return APPLICATION_NAMES[key];
  if (windowTitle && applicationNameKey(windowTitle) === key) return windowTitle.trim();
  return label;
}

export function applicationWindowContext(application) {
  const title = application.windowTitle?.trim();
  return title &&
    applicationNameKey(title) !== applicationNameKey(applicationSourceName(application))
    ? title
    : undefined;
}
