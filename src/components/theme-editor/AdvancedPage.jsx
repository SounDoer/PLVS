import { useMemo } from "react";
import { ColorControl } from "../ColorControl.jsx";
import { compileTheme } from "../../theme/compileTheme.js";
import { THEME_ROLE_REGISTRY } from "../../theme/themeRoleRegistry.js";

const REFERENCE_LABELS = {
  "core.text": "Follow Text",
  "core.primaryData": "Follow Primary Data",
  "core.secondaryData": "Follow Secondary Data",
  "palette.frequency.low": "Follow Frequency Low",
  "palette.frequency.mid": "Follow Frequency Mid",
  "palette.frequency.high": "Follow Frequency High",
};

const ADVANCED_SECTIONS = Object.entries(
  THEME_ROLE_REGISTRY.filter((role) => role.advanced).reduce((sections, role) => {
    (sections[role.advanced.section] ??= []).push(role);
    return sections;
  }, {})
);

function resolvedColor(value) {
  return typeof value === "string" ? value : value.color;
}

function selectedMode(override) {
  if (!override) return "auto";
  if (override.kind === "reference") return `reference:${override.source}`;
  return "custom";
}

function makeCustomOverride(role, resolved) {
  if (role.advanced.allowedModes.includes("effect")) {
    return {
      kind: "effect",
      color: resolvedColor(resolved),
      opacity: typeof resolved === "string" ? 1 : resolved.opacity,
    };
  }
  return { kind: "color", value: resolvedColor(resolved) };
}

function AdvancedRole({ role, override, resolved, onOverride }) {
  const mode = selectedMode(override);
  const customColor = override?.kind === "effect" ? override.color : override?.value;

  return (
    <div className="flex flex-col gap-1 border-t border-border/60 py-2 first:border-t-0">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="size-4 shrink-0 rounded-sm border border-border"
          style={{ backgroundColor: resolvedColor(resolved) }}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[length:var(--ui-fs-metric-meta)] font-medium">
            {role.advanced.label}
          </div>
          <p className="text-[length:var(--ui-fs-metric-meta)] leading-tight text-muted-foreground">
            {role.advanced.description}
          </p>
        </div>
        <select
          aria-label={`${role.advanced.label} mode`}
          value={mode}
          onChange={(event) => {
            const value = event.target.value;
            if (value === "auto") onOverride(role.id, null);
            else if (value === "custom") onOverride(role.id, makeCustomOverride(role, resolved));
            else onOverride(role.id, { kind: "reference", source: value.slice(10) });
          }}
          className="h-7 max-w-36 rounded-md border border-input bg-transparent px-2 text-[length:var(--ui-fs-metric-meta)]"
        >
          <option value="auto">Auto</option>
          {role.advanced.references.map((reference) => (
            <option key={reference} value={`reference:${reference}`}>
              {REFERENCE_LABELS[reference] ?? `Follow ${reference}`}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </div>
      {mode === "custom" ? (
        <div className="ml-6 flex items-center gap-3">
          <ColorControl
            label={`${role.advanced.label} Color`}
            value={customColor ?? resolvedColor(resolved)}
            onChange={(color) =>
              onOverride(
                role.id,
                override?.kind === "effect"
                  ? { ...override, color }
                  : { kind: "color", value: color }
              )
            }
            allowAlpha={false}
          />
          {override?.kind === "effect" ? (
            <label className="flex min-w-0 flex-1 items-center gap-2 text-[length:var(--ui-fs-metric-meta)] text-muted-foreground">
              Opacity
              <input
                aria-label={`${role.advanced.label} opacity`}
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={override.opacity}
                onChange={(event) =>
                  onOverride(role.id, { ...override, opacity: Number(event.target.value) })
                }
                className="plvs-range min-w-0 flex-1"
              />
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AdvancedPage({ draft, onOverride }) {
  const resolved = useMemo(() => compileTheme(draft), [draft]);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[length:var(--ui-fs-metric-meta)] text-muted-foreground">
        Keep roles on Auto unless one specific part of the app should differ from the theme.
      </p>
      {ADVANCED_SECTIONS.map(([section, roles]) => (
        <details
          key={section}
          className="rounded-md border border-border"
          open={section === "Interface"}
        >
          <summary className="cursor-pointer select-none px-2 py-1.5 text-[length:var(--ui-fs-metric-meta)] font-semibold">
            {section}
          </summary>
          <div className="border-t border-border px-2">
            {roles.map((role) => (
              <AdvancedRole
                key={role.id}
                role={role}
                override={draft.overrides[role.id]}
                resolved={resolved.roles[role.id]}
                onOverride={onOverride}
              />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
