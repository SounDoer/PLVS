/**
 * The dim behind a modal. Deliberately a constant, not a theme color: a scrim's
 * job is to darken whatever is behind it, and a value derived from the theme
 * inverts that on a light one -- the retired `effect.scrim` role computed a
 * near-white veil there. If this ever needs to follow the theme, what varies is
 * the opacity, never the color.
 *
 * Callers add their own stacking order, which differs by how deep the modal sits.
 */
export const SCRIM_CLASS = "fixed inset-0 bg-black/60";

export const WORKSPACE_SURFACE_CLASS = "bg-[color:var(--ui-surface-workspace)]";
export const PANEL_SURFACE_CLASS = "bg-[color:var(--ui-surface-panel)]";
export const DOCK_SURFACE_CLASS = "bg-[color:var(--ui-surface-dock)]";

export const POPOVER_SURFACE_CLASS =
  "rounded-md border border-border bg-popover text-popover-foreground shadow-raised outline-none";

export const POPOVER_HEADER_CLASS = "flex min-h-7 shrink-0 items-center gap-1 px-2 py-1";

export const POPOVER_TITLE_CLASS =
  "text-[length:var(--ui-fs-panel-title)] font-semibold text-foreground";

export const MODAL_SURFACE_BASE_CLASS = "border-border bg-card text-card-foreground shadow-modal";
export const MODAL_SURFACE_CLASS = `border ${MODAL_SURFACE_BASE_CLASS}`;
