/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readWindowGeometry, readWindowMonitors } from "./windowGeometry.js";
import { planWindowMove, windowOffset } from "../agentControl/windowControl.js";
import { windowHandlers } from "../agentControl/handlers/window.js";

const mocks = vi.hoisted(() => ({ current: vi.fn(), monitors: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  currentMonitor: mocks.current,
  availableMonitors: mocks.monitors,
  getCurrentWindow: () => ({
    innerSize: async () => ({ width: 2000, height: 1200 }),
    outerSize: async () => ({ width: 2002, height: 1234 }),
    outerPosition: async () => ({ x: 200, y: 200 }),
    isMaximized: async () => false,
    isMinimized: async () => false,
  }),
}));

beforeEach(() => {
  Object.defineProperty(navigator, "platform", { configurable: true, value: "Win32" });
  vi.stubGlobal("devicePixelRatio", 2.5);
  vi.stubGlobal("innerWidth", 800);
  vi.stubGlobal("innerHeight", 480);
  const main = {
    name: "Main",
    scaleFactor: 2,
    workArea: { position: { x: 0, y: 0 }, size: { width: 3840, height: 2100 } },
  };
  const side = {
    name: "Side",
    scaleFactor: 1.25,
    workArea: { position: { x: 3840, y: 0 }, size: { width: 2560, height: 1440 } },
  };
  mocks.current.mockResolvedValue(main);
  mocks.monitors.mockResolvedValue([main, side]);
});
afterEach(() => vi.unstubAllGlobals());

it("uses the WebView scale for current-monitor offsets and both work-area observations", async () => {
  const geometry = await readWindowGeometry();
  const monitors = await readWindowMonitors();
  expect(windowOffset(geometry, geometry.monitor)).toEqual({ x: 80, y: 80 });
  expect(monitors.map(({ cssScale, unitsPerCss }) => ({ cssScale, unitsPerCss }))).toEqual([
    { cssScale: 2.5, unitsPerCss: 2.5 },
    { cssScale: 1.5625, unitsPerCss: 1.5625 },
  ]);
  const response = await windowHandlers["window.inspect"].run(
    /** @type {any} */ ({
      requestId: "inspect",
      clock: { current: () => 0 },
      live: () => ({
        windowControl: {
          available: true,
          form: "normal",
          visible: true,
          readGeometry: readWindowGeometry,
          readMonitors: readWindowMonitors,
        },
      }),
    })
  );
  expect(response.result.monitors[0].workArea).toEqual(response.result.workArea);
  expect(response.result.workArea).toEqual({ width: 1536, height: 840 });
});

it("converts move offsets and size together before checking the target monitor's bounds", async () => {
  const geometry = await readWindowGeometry();
  const monitors = await readWindowMonitors();
  const move = planWindowMove({ form: "normal" }, geometry, monitors, {
    monitor: "Side",
    x: 500,
    y: 80,
  });
  expect(move.target).toEqual({ monitor: "Side", x: 625, y: 100, width: 1000, height: 600 });
  // This fits if the offset is incorrectly treated as native logical pixels, but not in CSS px.
  expect(
    planWindowMove({ form: "normal" }, geometry, monitors, { monitor: "Side", x: 1000, y: 80 })
  ).toMatchObject({ refusal: "windowPositionUnavailable" });
});

it("keeps macOS desktop origins in native points when the WebView has extra zoom", async () => {
  Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" });
  const geometry = await readWindowGeometry();
  expect(geometry.origin).toEqual({ x: 100, y: 100 });
  expect(geometry.monitor.unitsPerCss).toBe(1.25);
  expect(windowOffset(geometry, geometry.monitor)).toEqual({ x: 80, y: 80 });
});
