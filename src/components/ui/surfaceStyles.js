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

export const POPOVER_SURFACE_CLASS =
  "rounded-md border border-border bg-popover text-popover-foreground shadow-md outline-none";

export const PANEL_SETTINGS_SURFACE_CLASS = "rounded-md border-border/70 bg-popover/95 shadow-sm";
