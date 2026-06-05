/**
 * Shared layout class strings for the main app shell.
 * Uses Tailwind semantic tokens plus existing `--ui-*` layout variables from `uiPreferences`.
 */

export const SHELL_PAGE =
  "flex h-[100dvh] min-h-0 w-full flex-col overflow-hidden bg-background text-foreground";

export const SHELL_INNER =
  "flex min-h-0 w-full flex-1 flex-col gap-[var(--ui-shell-gap)] p-[var(--ui-shell-pad)]";

export const SHELL_HEADER =
  "flex shrink-0 items-center gap-3 rounded-[calc(var(--radius)*0.66)] border border-border bg-card/60 px-[var(--ui-header-pad-x)] py-[var(--ui-header-pad-y)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_1px_0_rgba(255,255,255,0.026)] backdrop-blur-[14px] backdrop-saturate-[140%] z-10";

export const SHELL_FOOTER =
  "flex shrink-0 overflow-hidden items-center gap-x-2 rounded-[var(--radius)] border border-border bg-card/60 px-[var(--ui-footer-pad-x)] py-[var(--ui-footer-pad-y)] text-[length:var(--ui-fs-status)] leading-[1.35] text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-[14px] backdrop-saturate-[140%]";

export const APP_TITLE =
  "text-[length:var(--ui-fs-app-title)] font-[var(--ui-fw-app-title)] tracking-wide text-foreground";

export const APP_TITLE_BRAND = "text-primary";

/** Axis tick / caption text (replaces former `.ui-caption`). */
export const CAPTION_TEXT = "text-[length:var(--ui-fs-axis)] text-muted-foreground";

export const PANEL_MIN_PEAK = "min-h-[var(--ui-min-h-peak)]";
export const PANEL_MIN_HISTORY = "min-h-[var(--ui-min-h-history)]";
export const PANEL_MIN_SPECTRUM = "min-h-[var(--ui-min-h-spectrum)]";
export const PANEL_MIN_SPECTROGRAM = "min-h-[120px]";
export const PANEL_MIN_WAVEFORM = "min-h-[80px]";

export const W_PEAK_TICKS = "w-[var(--ui-w-peak-ticks)]";
export const W_LOUDNESS_Y_AXIS = "w-[var(--ui-w-loudness-y-axis)]";
export const W_SPECTRUM_Y_AXIS = "w-[var(--ui-w-spectrum-y-axis)]";

export const CHART_INSET_MIN_H = "min-h-[var(--ui-min-h-history-chart)]";

export const METRICS_LIST_PAD = "px-[var(--ui-panel-pad-metrics)] pb-[var(--ui-panel-pad-metrics)]";

/** Horizontal layout rails (column resize) */
export const RESIZE_COL_CLASS =
  "hidden w-[var(--ui-splitter-bar-thickness)] cursor-col-resize justify-self-center rounded-[var(--radius)] opacity-0 transition-[opacity,background-color,box-shadow] duration-150 ease-out lg:block hover:opacity-100 active:opacity-100 hover:bg-[color-mix(in_srgb,var(--primary)_28%,var(--secondary))] hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_40%,transparent),0_0_14px_color-mix(in_srgb,var(--primary)_25%,transparent)] active:bg-[color-mix(in_srgb,var(--primary)_30%,var(--secondary))] active:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_45%,transparent),0_0_12px_color-mix(in_srgb,var(--primary)_24%,transparent)]";

/** Vertical layout rails (row resize) */
export const RESIZE_ROW_CLASS =
  "hidden h-[var(--ui-splitter-bar-thickness)] cursor-row-resize self-center rounded-[var(--radius)] opacity-0 transition-[opacity,background-color,box-shadow] duration-150 ease-out lg:block hover:opacity-100 active:opacity-100 hover:bg-[color-mix(in_srgb,var(--primary)_28%,var(--secondary))] hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_40%,transparent),0_0_14px_color-mix(in_srgb,var(--primary)_25%,transparent)] active:bg-[color-mix(in_srgb,var(--primary)_30%,var(--secondary))] active:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_45%,transparent),0_0_12px_color-mix(in_srgb,var(--primary)_24%,transparent)]";
