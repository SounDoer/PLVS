import { getThemeRole } from "./themeRoleRegistry.js";

function issue(code, path, message) {
  return { code, path, message };
}

/**
 * Validate public override intent against the current Role Registry. Shape and
 * color syntax belong to themeSchema/themeLibrary and are intentionally absent.
 */
export function validateThemeRegistryCompatibility(theme) {
  const issues = [];
  if (!theme?.overrides || typeof theme.overrides !== "object" || Array.isArray(theme.overrides)) {
    return issues;
  }
  for (const [roleId, override] of Object.entries(theme.overrides)) {
    if (!override || typeof override !== "object" || Array.isArray(override)) continue;
    const path = `$.overrides.${roleId}`;
    const role = getThemeRole(roleId);
    if (!role) {
      issues.push(issue("unknownRole", path, `Unknown Theme role: ${roleId}.`));
      continue;
    }
    if (!role.advanced || !role.advanced.allowedModes.includes(override.kind)) {
      issues.push(
        issue(
          "overrideNotAllowed",
          `${path}.kind`,
          `Override kind ${override.kind} is not allowed for ${roleId}.`
        )
      );
    }
    if (
      override.kind === "reference" &&
      typeof override.source === "string" &&
      !role.advanced?.references.includes(override.source)
    ) {
      issues.push(
        issue(
          "incompatibleReference",
          `${path}.source`,
          `Reference ${override.source} is not compatible with ${roleId}.`
        )
      );
    }
  }
  return issues;
}
