export function shouldShowDockHeader({ userOpen, editorOpen, forceVisible = false }) {
  return userOpen || editorOpen || forceVisible;
}
