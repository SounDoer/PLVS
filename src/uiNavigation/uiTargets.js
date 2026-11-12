/**
 * Named pointer targets in the main WebView. A component names what it renders with
 * `data-ui-target="<kind>:<key>"`, or, inside a panel, with `data-ui-part="<part>"` under the panel
 * container's `data-ui-panel="<panelId>"`, which is addressed as `panel:<panelId>:<part>`. Agent
 * Control resolves only names a mounted component declared; it never accepts selectors, labels or
 * coordinates.
 */

// A kind, then the owner's own key: Device and Preset IDs keep whatever characters their family
// reports. Matching is an exact string comparison, never a selector, so the key needs no escaping.
const TARGET_ID = /^[a-z][a-z-]*:[^\s"'`\\<>]{1,256}$/;

export function isUiTargetId(value) {
  return typeof value === "string" && value.length <= 256 && TARGET_ID.test(value);
}

function visibleRect(element) {
  if (!element?.isConnected) return null;
  const style = globalThis.getComputedStyle?.(element);
  if (style && (style.visibility === "hidden" || style.display === "none")) return null;
  const rect = element.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return null;
  const viewport = { width: globalThis.innerWidth, height: globalThis.innerHeight };
  if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= viewport.width) return null;
  if (rect.top >= viewport.height) return null;
  return rect;
}

function panelParts(root) {
  const entries = [];
  for (const panel of root.querySelectorAll("[data-ui-panel]")) {
    const panelId = panel.getAttribute("data-ui-panel");
    if (!panelId) continue;
    entries.push([`panel:${panelId}`, panel]);
    for (const part of panel.querySelectorAll("[data-ui-part]")) {
      // A nested panel container owns its own parts.
      if (part.closest("[data-ui-panel]") !== panel) continue;
      entries.push([`panel:${panelId}:${part.getAttribute("data-ui-part")}`, part]);
    }
  }
  return entries;
}

function declaredTargets(root) {
  const entries = [];
  for (const element of root.querySelectorAll("[data-ui-target]")) {
    entries.push([element.getAttribute("data-ui-target"), element]);
  }
  return [...entries, ...panelParts(root)].filter(([id]) => isUiTargetId(id));
}

/** Reads states exposed by the rendered element through native controls or ARIA. */
function targetState(element) {
  const state = {};
  for (const name of ["pressed", "expanded", "selected", "checked", "disabled"]) {
    const value = element.getAttribute(`aria-${name}`);
    if (value === "true" || value === "false") state[name] = value === "true";
    if (value === "mixed" && (name === "pressed" || name === "checked")) state[name] = value;
  }
  if (element.matches("button, input, select, textarea, option, optgroup, fieldset")) {
    state.disabled = element.matches(":disabled") || state.disabled === true;
  }
  if (element.matches('input[type="checkbox"], input[type="radio"]')) {
    state.checked = element.indeterminate ? "mixed" : element.checked;
  }
  if (element.matches("option")) state.selected = element.selected;
  return Object.keys(state).length ? state : undefined;
}

/** Every currently visible target, in document order, each id once. */
export function listUiTargets(root = globalThis.document) {
  const seen = new Set();
  const targets = [];
  for (const [id, element] of declaredTargets(root)) {
    if (seen.has(id) || !visibleRect(element)) continue;
    seen.add(id);
    const state = targetState(element);
    targets.push({ id, kind: id.split(":")[0], ...(state && { state }) });
  }
  return targets;
}

/**
 * Resolves a target in the main WebView first, then in the Dock toolbar and editor WebViews, whose
 * targets those windows report themselves. `surface` names the WebView the rect belongs to.
 *
 * @param {string} id
 * @param {() => { id: string, rect: any, surface: string }[]} [accessoryTargets]
 */
export function resolveUiTarget(id, accessoryTargets = () => []) {
  const main = locateUiTarget(id);
  if (main.found) return { ...main, surface: "main" };
  const accessory = accessoryTargets().find((target) => target.id === id);
  if (!accessory) return main;
  return {
    found: true,
    visible: true,
    rect: accessory.rect,
    viewport: null,
    surface: accessory.surface,
  };
}

/**
 * Where a target is, in CSS pixels relative to the main WebView viewport. A declared but hidden
 * target reports `visible: false`; an undeclared one reports `found: false`.
 */
export function locateUiTarget(id, root = globalThis.document) {
  const viewport = { width: globalThis.innerWidth, height: globalThis.innerHeight };
  const matches = declaredTargets(root).filter(([candidate]) => candidate === id);
  if (matches.length === 0) return { found: false, visible: false, rect: null, viewport };
  for (const [, element] of matches) {
    const rect = visibleRect(element);
    if (rect) {
      const state = targetState(element);
      return {
        found: true,
        visible: true,
        ...(state && { state }),
        rect: {
          x: Math.round(rect.left * 100) / 100,
          y: Math.round(rect.top * 100) / 100,
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100,
        },
        viewport,
      };
    }
  }
  return { found: true, visible: false, rect: null, viewport };
}
