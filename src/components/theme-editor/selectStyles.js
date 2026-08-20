/**
 * The Theme Editor's dropdowns. Same primitive and the same look as the Settings
 * drawer's, sized for the editor's denser rows: `--ui-fs-metric-meta` instead of
 * `--ui-fs-display`, and a fixed height so a row does not grow when its dropdown
 * carries a long preset name.
 */
export const EDITOR_SELECT_TRIGGER_CLASS =
  "h-7 w-auto shrink-0 gap-1 rounded-md border border-input bg-transparent px-2 py-0 text-[length:var(--ui-fs-metric-meta)] shadow-none outline-none transition-colors hover:bg-muted/50";

export const EDITOR_SELECT_CONTENT_CLASS =
  "border-border/50 min-w-[var(--radix-select-trigger-width)] [&_[data-slot=select-item]]:py-1 [&_[data-slot=select-item]]:pr-6 [&_[data-slot=select-item]]:pl-2 [&_[data-slot=select-item]]:text-[length:var(--ui-fs-metric-meta)]";
