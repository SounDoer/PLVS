import { DEFAULT_FOCUS_VIEW } from "../lib/focusView.js";
import { DEFAULT_GLASS_ENABLED, DEFAULT_PANEL_OPACITY } from "../settings/defaults.js";

export const DEFAULT_VIEW = Object.freeze({
  pinned: false,
  focusView: Object.freeze({ ...DEFAULT_FOCUS_VIEW }),
  panelOpacity: DEFAULT_PANEL_OPACITY,
  glassEnabled: DEFAULT_GLASS_ENABLED,
});

const VIEW_FIELDS = new Set(["pinned", "focusView", "panelOpacity", "glassEnabled"]);
const FOCUS_FIELDS = new Set(["autoHideControls", "compactPanels", "borderless"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function issue(code, path, message) {
  return { code, path, message };
}

export function viewStateSignature(view) {
  return JSON.stringify(buildPublicView(view));
}

export function buildPublicView(view) {
  return {
    pinned: view?.pinned === true,
    focusView: {
      autoHideControls: view?.focusView?.autoHideControls === true,
      compactPanels: view?.focusView?.compactPanels === true,
      borderless: view?.focusView?.borderless === true,
    },
    panelOpacity: view?.panelOpacity ?? DEFAULT_PANEL_OPACITY,
    glassEnabled: view?.glassEnabled === true,
  };
}

function availability(context) {
  const docked = context.docked === true;
  const glassWritable = context.platform === "macos";
  return {
    pinned: {
      writable: true,
      active: !docked,
      reason: docked ? "dockOwnsWindowPresentation" : null,
    },
    focusView: {
      autoHideControls: {
        writable: true,
        active: !docked,
        reason: docked ? "dockOwnsWindowPresentation" : null,
      },
      compactPanels: { writable: true, active: true, reason: null },
      borderless: {
        writable: true,
        active: !docked,
        reason: docked ? "dockOwnsWindowPresentation" : null,
      },
    },
    panelOpacity: { writable: true, active: true, reason: null },
    glassEnabled: {
      writable: glassWritable,
      active: glassWritable,
      reason: glassWritable ? null : "platformUnsupported",
    },
  };
}

export function buildViewInspection(view, context = {}) {
  const state = buildPublicView(view);
  return {
    view: state,
    runtime: {
      windowPresentation: {
        state: context.docked === true ? "suspended" : "active",
        owner: context.docked === true ? "dock" : "view",
      },
    },
    availability: availability(context),
  };
}

export function buildViewDescription(view, context = {}) {
  const inspection = buildViewInspection(view, context);
  return {
    ...inspection,
    schema: {
      pinned: { type: "boolean", default: false, current: inspection.view.pinned },
      focusView: {
        type: "object",
        properties: Object.fromEntries(
          [...FOCUS_FIELDS].map((field) => [
            field,
            { type: "boolean", default: false, current: inspection.view.focusView[field] },
          ])
        ),
      },
      panelOpacity: {
        type: "integer",
        minimum: 0,
        maximum: 100,
        unit: "percent",
        default: DEFAULT_PANEL_OPACITY,
        current: inspection.view.panelOpacity,
      },
      glassEnabled: {
        type: "boolean",
        default: DEFAULT_GLASS_ENABLED,
        current: inspection.view.glassEnabled,
        availability: inspection.availability.glassEnabled,
      },
    },
  };
}

export function planViewUpdate(currentInput, patch, context = {}, options = {}) {
  const current = buildPublicView(currentInput);
  const issues = [];
  for (const field of Object.keys(patch)) {
    if (!VIEW_FIELDS.has(field)) {
      issues.push(issue("unknownControl", `$.${field}`, `Unknown View control: ${field}.`));
    }
  }
  if ("pinned" in patch && typeof patch.pinned !== "boolean") {
    issues.push(issue("invalidType", "$.pinned", "pinned must be a boolean."));
  }
  let nextFocus = current.focusView;
  if ("focusView" in patch) {
    if (!isObject(patch.focusView)) {
      issues.push(issue("invalidType", "$.focusView", "focusView must be an object."));
    } else {
      for (const field of Object.keys(patch.focusView)) {
        if (!FOCUS_FIELDS.has(field)) {
          issues.push(
            issue("unknownControl", `$.focusView.${field}`, `Unknown Focus View control: ${field}.`)
          );
        } else if (typeof patch.focusView[field] !== "boolean") {
          issues.push(
            issue("invalidType", `$.focusView.${field}`, `focusView.${field} must be a boolean.`)
          );
        }
      }
      nextFocus = { ...current.focusView, ...patch.focusView };
    }
  }
  if (
    "panelOpacity" in patch &&
    (!Number.isInteger(patch.panelOpacity) || patch.panelOpacity < 0 || patch.panelOpacity > 100)
  ) {
    issues.push(
      issue("invalidRange", "$.panelOpacity", "panelOpacity must be an integer from 0 to 100.")
    );
  }
  if ("glassEnabled" in patch && typeof patch.glassEnabled !== "boolean") {
    issues.push(issue("invalidType", "$.glassEnabled", "glassEnabled must be a boolean."));
  }
  if (issues.length > 0) {
    return { view: current, changed: [], effects: [], warnings: [], issues, refusal: null };
  }
  if (
    "glassEnabled" in patch &&
    context.platform !== "macos" &&
    options.allowUnavailableGlassReset !== true
  ) {
    return {
      view: current,
      changed: [],
      effects: [],
      warnings: [],
      issues: [],
      refusal: { code: "controlUnavailable", reason: "platformUnsupported", field: "glassEnabled" },
    };
  }

  const view = {
    pinned: "pinned" in patch ? patch.pinned : current.pinned,
    focusView: nextFocus,
    panelOpacity: "panelOpacity" in patch ? patch.panelOpacity : current.panelOpacity,
    glassEnabled: "glassEnabled" in patch ? patch.glassEnabled : current.glassEnabled,
  };
  const changed = [];
  if (view.pinned !== current.pinned) changed.push("view.pinned");
  for (const field of FOCUS_FIELDS) {
    if (view.focusView[field] !== current.focusView[field]) changed.push(`view.focusView.${field}`);
  }
  if (view.panelOpacity !== current.panelOpacity) changed.push("view.panelOpacity");
  if (view.glassEnabled !== current.glassEnabled) changed.push("view.glassEnabled");

  const effects = [];
  if (changed.includes("view.pinned")) effects.push("alwaysOnTop");
  if (
    changed.includes("view.focusView.autoHideControls") ||
    changed.includes("view.focusView.borderless")
  ) {
    effects.push("windowDecorations");
  }
  if (changed.includes("view.focusView.compactPanels")) effects.push("compactPanels");
  if (changed.includes("view.panelOpacity")) effects.push("panelOpacity");
  if (changed.includes("view.glassEnabled")) effects.push("glassEffect");

  const dormant = new Set([
    "view.pinned",
    "view.focusView.autoHideControls",
    "view.focusView.borderless",
  ]);
  const warnings =
    context.docked === true
      ? changed
          .filter((path) => dormant.has(path))
          .map((path) => ({
            code: "currentlyInactive",
            path,
            reason: "dockOwnsWindowPresentation",
          }))
      : [];
  return { view, changed, effects, warnings, issues: [], refusal: null };
}

export function planViewReset(current, context = {}) {
  return planViewUpdate(current, DEFAULT_VIEW, context, { allowUnavailableGlassReset: true });
}
