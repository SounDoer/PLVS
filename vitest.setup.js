import { beforeEach } from "vitest";

import { resetCssTokenCache } from "./src/theme/cssTokens.js";

// CSS tokens are cached per theme (src/theme/cssTokens.js). Suites routinely stub
// `getComputedStyle`, and a value cached under one stub would answer for the next, so every
// test starts from a cold cache.
beforeEach(() => {
  resetCssTokenCache();
});

// jsdom does not implement HTMLCanvasElement.getContext, and without a stub it prints
// "Not implemented: HTMLCanvasElement.prototype.getContext" to stderr for every canvas-backed
// component a suite renders (Vectorscope polar/persistence plots). Returning null keeps those
// components on their existing "no 2D context" guard path — the same result jsdom produced, minus
// the noise. Suites that assert on canvas drawing spy on getContext with a real stub themselves,
// which overrides this default. Node-environment suites have no HTMLCanvasElement, so this is a
// no-op there.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = () => null;
}
