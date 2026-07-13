export function shouldShowDockHeader({ stripInside, headerInside, editorOpen }) {
  return stripInside || headerInside || editorOpen;
}
