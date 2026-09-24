export function ThemeEditorSwatch({ color, label }) {
  return (
    <span
      aria-hidden={label ? undefined : "true"}
      aria-label={label}
      className="size-5 shrink-0 rounded-xs border border-border"
      style={{ backgroundColor: color }}
    />
  );
}
