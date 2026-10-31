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

/** Every currently visible target, in document order, each id once. */
export function listUiTargets(root = globalThis.document) {
  const seen = new Set();
  const targets = [];
  for (const [id, element] of declaredTargets(root)) {
    if (seen.has(id) || !visibleRect(element)) continue;
    seen.add(id);
    targets.push({ id, kind: id.split(":")[0] });
  }
  return targets;
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
      return {
        found: true,
        visible: true,
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
