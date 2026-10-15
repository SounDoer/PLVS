import { useRef } from "react";
import { HistoryDataProvider, PanelInstanceProvider } from "../../workspace/AudioDataContext.jsx";
import { TimeRangeRow } from "../../components/panel-settings/AxisRangeRows.jsx";
import { getHistoryViewport, HISTORY_MAX_WINDOW_SEC } from "../../math/historyMath.js";
import { HIST_SAMPLE_SEC } from "../../hooks/useLoudnessHistory.js";

export function DockTimeRangeSettings({
  controls,
  sharedTimeViewport,
  onSharedTimeChange,
  onChange,
}) {
  const linked = controls.linkTimeViewport !== false;
  const current = linked
    ? sharedTimeViewport
    : { windowSec: controls.historyWindowSec, offsetSec: controls.historyOffsetSec };
  const pending = useRef(current);
  pending.current = current;
  if (!current) return null;
  const maxWindowSec = sharedTimeViewport?.maxWindowSec ?? HISTORY_MAX_WINDOW_SEC;
  const totalSamples = sharedTimeViewport?.totalSamples ?? 0;
  const viewport = getHistoryViewport(
    totalSamples,
    current.windowSec,
    current.offsetSec,
    HIST_SAMPLE_SEC,
    maxWindowSec
  );
  const commit = (patch) => {
    const next = { ...pending.current, ...patch };
    pending.current = next;
    if (linked) onSharedTimeChange?.(next);
    else
      onChange({ ...controls, historyWindowSec: next.windowSec, historyOffsetSec: next.offsetSec });
  };
  return (
    <PanelInstanceProvider
      value={{
        axisViewports: { time: { ...current, linked } },
        setAxisViewportLinked: (_kind, nextLinked) =>
          onChange({
            ...controls,
            linkTimeViewport: nextLinked,
            ...(!nextLinked
              ? { historyWindowSec: current.windowSec, historyOffsetSec: current.offsetSec }
              : {}),
          }),
      }}
    >
      <HistoryDataProvider
        value={{
          sourceMode: "live",
          totalSamples,
          visibleSamples: viewport.visibleSamples,
          effectiveOffsetSamples: viewport.effectiveOffsetSamples,
          historyMaxWindowSec: maxWindowSec,
          setHistoryWindowSec: (windowSec) => commit({ windowSec }),
          setHistoryOffsetSec: (offsetSec) => commit({ offsetSec }),
        }}
      >
        <TimeRangeRow />
      </HistoryDataProvider>
    </PanelInstanceProvider>
  );
}
