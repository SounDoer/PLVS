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
