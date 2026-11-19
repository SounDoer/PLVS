/** @typedef {{ workspace: { hidePanelHeaders: boolean, hideAxesAndLabels: boolean }, dock: { hideAxesAndLabels: boolean } }} PanelPresentation */

/** @returns {PanelPresentation} */
export function normalizePanelPresentation(raw, legacyFocusView = {}) {
  return {
    workspace: {
      hidePanelHeaders:
        typeof raw?.workspace?.hidePanelHeaders === "boolean"
          ? raw.workspace.hidePanelHeaders
          : legacyFocusView?.compactPanels === true,
      hideAxesAndLabels: raw?.workspace?.hideAxesAndLabels === true,
    },
    dock: { hideAxesAndLabels: raw?.dock?.hideAxesAndLabels === true },
  };
}

export const DEFAULT_PANEL_PRESENTATION = normalizePanelPresentation(null);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function issue(code, path, message) {
  return { code, path, message };
}

export function validatePanelPresentationPatch(raw, path = "$.panelPresentation") {
  const issues = [];
  if (!isObject(raw)) return [issue("invalidType", path, "panelPresentation must be an object.")];
  for (const [surface, values] of Object.entries(raw)) {
    if (!Object.hasOwn(DEFAULT_PANEL_PRESENTATION, surface)) {
      issues.push(issue("unknownControl", `${path}.${surface}`, "Unknown presentation surface."));
    } else if (!isObject(values)) {
      issues.push(
        issue("invalidType", `${path}.${surface}`, "Surface presentation must be an object.")
      );
    } else
      for (const [key, value] of Object.entries(values)) {
        if (!Object.hasOwn(DEFAULT_PANEL_PRESENTATION[surface], key))
          issues.push(
            issue("unknownControl", `${path}.${surface}.${key}`, "Unknown presentation control.")
          );
        else if (typeof value !== "boolean")
          issues.push(
            issue(
              "invalidType",
              `${path}.${surface}.${key}`,
              "Presentation control must be a boolean."
            )
          );
      }
  }
  return issues;
}
