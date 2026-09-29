import { afterEach, describe, expect, it, vi } from "vitest";

import { watchDevicePixelRatio } from "./devicePixelRatioWatch.js";

function fakeMatchMedia() {
  const queries = [];
  const matchMedia = vi.fn((query) => {
    const listeners = new Set();
    const mql = {
      query,
      listeners,
      addEventListener: vi.fn((type, listener) => listeners.add(listener)),
      removeEventListener: vi.fn((type, listener) => listeners.delete(listener)),
    };
    queries.push(mql);
    return mql;
  });
  return { matchMedia, queries };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("watchDevicePixelRatio", () => {
  it("fires when the ratio moves away from the current one, then re-arms at the new ratio", () => {
    const { matchMedia, queries } = fakeMatchMedia();
    vi.stubGlobal("matchMedia", matchMedia);
    vi.stubGlobal("devicePixelRatio", 1);
    const onChange = vi.fn();

    watchDevicePixelRatio(onChange);
    expect(queries.at(-1).query).toBe("(resolution: 1dppx)");

    vi.stubGlobal("devicePixelRatio", 1.5);
    for (const listener of queries[0].listeners) listener();

    expect(onChange).toHaveBeenCalledOnce();
    expect(queries[0].listeners.size).toBe(0);
    expect(queries.at(-1).query).toBe("(resolution: 1.5dppx)");
    expect(queries.at(-1).listeners.size).toBe(1);
  });

  it("stops listening when disposed", () => {
    const { matchMedia, queries } = fakeMatchMedia();
    vi.stubGlobal("matchMedia", matchMedia);
    vi.stubGlobal("devicePixelRatio", 2);

    const dispose = watchDevicePixelRatio(vi.fn());
    dispose();

    expect(queries[0].listeners.size).toBe(0);
  });

  it("is a no-op where matchMedia does not exist", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(() => watchDevicePixelRatio(vi.fn())()).not.toThrow();
  });
});
