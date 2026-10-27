export function getSelectedOption(options, valueKey) {
  const matchedOption = options.find((opt) => opt.key === valueKey);
  return {
    matchedOption,
    selectedOption: matchedOption ?? options[0],
  };
}

export function spectrumKeyFromSelection(sel) {
  if (!sel) return "";
  return sel.type === "pair" ? `p-${sel.x}-${sel.y}` : `s-${sel.ch}`;
}

export function vectorscopeKeyFromPair(pair) {
  return pair ? `${pair.x}-${pair.y}` : "";
}

export function stereoMapKeyFromPair(pair) {
  return pair ? `${pair.x}-${pair.y}` : "";
}

/// A stored channel selection the current source lacks. The panel keeps it and analyses a fallback,
/// so the control names the request instead of pretending the fallback was chosen.
/**
 * @param {string} label
 * @param {number} channelCount The current channel count; 0 while it is not known yet.
 */
export function storedChannelLabel(label, channelCount) {
  return channelCount > 0 ? `${label} (Unavailable)` : label;
}

/** @param {{ type: "pair", x: number, y: number } | { type: "single", ch: number }} sel */
export function spectrumSelectionLabel(sel) {
  return sel.type === "single" ? `Ch ${sel.ch + 1}` : `Ch ${sel.x + 1}+Ch ${sel.y + 1}`;
}

export function toggleId(ids, id) {
  if (ids.includes(id)) {
    return ids.filter((currentId) => currentId !== id);
  }
  return [...ids, id];
}
