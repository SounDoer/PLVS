import { normalizeThemeDocumentShape } from "../themeSchema.js";

/**
 * Adopt the redesigned automatic data-state and interface-feedback relationships.
 * Explicit Advanced overrides retain their authored values; Auto roles resolve through
 * the Semantics 4 registry after migration.
 */
/**
 * Adopt the redesigned automatic data-state and interface-feedback relationships.
 * Explicit Advanced overrides retain their authored values; Auto roles resolve through
 * the Semantics 4 registry after migration.
 */
export function migrateThemeSemantics3(raw) {
  if (raw?.formatVersion !== 2 || raw?.semanticsVersion !== 3) return null;
  return normalizeThemeDocumentShape({ ...raw, semanticsVersion: 4 });
}
