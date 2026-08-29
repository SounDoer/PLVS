/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readCssNumber, readCssToken, resetCssTokenCache } from "./cssTokens.js";
import { themeRuntime } from "./themeRuntime.js";

function element() {
  return document.createElement("div");
}

afterEach(() => {
  resetCssTokenCache();
  vi.restoreAllMocks();
});

describe("readCssToken", () => {
  it("resolves a token once and answers the rest from cache", () => {
    const spy = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: () => " 1.5px ",
    });
    const el = element();

    expect(readCssToken(el, "--ui-x")).toBe("1.5px");
    expect(readCssToken(el, "--ui-x")).toBe("1.5px");
    expect(readCssToken(el, "--ui-x")).toBe("1.5px");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("resolves again once the theme has changed", () => {
    const snapshots = [{ id: "a" }, { id: "b" }];
    let index = 0;
    vi.spyOn(themeRuntime, "getSnapshot").mockImplementation(() => snapshots[index]);
    const values = ["1px", "2px"];
    vi.spyOn(window, "getComputedStyle").mockImplementation(() => ({
      getPropertyValue: () => values[index],
    }));
    const el = element();

    expect(readCssToken(el, "--ui-x")).toBe("1px");
    index = 1;
    expect(readCssToken(el, "--ui-x")).toBe("2px");
  });

  it("caches each element separately, because a token can be overridden below the root", () => {
    const spy = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: () => "3px",
    });
    readCssToken(element(), "--ui-x");
    readCssToken(element(), "--ui-x");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("falls back when the token resolves to nothing", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ getPropertyValue: () => "" });
    expect(readCssToken(element(), "--ui-x", "fallback")).toBe("fallback");
    expect(readCssToken(null, "--ui-x", "fallback")).toBe("fallback");
  });
});

describe("readCssNumber", () => {
  it("parses a length and keeps the fallback for anything unusable", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name) => (name === "--ui-n" ? "2.5px" : "auto"),
    });
    const el = element();
    expect(readCssNumber(el, "--ui-n", 1)).toBe(2.5);
    expect(readCssNumber(el, "--ui-bad", 7)).toBe(7);
  });
});
