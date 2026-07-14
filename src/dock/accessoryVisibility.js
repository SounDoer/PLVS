export function shouldShowDockHeader({
  stripInside,
  headerInside,
  editorOpen,
  forceVisible = false,
}) {
  return stripInside || headerInside || editorOpen || forceVisible;
}
