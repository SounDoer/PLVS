import { themeRuntime } from "./themeRuntime.js";

/**
 * CSS custom properties read once per theme instead of once per frame.
 *
 * Several panels resolve a token -- a stroke width, a fill opacity, an axis font -- inside the
 * paint they run for every frame. `getComputedStyle` is not a cheap read: it can force a style
 * recalculation, and a renderer profile put `getPropertyValue` alone at 3% of the frame time,
 * spent re-resolving values that only change when the theme does.
 *
 * The theme runtime's snapshot is that "when": a new theme compiles to a new object, so comparing
 * its identity is enough to know the answers are stale. Everything cached here must therefore be a
 * theme-owned token (the generated `--ui-*` set); a property some other code path can rewrite
 * without the theme changing does not belong in this cache.
 */
let cachedGeneration = null;
let byElement = new WeakMap();

function tokensFor(element) {
  const generation = themeRuntime.getSnapshot();
  if (generation !== cachedGeneration) {
    cachedGeneration = generation;
    byElement = new WeakMap();
  }
  let tokens = byElement.get(element);
  if (!tokens) {
    tokens = new Map();
    byElement.set(element, tokens);
  }
  return tokens;
}

/**
 * @param {Element} element the element to resolve against; tokens inherit, so any element under
 *   the themed root gives the same answer, and each is cached separately.
 * @param {string} name custom property name, including the leading dashes
 * @param {string} [fallback] returned when the property resolves to nothing
 * @returns {string}
 */
export function readCssToken(element, name, fallback = "") {
  if (!element) return fallback;
  const tokens = tokensFor(element);
  const cached = tokens.get(name);
  if (cached !== undefined) return cached;
  const value = getComputedStyle(element).getPropertyValue(name).trim() || fallback;
  tokens.set(name, value);
  return value;
}

/**
 * The same read as a number, for the tokens that are lengths or opacities. Non-numeric values --
 * including an absent token -- yield `fallback` rather than NaN.
 *
 * @param {Element} element
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
export function readCssNumber(element, name, fallback) {
  const value = Number.parseFloat(readCssToken(element, name));
  return Number.isFinite(value) ? value : fallback;
}

/** Test seam: drops every cached answer, as a theme change would. */
export function resetCssTokenCache() {
  cachedGeneration = null;
  byElement = new WeakMap();
}
