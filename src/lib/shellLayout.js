/**
 * Shared layout class strings for the main app shell and Tauri float window.
 * Uses Tailwind semantic tokens plus existing `--ui-*` layout variables from `uiPreferences`.
 */

export const SHELL_PAGE =
  "flex h-[100dvh] min-h-0 w-full flex-col overflow-hidden bg-background text-foreground";

export const SHELL_INNER =
  "mx-auto flex min-h-0 w-full max-w-[var(--ui-shell-max-w)] flex-1 flex-col gap-[var(--ui-shell-gap)] p-[var(--ui-shell-pad)] lg:gap-[var(--ui-shell-gap-lg)] lg:p-[var(--ui-shell-pad-lg)]";

export const SHELL_HEADER =
  "flex shrink-0 items-center gap-3 rounded-[calc(var(--ui-radius-card)*0.66)] border border-white/[0.08] bg-card/60 px-[var(--ui-header-pad-x)] py-[var(--ui-header-pad-y)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_1px_0_color-mix(in_srgb,var(--ui-color-border-default)_26%,transparent)] backdrop-blur-[14px] backdrop-saturate-[140%]";

export const SHELL_FOOTER =
  "flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--ui-radius-card)] border border-white/[0.08] bg-card/60 px-[var(--ui-footer-pad-x)] py-[var(--ui-footer-pad-y)] text-[length:var(--ui-fs-status)] leading-[1.35] text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-[14px] backdrop-saturate-[140%]";

export const APP_TITLE =
  "text-[length:var(--ui-fs-app-title)] font-[var(--ui-fw-app-title)] tracking-wide text-foreground";

export const APP_TITLE_BRAND = "text-primary";

/** Axis tick / caption text (replaces former `.ui-caption`). */
export const CAPTION_TEXT = "text-[length:var(--ui-fs-axis-value)] text-muted-foreground";

export const PANEL_MIN_PEAK = "min-h-[var(--ui-min-h-peak)]";
export const PANEL_MIN_HISTORY = "min-h-[var(--ui-min-h-history)]";
export const PANEL_MIN_SPECTRUM = "min-h-[var(--ui-min-h-spectrum)]";
export const PANEL_MIN_SPECTROGRAM = "min-h-[120px]";

export const W_PEAK_TICKS = "w-[var(--ui-w-peak-ticks)]";
export const W_LOUDNESS_Y_AXIS = "w-[var(--ui-w-loudness-y-axis)]";
export const W_SPECTRUM_Y_AXIS = "w-[var(--ui-w-spectrum-y-axis)]";

export const CHART_INSET_MIN_H = "min-h-[var(--ui-min-h-history-chart)]";

export const METRICS_LIST_PAD =
  "px-[var(--ui-article-pad-metrics)] pb-[var(--ui-article-pad-metrics)]";
