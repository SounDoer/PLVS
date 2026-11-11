import { useEffect, useState } from "react";
import { settingsStore } from "../persistence/index.js";
import { normalizeFileSummaryMetrics } from "../lib/fileSummaryPreferences.js";

const read = () => normalizeFileSummaryMetrics(settingsStore.read().fileSummaryMetrics);

export function useFileSummaryMetrics() {
  const [fileSummaryMetrics, setMetrics] = useState(read);
  useEffect(() => settingsStore.subscribe(() => setMetrics(read())), []);
  const setFileSummaryMetrics = (value) => {
    const next = normalizeFileSummaryMetrics(value);
    settingsStore.patch({ fileSummaryMetrics: next });
    setMetrics(next);
  };
  return { fileSummaryMetrics, setFileSummaryMetrics };
}
