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
