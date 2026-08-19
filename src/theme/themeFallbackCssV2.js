/** Build deterministic first-paint CSS from a compiled Theme V2 CSS binding map. */
export function buildThemeFallbackCssV2(cssBindings, radiusCss) {
  const lines = [
    "/* AUTO-GENERATED — run `npm run theme:generate` after editing Theme V2 builtins */",
    "/* First-paint tokens compiled from plvs-dark; runtime republishes the active theme */",
    "",
    ":root {",
    `  --radius: ${radiusCss};`,
  ];
  for (const [name, value] of Object.entries(cssBindings)) lines.push(`  ${name}: ${value};`);
  lines.push("}", "");
  return lines.join("\n");
}
