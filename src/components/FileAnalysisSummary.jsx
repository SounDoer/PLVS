import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, Info, LoaderCircle, SlidersHorizontal } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.jsx";
import { Button } from "./ui/button.jsx";
import { FileAnalysisHistoryMenu } from "./FileAnalysisHistoryMenu.jsx";
import { HoverTip } from "./HoverTip.jsx";
import { FileDetailPopover } from "./FileDetailPopover.jsx";
import { MiddleTruncatedText } from "./MiddleTruncatedText.jsx";
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
import { DIALOGUE_VAD_ENGINE_OPTIONS } from "../lib/dialogueVadEngines.js";

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
  const dialogue = session.analysisSettings?.dialogue;
  const detector = DIALOGUE_VAD_ENGINE_OPTIONS.find(({ id }) => id === dialogue?.engine);
  const details = [
    ["Path", session.path ?? metadata.path],
    ["Container", formatContainer(metadata.container)],
    ["Track", track && formatTrackLabel(track)],
    ["Track Name", track?.title],
    ["Source Layout", track?.channelLayout],
    [
      "Dialogue Detection",
      summary && dialogue
        ? dialogue.enabled
          ? (detector?.label ?? dialogue.engine)
          : "Off"
        : null,
    ],
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

function DetailReading({ value, unit }) {
  return (
    <span className="whitespace-nowrap">
      <span className="font-[family-name:var(--ui-font-mono)] tabular-nums text-foreground">
        {value ?? NO_MEASUREMENT}
      </span>
      {value != null && (
        <>
          {" "}
          <span className={METRIC_ANNOTATION}>{unit}</span>
        </>
      )}
    </span>
  );
}

function detailSeconds(seconds) {
  return seconds.toFixed(3);
}

function DetailPosition({ location }) {
  const time = Number.isFinite(location?.timeSeconds) ? detailSeconds(location.timeSeconds) : null;
  return (
    <>
      <DetailReading value={time} unit="s" />
      {time != null && location.framePosition < 0 && (
        <span className={METRIC_ANNOTATION}> · Before Start</span>
      )}
    </>
  );
}

function loudestRange(metricId, position, sampleRateHz) {
  if (!Number.isFinite(position?.timeSeconds)) return null;
  // The meter counts four or thirty blocks of rounded 100 ms frames.
  const blocks = metricId === "momentaryMax" ? 4 : 30;
  const startSeconds =
    sampleRateHz > 0 && Number.isFinite(position.framePosition)
      ? (position.framePosition - blocks * Math.max(1, Math.round(sampleRateHz / 10))) /
        sampleRateHz
      : position.timeSeconds - blocks / 10;
  const start = detailSeconds(Math.max(0, startSeconds));
  return start + "–" + detailSeconds(position.timeSeconds);
}

function MetricDetail({ metric, report }) {
  const value = report?.summary[metric.field];
  const reason = report?.unavailableReasons?.[metric.field];
  const position = metric.location && report?.summary.maximaLocations?.[metric.location];
  const peak = metric.id === "truePeak" || metric.id === "samplePeakMax";
  const range = peak ? null : loudestRange(metric.id, position, report?.summary.sampleRateHz);
  const timeKey = metric.id === "truePeak" ? "truePeakMaxLocation" : "samplePeakMaxLocation";
  const reasonKey =
    metric.id === "truePeak" ? "truePeakMaxUnavailableReason" : "samplePeakMaxUnavailableReason";
  return (
    <div className="grid gap-[var(--ui-drawer-row-gap)]">
      <p className="flex items-baseline justify-between gap-x-[var(--ui-metric-inline-gap)]">
        <span className={cn("font-medium", METRIC_ANNOTATION)}>{metric.label}</span>{" "}
        <span className="shrink-0 text-right">
          <DetailReading
            value={Number.isFinite(value) ? metricNumber(metric, value) : null}
            unit={metric.unit}
          />
        </span>
      </p>
      {!report || reason ? (
        <p className="text-muted-foreground">
          {FILE_UNAVAILABLE_EXPLANATIONS[reason] ?? "No completed measurement yet."}
        </p>
      ) : null}
      {metric.location ? (
        <p className="flex items-baseline justify-between gap-x-[var(--ui-metric-inline-gap)]">
          <span className={METRIC_ANNOTATION}>{peak ? "First Maximum" : "Loudest Range"}</span>{" "}
          <span className="text-right">
            {peak ? (
              <DetailPosition location={position} />
            ) : (
              <DetailReading value={range} unit="s" />
            )}
          </span>
        </p>
      ) : null}
      {peak && report?.summary.channelPeaks.length ? (
        <table className="w-full text-left tabular-nums">
          <thead>
            <tr>
              <th scope="col" className={cn("pr-2 font-medium", METRIC_ANNOTATION)}>
                Channel
              </th>
              <th scope="col" className={cn("pr-2 text-right font-medium", METRIC_ANNOTATION)}>
                Maximum
              </th>
              <th scope="col" className={cn("text-right font-medium", METRIC_ANNOTATION)}>
                Time
              </th>
            </tr>
          </thead>
          <tbody>
            {report.summary.channelPeaks.map((row) => (
              <tr key={row.channelIndex}>
                <td className="pr-2 text-foreground">{row.label}</td>
                <td
                  className="pr-2 text-right"
                  title={FILE_UNAVAILABLE_EXPLANATIONS[row[reasonKey]]}
                >
                  <DetailReading
                    value={
                      Number.isFinite(row[metric.field])
                        ? metricNumber(metric, row[metric.field])
                        : null
                    }
                    unit={metric.unit}
                  />
                </td>
                <td className="text-right">
                  <DetailPosition location={row[timeKey]} />
                </td>
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
    <span className="flex w-max min-w-max flex-col items-start -my-1 px-[var(--ui-shell-pad)] py-1 whitespace-nowrap">
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

function MetricTrigger({ metric, report, inOverflow = false }) {
  const value = report?.summary[metric.field];
  const available = Number.isFinite(value);
  return (
    <FileDetailPopover
      label={metric.label + " details"}
      target={"file-metric:" + metric.id + (inOverflow ? ":overflow" : "")}
      className={cn(
        "shrink-0 text-left hover:bg-ui-hover",
        inOverflow &&
          "col-span-3 grid min-h-[var(--ui-control-h)] grid-cols-subgrid items-baseline gap-x-[var(--ui-metric-inline-gap)] px-2"
      )}
      trigger={
        inOverflow ? (
          <>
            <span className={cn("min-w-0 truncate", METRIC_ANNOTATION)}>{metric.label}</span>
            <span className="text-right font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-fs-metric-value)] font-semibold tabular-nums text-foreground">
              {available ? metricNumber(metric, value) : NO_MEASUREMENT}
            </span>
            <span className={cn("text-right", METRIC_ANNOTATION)}>
              {available ? metric.unit : ""}
            </span>
          </>
        ) : (
          <MetricColumn metric={metric} report={report} />
        )
      }
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
        width >= sizing.current.getBoundingClientRect().width
          ? widths.length
          : fitFileMetrics(
              width,
              widths,
              gutter,
              overflowSizer.current.getBoundingClientRect().width
            )
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
    <div className="ml-auto flex min-w-0 items-center gap-[var(--ui-header-action-gap)]">
      <div ref={area} className="relative flex min-w-0 flex-auto justify-end">
        {/* Reserve the natural width of all selected metrics before the filename grows. */}
        <div aria-hidden="true" className="pointer-events-none invisible shrink-0">
          <div ref={sizing} className={cn("flex w-max", metricGap)}>
            {metrics.map((metric) => (
              <MetricColumn key={metric.id} metric={metric} report={report} />
            ))}
          </div>
          <span ref={overflowSizer} className="absolute w-[var(--ui-control-h)]" />
        </div>
        <div className={cn("absolute inset-0 flex items-center justify-end", metricGap)}>
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
                className="grid w-max max-h-[var(--radix-popover-content-available-height)] grid-cols-[minmax(0,1fr)_max-content_max-content] gap-x-[var(--ui-metric-inline-gap)] overflow-auto p-1"
              >
                {hidden.map((metric) => (
                  <MetricTrigger key={metric.id} metric={metric} report={report} inOverflow />
                ))}
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
      </div>
      <Popover {...options.rootProps}>
        <HoverTip
          tip={options.rootProps.open ? "" : "Summary Metrics"}
          showOnFocus={false}
          className="shrink-0"
        >
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
          className="w-max min-w-[12em] max-w-[min(var(--ui-surface-compact-w),92vw)] max-h-[var(--radix-popover-content-available-height)] overflow-auto p-1 text-[length:var(--ui-fs-control)]"
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
          // Grows into width the metrics leave unused; never shrinks below the old fixed width.
          "flex max-w-max min-w-[min(40%,var(--ui-surface-compact-w))] flex-[1_1_0px] items-center",
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
            <MiddleTruncatedText text={fileName} className="font-semibold text-foreground" />
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
          <div className="flex min-w-0 items-center text-[length:var(--ui-fs-caption)] text-muted-foreground [contain:inline-size]">
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
