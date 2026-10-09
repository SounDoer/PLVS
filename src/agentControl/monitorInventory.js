import { availableMonitors, currentMonitor, primaryMonitor } from "@tauri-apps/api/window";

// Read on demand, never cache a successful or failed topology across control requests.
export async function readMonitorInventory() {
  const [monitors, current, primary] = await Promise.all([
    availableMonitors(),
    currentMonitor(),
    primaryMonitor(),
  ]);
  return {
    monitors: monitors.flatMap((monitor) =>
      typeof monitor.name === "string" ? [{ id: monitor.name, name: monitor.name }] : []
    ),
    fallbackMonitor: current?.name ?? primary?.name ?? null,
    monitorRects: monitors.flatMap((monitor) =>
      Number.isFinite(monitor.position?.x) &&
      Number.isFinite(monitor.position?.y) &&
      Number.isFinite(monitor.size?.width) &&
      Number.isFinite(monitor.size?.height)
        ? [
            {
              x: monitor.position.x,
              y: monitor.position.y,
              width: monitor.size.width,
              height: monitor.size.height,
            },
          ]
        : []
    ),
    monitorInventoryReady: true,
  };
}
