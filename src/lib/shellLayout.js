/**
 * Shared layout class strings for the main app shell.
 * Uses Tailwind semantic tokens plus existing `--ui-*` layout variables from `uiPreferences`.
 */

export const SHELL_PAGE =
  "flex h-[100dvh] min-h-0 w-full flex-col overflow-hidden bg-background text-foreground";

export const SHELL_INNER =
  "flex min-h-0 w-full flex-1 select-none flex-col gap-[var(--ui-shell-gap)] p-[var(--ui-shell-pad)]";

export const SHELL_INNER_FOCUS =
  "relative flex min-h-0 w-full flex-1 select-none flex-col p-[var(--ui-shell-pad)]";

export const SHELL_SURFACE_BASE =
  "rounded-[calc(var(--radius)*0.66)] border px-[var(--ui-header-pad-x)] backdrop-blur-[14px] backdrop-saturate-[140%]";

export const SHELL_SURFACE_INSET_SHADOW = "shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]";

export const SHELL_SURFACE_SOFT_SHADOW =
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_1px_0_rgba(255,255,255,0.026)]";

export const SHELL_HEADER = `flex shrink-0 items-center gap-3 border-border bg-card/60 py-[var(--ui-header-pad-y)] z-10 ${SHELL_SURFACE_BASE} ${SHELL_SURFACE_SOFT_SHADOW}`;

export const SHELL_HEADER_OVERLAY = `absolute left-[var(--ui-shell-pad)] right-[var(--ui-shell-pad)] top-[var(--ui-shell-pad)] flex shrink-0 items-center gap-3 border-border bg-card/75 py-[var(--ui-header-pad-y)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_24px_rgba(0,0,0,0.18)] z-30 ${SHELL_SURFACE_BASE}`;

export const SHELL_HEADER_ACTIONS = "flex items-center gap-[var(--ui-header-action-gap)]";

export const SHELL_FOOTER =
  "flex shrink-0 overflow-hidden items-center gap-x-2 rounded-[var(--radius)] border border-border bg-card/60 px-[var(--ui-footer-pad-x)] py-[var(--ui-footer-pad-y)] text-[length:var(--ui-fs-status)] leading-[1.35] text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-[14px] backdrop-saturate-[140%]";

export const SHELL_FOOTER_OVERLAY =
  "absolute bottom-[var(--ui-shell-pad)] left-[var(--ui-shell-pad)] right-[var(--ui-shell-pad)] flex shrink-0 overflow-hidden items-center gap-x-2 rounded-[var(--radius)] border border-border bg-card/75 px-[var(--ui-footer-pad-x)] py-[var(--ui-footer-pad-y)] text-[length:var(--ui-fs-status)] leading-[1.35] text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_-8px_24px_rgba(0,0,0,0.14)] backdrop-blur-[14px] backdrop-saturate-[140%] z-30";

export const SHELL_TOP_REVEAL_HOT_ZONE = "absolute left-0 right-0 top-0 z-20 h-3 cursor-move";

export const SHELL_BOTTOM_REVEAL_HOT_ZONE = "absolute bottom-0 left-0 right-0 z-20 h-3";

export const PANEL_HEADER_BAR =
  "@container relative flex h-7 shrink-0 items-center gap-0.5 border-b border-border/60 bg-card px-1 text-xs font-medium";

export const PANEL_HEADER_ACTIONS = "ml-auto flex shrink-0 items-center gap-0.5 pl-1";

export const PANEL_HEADER_ACTION_BUTTON =
  "rounded p-0.5 text-muted-foreground opacity-50 hover:opacity-100 focus-visible:outline-none";

export const PANEL_HEADER_TITLE_GROUP =
  "@max-[80px]:hidden flex min-w-0 items-center gap-1 overflow-hidden px-1 py-0.5 text-xs font-medium";

export const FOOTER_LABEL =
  "text-[length:var(--ui-fs-status)] tracking-[0.06em] text-muted-foreground/60";

export const FOOTER_VALUE = "min-w-0 truncate tabular-nums text-muted-foreground";

export const FOOTER_DIVIDER = "mx-1.5 h-3 w-px shrink-0 bg-border";

/** Axis tick / caption text (replaces former `.ui-caption`). */
export const CAPTION_TEXT = "text-[length:var(--ui-fs-axis)] text-muted-foreground";

/**
 * Bottom metric line shared by panels whose chart area sits above an inline
 * metric (level meter, vectorscope). It mirrors the neighbouring charts' x-axis
 * row: same height, same axis gap above it, axis-sized text. When hidden in
 * narrow panes (`@max-[220px]`) it collapses entirely so the chart area expands
 * to align its bottom with the neighbours' x-axis bottom.
 */
export const PANEL_METRIC_FOOTER =
  "@max-[220px]:hidden mt-[var(--ui-chart-axis-gap)] flex h-[var(--ui-chart-x-axis-row-h)] shrink-0 items-start justify-center text-[length:var(--ui-fs-axis)]";

export const PANEL_MIN_PEAK = "min-h-[var(--ui-min-h-peak)]";
export const PANEL_MIN_HISTORY = "min-h-[var(--ui-min-h-history)]";
export const PANEL_MIN_SPECTRUM = "min-h-[var(--ui-min-h-spectrum)]";
export const PANEL_MIN_SPECTROGRAM = "min-h-[120px]";
export const PANEL_MIN_WAVEFORM = "min-h-[80px]";

export const W_PEAK_TICKS = "w-[var(--ui-w-axis-rail)]";
export const W_LOUDNESS_Y_AXIS = "w-[var(--ui-w-axis-rail)]";
export const W_SPECTRUM_Y_AXIS = "w-[var(--ui-w-axis-rail)]";

export const CHART_INSET_MIN_H = "min-h-[var(--ui-min-h-history-chart)]";

/** Horizontal layout rails (column resize) */
export const RESIZE_COL_CLASS =
  "hidden w-[var(--ui-splitter-bar-thickness)] cursor-col-resize justify-self-center rounded-[var(--radius)] opacity-0 transition-[opacity,background-color,box-shadow] duration-150 ease-out lg:block hover:opacity-100 active:opacity-100 hover:bg-[color-mix(in_srgb,var(--primary)_28%,var(--secondary))] hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_40%,transparent),0_0_14px_color-mix(in_srgb,var(--primary)_25%,transparent)] active:bg-[color-mix(in_srgb,var(--primary)_30%,var(--secondary))] active:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_45%,transparent),0_0_12px_color-mix(in_srgb,var(--primary)_24%,transparent)]";

/** Vertical layout rails (row resize) */
export const RESIZE_ROW_CLASS =
  "hidden h-[var(--ui-splitter-bar-thickness)] cursor-row-resize self-center rounded-[var(--radius)] opacity-0 transition-[opacity,background-color,box-shadow] duration-150 ease-out lg:block hover:opacity-100 active:opacity-100 hover:bg-[color-mix(in_srgb,var(--primary)_28%,var(--secondary))] hover:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_40%,transparent),0_0_14px_color-mix(in_srgb,var(--primary)_25%,transparent)] active:bg-[color-mix(in_srgb,var(--primary)_30%,var(--secondary))] active:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_45%,transparent),0_0_12px_color-mix(in_srgb,var(--primary)_24%,transparent)]";
