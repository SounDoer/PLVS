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

export function toggleId(ids, id) {
  if (ids.includes(id)) {
    return ids.filter((currentId) => currentId !== id);
  }
  return [...ids, id];
}
