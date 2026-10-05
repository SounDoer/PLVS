/**
 * The stacking order of everything that floats above the workspace, lowest first. Each surface
 * names its layer instead of picking a number, so a new one states what it must sit above.
 *
 * Within a layer, DOM order decides: a portal opened later paints over one opened earlier, which
 * is what lets a menu opened inside a dialog cover it without a layer of its own.
 *
 * Panels and the shell keep small local z values (below 50) for their own internal stacking; those
 * never compete with these layers and are not listed here. `layersContract.test.js` rejects a
 * z-index of 50 or more written anywhere else.
 */

/** Popovers, menus, tooltips, the Settings sheet, floating editors, drag previews, and dialogs. */
export const LAYER_FLOATING = "z-50";

/** A confirmation raised from a floating editor, which must cover that editor. */
export const LAYER_ABOVE_EDITOR = "z-[60]";

/** Surfaces that outrank an editor and its confirmation: Theme Preview, the crash report, transfer status. */
export const LAYER_PRIORITY = "z-[70]";

/** The cross-workbench Library conflict, which can interrupt anything the user had open. */
export const LAYER_CONFLICT = "z-[90]";

/** Passive indicators that stay visible over every surface, such as the recording mark. */
export const LAYER_INDICATOR = "z-[100]";
