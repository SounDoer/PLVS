import { afterAll, beforeEach, vi } from "vitest";

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

// Radix's FocusScope defers its unmount autofocus to `setTimeout(..., 0)`, where it constructs a
// CustomEvent and dispatches it on the container. Testing Library's auto-cleanup unmounts the last
// test's tree in an afterEach, so that timer is still pending when the file ends, and if jsdom is
// torn down first the callback builds its event in a dead realm: dispatchEvent rejects it with
// "parameter 1 is not of type 'Event'". Vitest counts that as an unhandled error and fails the run
// with every test passing, which is how it took a release gate down once. Give the timer one real
// macrotask to land while the realm is alive. Hooks registered here run last, after the file's own
// afterEach and after auto-cleanup, so the unmount has already happened by this point.
afterAll(async () => {
  if (typeof window === "undefined" || vi.isFakeTimers()) return;
  await new Promise((resolve) => setTimeout(resolve, 0));
});
