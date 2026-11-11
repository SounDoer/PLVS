import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, Info, LoaderCircle, SlidersHorizontal } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.jsx";
import { Button } from "./ui/button.jsx";
import { FileAnalysisHistoryMenu } from "./FileAnalysisHistoryMenu.jsx";
import { HoverTip } from "./HoverTip.jsx";
import { FileDetailPopover } from "./FileDetailPopover.jsx";
import { PanelSettingsHeader } from "./PanelSettingsHeader.jsx";
import { SortableStatsList } from "./panel-settings/StatsSettings.jsx";
import { useDropdownNavigation } from "../uiNavigation/useDropdownNavigation.js";
import {
  formatChannelLayout,
  formatContainer,
  formatSampleRate,
  formatTrackLabel,
} from "../lib/fileAnalysisDisplay.js";
import { SHELL_SURFACE_BASE } from "../lib/shellLayout.js";
import { getSuccessfulFileSession } from "../lib/fileAnalysisSessionRegistry.js";
import { buildFileAnalysisReport } from "../lib/fileAnalysisReport.js";
import { FILE_METRICS, FILE_UNAVAILABLE_EXPLANATIONS } from "../lib/fileAnalysisMeasurements.js";
import { fitFileMetrics, normalizeFileSummaryMetrics } from "../lib/fileSummaryPreferences.js";
import { statDecimals } from "../lib/statsCatalog.js";
import { formatClock } from "../hooks/useSessionTimer.js";
import { cn } from "../lib/utils.js";

const DEFAULT_METRICS = normalizeFileSummaryMetrics(null);
const inlineGap = "gap-[var(--ui-metric-inline-gap)]";
const metricGap = "gap-[var(--ui-shell-gap)]";
const icon = "size-[length:var(--ui-icon-management-action)] shrink-0";
const detailButton =
  "flex shrink-0 items-center p-1 text-muted-foreground hover:bg-ui-hover hover:text-foreground";

function formatDepth(track) {
  if (!track || !Number.isFinite(track.bitsPerSample) || track.bitsPerSample <= 0) return null;
  if (/^pcm_f/.test(track.codec)) return track.bitsPerSample + "-bit Float";
  if (/^pcm_|^(flac|alac|wavpack|ape|tta)$/.test(track.codec)) return track.bitsPerSample + "-bit";
  return null;
}

function FileInfo({ session }) {
  const metadata = session.metadata ?? {};
  const track = metadata.selectedTrack;
  const summary = session.summary;
  const details = [
    ["Path", session.path ?? metadata.path],
    ["Container", formatContainer(metadata.container)],
    ["Track", track && formatTrackLabel(track)],
    ["Track Name", track?.title],
    ["Source Layout", track?.channelLayout],
    [
      "Calculation Layout",
      summary?.loudnessLayoutKnown === false
        ? "Unknown; loudness uses channels 1–2."
        : summary?.loudnessLayout,
    ],
    ["Source Bit Depth", formatDepth(track)],
    ["Decoder Sample Format", track?.sampleFormat],
    [
      "Declared Duration",
      Number.isFinite(metadata.durationMs) &&
      Number.isFinite(summary?.durationMs) &&
      Math.abs(metadata.durationMs - summary.durationMs) > 250
        ? formatClock(metadata.durationMs)
        : null,
    ],
  ].filter(([, value]) => value != null);
  return (
    <dl className="grid gap-[var(--ui-drawer-row-gap)] [overflow-wrap:anywhere]">
      {details.map(([label, value]) => (
        <div key={label}>
          <dt className="font-medium text-foreground">{label}</dt>
          <dd className="text-muted-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function warningDetails(session, result, settings, activeTask) {
  const details = [];
  if (session.state === "error")
    details.push(
      (session.error || "Analysis failed.") +
        (result ? " The previous result is still displayed." : "")
    );
  if (activeTask && result)
    details.push("The previous successful result remains available while analysis runs.");
  const previous = result?.analysisSettings;
  if (previous && settings) {
    const count = result.summary.channels ?? result.summary.channelCount;
    const detectorChanged =
      previous.dialogue?.enabled !== settings.dialogue?.enabled ||
      previous.dialogue?.engine !== settings.dialogue?.engine;
    const layoutChanged =
      JSON.stringify(previous.channelRolesByCount?.[count] ?? null) !==
      JSON.stringify(settings.channelRolesByCount?.[count] ?? null);
    if (detectorChanged || layoutChanged) {
      const changed = [detectorChanged && "Dialogue Detection", layoutChanged && "Channel Layout"]
        .filter(Boolean)
        .join(" and ");
      details.push(changed + " changed since this result. Reanalyze to use the current settings.");
    }
    const needs = settings.requests;
    const actual = previous.requests;
    if (
      needs &&
      actual &&
      ((needs.spectralWaveform && !actual.spectralWaveform) ||
        ["spectrum", "vectorscope", "stereoMap"].some((family) =>
          (needs[family] ?? []).some(
            ({ key }) => !(actual[family] ?? []).some((request) => request.key === key)
          )
        ))
    ) {
      details.push(
        "A current view was not computed in this result. Reanalyze to create its browsing data."
      );
    }
  }
  return details;
}

const NO_MEASUREMENT = "-";
const METRIC_ANNOTATION = "text-[length:var(--ui-fs-metric-meta)] text-muted-foreground";

function metricNumber(metric, value) {
  return value.toFixed(metric.id === "samplePeakMax" ? 1 : statDecimals(metric.id));
}

function valueText(metric, value) {
  return Number.isFinite(value) ? metricNumber(metric, value) + " " + metric.unit : NO_MEASUREMENT;
}

function positionText(location) {
  if (!Number.isFinite(location?.timeSeconds)) return NO_MEASUREMENT;
  return (
    location.timeSeconds.toFixed(6) + " s" + (location.framePosition < 0 ? " · Before Start" : "")
  );
}

function MetricDetail({ metric, report }) {
  const value = report?.summary[metric.field];
  const reason = report?.unavailableReasons?.[metric.field];
  const position = metric.location && report?.summary.maximaLocations?.[metric.location];
  const peak = metric.id === "truePeak" || metric.id === "samplePeakMax";
  const timeKey = metric.id === "truePeak" ? "truePeakMaxLocation" : "samplePeakMaxLocation";
  const reasonKey =
    metric.id === "truePeak" ? "truePeakMaxUnavailableReason" : "samplePeakMaxUnavailableReason";
  return (
    <div className="grid gap-[var(--ui-drawer-row-gap)]">
      <p className="font-medium text-foreground">
        {metric.label}: {valueText(metric, value)}
      </p>
      {!report || reason ? (
        <p className="text-muted-foreground">
          {FILE_UNAVAILABLE_EXPLANATIONS[reason] ?? "No completed measurement yet."}
        </p>
      ) : null}
      {metric.location ? (
        <p className="text-muted-foreground">
          {peak ? "First Maximum" : "Window End"}: {positionText(position)}
        </p>
      ) : null}
      {peak && report?.summary.channelPeaks.length ? (
        <table className="w-full text-left tabular-nums">
          <thead>
            <tr>
              <th className="pr-2 font-medium">Channel</th>
              <th className="pr-2 font-medium">Maximum</th>
              <th className="font-medium">Time</th>
            </tr>
          </thead>
          <tbody>
            {report.summary.channelPeaks.map((row) => (
              <tr key={row.channelIndex}>
                <td className="pr-2">{row.label}</td>
                <td className="pr-2" title={FILE_UNAVAILABLE_EXPLANATIONS[row[reasonKey]]}>
                  {valueText(metric, row[metric.field])}
                </td>
                <td>{positionText(row[timeKey])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function MetricColumn({ metric, report }) {
  const value = report?.summary[metric.field];
  const available = Number.isFinite(value);
  return (
    <span className="flex w-max min-w-max flex-col items-start px-[var(--ui-shell-pad)] py-0.5 whitespace-nowrap">
      <span className={METRIC_ANNOTATION}>{metric.label}</span>
      <span className="text-[length:var(--ui-fs-metric-value)] leading-normal">
        <span className="font-[family-name:var(--ui-font-mono)] font-semibold tabular-nums text-foreground">
          {available ? metricNumber(metric, value) : NO_MEASUREMENT}
        </span>
        {available && (
          <>
            {" "}
            <span className={METRIC_ANNOTATION}>{metric.unit}</span>
          </>
        )}
      </span>
    </span>
  );
}

function MetricTrigger({ metric, report, suffix = "" }) {
  return (
    <FileDetailPopover
      label={metric.label + " details"}
      target={"file-metric:" + metric.id + suffix}
      className="shrink-0 text-left hover:bg-ui-hover"
      trigger={<MetricColumn metric={metric} report={report} />}
    >
      <MetricDetail metric={metric} report={report} />
    </FileDetailPopover>
  );
}

function SummaryMetrics({ preferences, onChange, report }) {
  const metrics = preferences.visible
    .map((id) => FILE_METRICS.find((metric) => metric.id === id))
    .filter(Boolean);
  const area = useRef(null);
  const sizing = useRef(null);
  const overflowSizer = useRef(null);
  const [visibleCount, setVisibleCount] = useState(metrics.length);
  const options = useDropdownNavigation("file-summary:metrics");
  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined" || !area.current || !sizing.current) return;
    const measure = () => {
      const width = area.current.getBoundingClientRect().width;
      const widths = Array.from(
        sizing.current.children,
        (child) => child.getBoundingClientRect().width
      );
      const gutter = parseFloat(getComputedStyle(sizing.current).columnGap) || 0;
      setVisibleCount(
        fitFileMetrics(width, widths, gutter, overflowSizer.current.getBoundingClientRect().width)
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(area.current);
    observer.observe(sizing.current);
    measure();
    return () => observer.disconnect();
  }, [metrics.length, preferences, report]);
  const visible = metrics.slice(0, visibleCount);
  const hidden = metrics.slice(visibleCount);
  const overflow = useDropdownNavigation(hidden.length ? "file-summary:overflow" : null);
  return (
    <div className="flex min-w-0 flex-1 items-center justify-end gap-[var(--ui-header-action-gap)]">
      <div
        ref={area}
        className={cn("relative flex min-w-0 flex-1 items-center justify-end", metricGap)}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none invisible absolute right-0 flex w-max flex-col"
        >
          <div ref={sizing} className={cn("flex w-max", metricGap)}>
            {metrics.map((metric) => (
              <MetricColumn key={metric.id} metric={metric} report={report} />
            ))}
          </div>
          <span ref={overflowSizer} className="inline-block w-[var(--ui-control-h)]" />
        </div>
        {visible.map((metric) => (
          <MetricTrigger key={metric.id} metric={metric} report={report} />
        ))}
        {hidden.length ? (
          <Popover {...overflow.rootProps}>
            <PopoverTrigger asChild>
              <Button
                variant="quiet"
                size="icon"
                {...overflow.triggerProps}
                aria-label={hidden.length + " more summary metrics"}
              >
                +{hidden.length}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="grid w-max max-h-[var(--radix-popover-content-available-height)] gap-1 overflow-auto p-2"
            >
              {hidden.map((metric) => (
                <MetricTrigger key={metric.id} metric={metric} report={report} suffix=":overflow" />
              ))}
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
      <Popover {...options.rootProps}>
        <HoverTip tip={options.rootProps.open ? "" : "Summary Metrics"} className="shrink-0">
          <PopoverTrigger asChild>
            <Button
              variant="quiet"
              size="icon"
              {...options.triggerProps}
              aria-label="summary metrics"
            >
              <SlidersHorizontal
                className="size-[length:var(--ui-icon-shell-action)]"
                aria-hidden="true"
              />
            </Button>
          </PopoverTrigger>
        </HoverTip>
        <PopoverContent
          align="end"
          className="max-h-[var(--radix-popover-content-available-height)] overflow-auto p-1"
        >
          <PanelSettingsHeader
            title="Summary Metrics"
            isDefault={JSON.stringify(preferences) === JSON.stringify(DEFAULT_METRICS)}
            onReset={() => onChange?.(DEFAULT_METRICS)}
          />
          <SortableStatsList
            label="Summary Metrics"
            options={FILE_METRICS}
            orderedIds={preferences.order}
            selectedIds={preferences.visible}
            onReorder={(order) => onChange?.({ ...preferences, order })}
            onToggle={(id) =>
              onChange?.({
                ...preferences,
                visible: preferences.visible.includes(id)
                  ? preferences.visible.filter((key) => key !== id)
                  : [...preferences.visible, id],
              })
            }
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function FileAnalysisSummary({
  fileSession,
  fileSessions = [],
  activeFileId,
  analyzingFileId,
  onSelectFile,
  onReanalyzeFile,
  onRemoveFile,
  onClearAllFiles,
  onStopFile,
  onExportReport,
  onCopyReport,
  onExportStatistics = null,
  currentSettings = null,
  fileTaskBusy = false,
  summaryMetrics = DEFAULT_METRICS,
  onSummaryMetricsChange = null,
}) {
  const result = useMemo(() => getSuccessfulFileSession(fileSession), [fileSession]);
  const report = useMemo(() => (result ? buildFileAnalysisReport(result) : null), [result]);
  const display = result ?? fileSession;
  const fileName = display?.fileName ?? "No File";
  const activeTask = Boolean(analyzingFileId && analyzingFileId === activeFileId);
  const details = warningDetails(fileSession, result, currentSettings, activeTask);
  const activityOnly = activeTask && result && details.length === 1;
  const WarningIcon = activityOnly ? LoaderCircle : CircleAlert;
  const track = display?.metadata?.selectedTrack;
  const summary = display?.summary;
  const duration = summary?.durationMs ?? display?.metadata?.durationMs;
  const metadata = [
    formatChannelLayout(
      summary?.channels ?? track?.channels,
      summary?.loudnessLayout ?? track?.channelLayout
    ),
    formatSampleRate(summary?.sampleRateHz ?? track?.sampleRateHz),
    formatDepth(track),
    Number.isFinite(duration) ? formatClock(duration) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      aria-label="File Summary"
      className={cn(
        "flex w-full min-w-0 items-center bg-[color:var(--ui-surface-panel)] py-[var(--ui-shell-pad)] text-[length:var(--ui-fs-control)]",
        inlineGap,
        SHELL_SURFACE_BASE
      )}
    >
      <div
        className={cn(
          "flex w-[min(40%,var(--ui-surface-compact-w))] min-w-0 shrink-0 items-center",
          inlineGap
        )}
      >
        <FileAnalysisHistoryMenu
          {...{
            fileSessions,
            activeFileId,
            analyzingFileId,
            fileTaskBusy,
            onSelectFile,
            onReanalyzeFile,
            onRemoveFile,
            onClearAllFiles,
            onStopFile,
            onExportReport,
            onCopyReport,
            onExportStatistics,
          }}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-[var(--ui-control-h)] min-w-0 items-center">
            <span className="truncate font-semibold text-foreground">{fileName}</span>
            {details.length ? (
              <FileDetailPopover
                label={activityOnly ? "analysis activity" : "file analysis warning"}
                target="file-summary:warning"
                className={cn(
                  detailButton,
                  !activityOnly && "text-[color:var(--ui-feedback-warning)]"
                )}
                trigger={
                  <WarningIcon
                    className={cn(icon, activityOnly && "motion-safe:animate-spin")}
                    aria-hidden="true"
                  />
                }
              >
                <ul className="grid gap-[var(--ui-drawer-row-gap)]">
                  {details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              </FileDetailPopover>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center text-[length:var(--ui-fs-caption)] text-muted-foreground">
            <span className="truncate">{metadata || "No Media Metadata"}</span>
            <FileDetailPopover
              label="file details"
              target="file-summary:details"
              className={detailButton}
              trigger={<Info className={icon} aria-hidden="true" />}
            >
              <FileInfo session={display} />
            </FileDetailPopover>
          </div>
        </div>
      </div>
      <SummaryMetrics
        preferences={summaryMetrics}
        onChange={onSummaryMetricsChange}
        report={report}
      />
    </section>
  );
}
