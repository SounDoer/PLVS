import { normalizeThemeDocumentShape } from "../themeSchema.js";

/** Adopt shared History data roles while preserving every authored module exception. */
export function migrateThemeSemantics4(raw) {
  if (raw?.formatVersion !== 2 || raw?.semanticsVersion !== 4) return null;
  const overrides = structuredClone(raw.overrides ?? {});
  for (const key of ["safe", "warning", "critical"]) {
    const roleId = `level.${key}`;
    const override = overrides[roleId];
    if (
      (override?.kind === "color" && override.value === raw.palettes?.status?.[key]) ||
      (override?.kind === "reference" && override.source === `palette.status.${key}`)
    ) {
      delete overrides[roleId];
    }
  }
  return normalizeThemeDocumentShape({ ...raw, semanticsVersion: 5, overrides });
}
