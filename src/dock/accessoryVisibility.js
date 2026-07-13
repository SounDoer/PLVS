export const DOCK_ACCESSORY_HIDE_DELAY_MS = 300;

export function shouldShowDockHeader({ stripInside, headerInside, editorOpen }) {
  return stripInside || headerInside || editorOpen;
}
