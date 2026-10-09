import { describe, expect, it, vi } from "vitest";
import { availableMonitors, currentMonitor, primaryMonitor } from "@tauri-apps/api/window";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { readMonitorInventory } from "./monitorInventory.js";

vi.mock("@tauri-apps/api/window", () => ({
  availableMonitors: vi.fn(),
  currentMonitor: vi.fn(),
  primaryMonitor: vi.fn(),
}));

function monitor(name, x, width) {
  const position = new PhysicalPosition(x, 0);
  const size = new PhysicalSize(width, 1080);
  return { name, position, size, workArea: { position, size }, scaleFactor: 1 };
}

describe("monitor inventory", () => {
  it("uses current topology and retries after a failed read without caching old geometry", async () => {
    vi.mocked(currentMonitor).mockResolvedValue(null);
    vi.mocked(primaryMonitor).mockResolvedValue(monitor("Primary", -2560, 2560));
    vi.mocked(availableMonitors)
      .mockResolvedValueOnce([monitor("Old", 0, 1920)])
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce([monitor("Primary", -2560, 2560)]);
    expect((await readMonitorInventory()).monitors).toEqual([{ id: "Old", name: "Old" }]);
    await expect(readMonitorInventory()).rejects.toThrow("unavailable");
    expect(await readMonitorInventory()).toEqual({
      monitors: [{ id: "Primary", name: "Primary" }],
      fallbackMonitor: "Primary",
      monitorRects: [{ x: -2560, y: 0, width: 2560, height: 1080 }],
      monitorInventoryReady: true,
    });
  });
});
