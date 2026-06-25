export const DEFAULT_FOCUS_VIEW = {
  autoHideControls: false,
  compactPanels: false,
  borderless: false,
};

export function normalizeFocusView(raw) {
  return {
    autoHideControls: raw?.autoHideControls === true,
    compactPanels: raw?.compactPanels === true,
    borderless: raw?.borderless === true,
  };
}
