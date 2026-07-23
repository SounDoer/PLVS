export function historyPerformanceQuery({ dev, search }) {
  const params = new URLSearchParams(search);
  const enabled = dev && params.get("historyPerf") === "240m";
  return {
    enabled,
    fullVisual: enabled && params.get("historyPerfFullVisual") === "1",
  };
}
