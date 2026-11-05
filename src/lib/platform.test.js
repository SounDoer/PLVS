/** @vitest-environment jsdom */
import { afterEach, expect, it } from "vitest";
import {
  isDockSupported,
  isDockReserveSpaceSupported,
  isDockAboveFullScreenSupported,
} from "./platform.js";

afterEach(() => {
  delete window.__PLVS_INITIAL_STATE__;
});

it("uses native backend refusal even when the user agent suggests Windows", () => {
  Object.defineProperty(navigator, "platform", { configurable: true, value: "Win32" });
  window.__PLVS_INITIAL_STATE__ = {
    agentControl: {
      dockCapabilities: { supported: false, reserveSpace: false, aboveFullScreen: false },
    },
  };
  expect(isDockSupported()).toBe(false);
  expect(isDockReserveSpaceSupported()).toBe(false);
  expect(isDockAboveFullScreenSupported()).toBe(false);
});

it("uses XWayland capabilities independently of navigator's Linux platform", () => {
  Object.defineProperty(navigator, "platform", { configurable: true, value: "Linux x86_64" });
  expect(isDockSupported()).toBe(false);
  window.__PLVS_INITIAL_STATE__ = {
    agentControl: {
      dockCapabilities: { supported: true, reserveSpace: true, aboveFullScreen: false },
    },
  };
  expect(isDockSupported()).toBe(true);
  expect(isDockReserveSpaceSupported()).toBe(true);
  expect(isDockAboveFullScreenSupported()).toBe(false);
});
