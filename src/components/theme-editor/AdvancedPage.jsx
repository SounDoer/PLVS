import { useEffect, useId, useMemo, useState } from "react";
import { ChevronDown, RotateCcw, Search, TriangleAlert } from "lucide-react";
import { ColorControl } from "../ColorControl.jsx";
import { HoverTip } from "../HoverTip.jsx";
import { compileTheme } from "../../theme/compileTheme.js";
import { THEME_ROLE_REGISTRY } from "../../theme/themeRoleRegistry.js";
import { MODULE_CATALOG } from "../../workspace/moduleCatalog.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.jsx";
import { EDITOR_SELECT_CONTENT_CLASS, EDITOR_SELECT_TRIGGER_CLASS } from "./selectStyles.js";
import { ThemeEditorSwatch } from "./ThemeEditorSwatch.jsx";

const REFERENCE_LABELS = {
  "core.text": "Follow Text",
  "core.primaryData": "Follow Primary Data",
  "core.secondaryData": "Follow Secondary Data",
  "palette.status.safe": "Follow Status Safe",
  "palette.status.warning": "Follow Status Warning",
  "palette.status.critical": "Follow Status Critical",
  "palette.frequency.low": "Follow Frequency Low",
  "palette.frequency.mid": "Follow Frequency Mid",
  "palette.frequency.high": "Follow Frequency High",
};

const SECTION_ORDER = [
  "Interface",
  "Activity",
  ...Object.values(MODULE_CATALOG).map((module) => module.title),
];

const INTERFACE_GROUPS = ["Surfaces", "Text & Icons", "Feedback", "Contrast", "Effects"];

function interfaceGroup(roleId) {
  if (roleId.startsWith("interface.surface.")) return "Surfaces";
  if (roleId.startsWith("interface.text.")) return "Text & Icons";
  if (roleId.startsWith("interface.feedback.")) return "Feedback";
  if (roleId.startsWith("interface.content.")) return "Contrast";
  return "Effects";
}

const ADVANCED_SECTIONS = Object.entries(
  THEME_ROLE_REGISTRY.filter(
    (role) => role.advanced && role.advanced.editorVisible !== false
  ).reduce((sections, role) => {
    (sections[role.advanced.section] ??= []).push(role);
    return sections;
  }, {})
).sort(([first], [second]) => SECTION_ORDER.indexOf(first) - SECTION_ORDER.indexOf(second));

function resolvedColor(value) {
  return typeof value === "string" ? value : value.color;
}

function selectedMode(override) {
  if (!override) return "auto";
  if (override.kind === "reference") return `reference:${override.source}`;
  return "custom";
}

function AdvancedRole({ role, override, resolved, onOverride, warnings }) {
  const mode = selectedMode(override);
  const descriptionId = useId();
  const warningText = warnings.map((item) => item.message).join(" ");

  return (
    <div
      data-theme-target={role.id}
      className="flex flex-col gap-1 border-t border-border/60 py-2 first:border-t-0"
    >
      <HoverTip
        tip={role.advanced.description}
        side="right"
        align="start"
        className="flex items-center gap-2"
        tipClassName="w-max max-w-64 whitespace-normal"
      >
        <ThemeEditorSwatch color={resolvedColor(resolved)} />
        <div className="min-w-0 flex-1 truncate text-[length:var(--ui-fs-metric-meta)] font-medium">
          {role.advanced.label}
        </div>
        {warnings.length ? (
          <HoverTip tip={warningText} side="top" tipClassName="w-max max-w-72 whitespace-normal">
            <TriangleAlert
              aria-label={`${warnings.length} visual warning${warnings.length === 1 ? "" : "s"}`}
              className="size-[length:var(--ui-icon-management-action)] text-[color:var(--ui-feedback-warning)]"
            />
          </HoverTip>
        ) : null}
        <Select
          value={mode}
          onValueChange={(value) => {
            if (value === "auto") onOverride(role.id, null);
            else if (value === "custom") {
              onOverride(role.id, { kind: "color", value: resolvedColor(resolved) });
            } else onOverride(role.id, { kind: "reference", source: value.slice(10) });
          }}
        >
          <SelectTrigger
            aria-label={`${role.advanced.label} mode`}
            aria-describedby={descriptionId}
            className={`${EDITOR_SELECT_TRIGGER_CLASS} max-w-36`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className={EDITOR_SELECT_CONTENT_CLASS}>
            <SelectItem value="auto">Auto</SelectItem>
            {role.advanced.references.map((reference) => (
              <SelectItem key={reference} value={`reference:${reference}`}>
                {REFERENCE_LABELS[reference] ?? `Follow ${reference}`}
              </SelectItem>
            ))}
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>
        <span id={descriptionId} className="sr-only">
          {role.advanced.description}
        </span>
      </HoverTip>
      {mode === "custom" ? (
        <div className="ml-7 flex items-center gap-3">
          <ColorControl
            label={`${role.advanced.label} Color`}
            description={role.advanced.description}
            value={override?.value ?? resolvedColor(resolved)}
            onChange={(color) => onOverride(role.id, { kind: "color", value: color })}
            allowAlpha={false}
          />
        </div>
      ) : null}
    </div>
  );
}

function SectionRoles({ section, roles, roleProps }) {
  if (section !== "Interface") {
    return roles.map((role) => <AdvancedRole key={role.id} role={role} {...roleProps(role)} />);
  }

  return INTERFACE_GROUPS.map((group) => {
    const grouped = roles.filter((role) => interfaceGroup(role.id) === group);
    if (!grouped.length) return null;
    return (
      <div key={group}>
        <div className="border-t border-border px-1 pt-2 pb-1 text-[length:var(--ui-fs-axis)] font-semibold tracking-wide text-muted-foreground uppercase first:border-t-0">
          {group}
        </div>
        {grouped.map((role) => (
          <AdvancedRole key={role.id} role={role} {...roleProps(role)} />
        ))}
      </div>
    );
  });
}

export function AdvancedPage({
  draft,
  onOverride,
  onResetOverrides,
  warnings = [],
  focusRoleId,
  onFocusHandled,
}) {
  const resolved = useMemo(() => compileTheme(draft), [draft]);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(() => new Set(["Interface"]));
  const normalizedQuery = query.trim().toLowerCase();

  useEffect(() => {
    if (!focusRoleId) return;
    const role = THEME_ROLE_REGISTRY.find((entry) => entry.id === focusRoleId);
    if (!role?.advanced) return;
    setQuery("");
    setExpanded((current) => new Set([...current, role.advanced.section]));
    requestAnimationFrame(() => {
      document.querySelector(`[data-theme-target="${focusRoleId}"]`)?.scrollIntoView?.({
        block: "center",
      });
      onFocusHandled?.();
    });
  }, [focusRoleId, onFocusHandled]);

  const warningsByRole = useMemo(() => {
    const map = new Map();
    for (const item of warnings) {
      for (const roleId of item.roleIds) {
        const list = map.get(roleId) ?? [];
        list.push(item);
        map.set(roleId, list);
      }
    }
    return map;
  }, [warnings]);

  const hasMatches = ADVANCED_SECTIONS.some(([section, roles]) =>
    roles.some((role) =>
      [section, role.id, role.advanced.label, role.advanced.description]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    )
  );

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[length:var(--ui-fs-metric-meta)] text-muted-foreground">
        Keep roles on Auto unless one specific part of the app should differ from the theme.
      </p>
      <label className="flex items-center gap-2 rounded-md border border-input px-2 py-1.5 text-muted-foreground">
        <Search className="size-[length:var(--ui-icon-management-action)]" aria-hidden="true" />
        <input
          type="search"
          aria-label="Search Advanced roles"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search roles"
          className="min-w-0 flex-1 bg-transparent text-[length:var(--ui-fs-metric-meta)] text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>
      {ADVANCED_SECTIONS.map(([section, sectionRoles]) => {
        const roles = normalizedQuery
          ? sectionRoles.filter((role) =>
              [section, role.id, role.advanced.label, role.advanced.description]
                .join(" ")
                .toLowerCase()
                .includes(normalizedQuery)
            )
          : sectionRoles;
        if (!roles.length) return null;
        const isExpanded = normalizedQuery ? true : expanded.has(section);
        const customized = sectionRoles.filter((role) => draft.overrides[role.id]).length;
        const sectionWarnings = warnings.filter((item) =>
          item.roleIds.some((roleId) => sectionRoles.some((role) => role.id === roleId))
        ).length;
        const roleProps = (role) => ({
          override: draft.overrides[role.id],
          resolved: resolved.roles[role.id],
          onOverride,
          warnings: warningsByRole.get(role.id) ?? [],
        });
        return (
          <section key={section} className="rounded-md border border-border">
            <div className="flex items-center gap-1 px-2 py-1.5">
              <button
                type="button"
                aria-label={section}
                aria-expanded={isExpanded}
                onClick={() =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(section)) next.delete(section);
                    else next.add(section);
                    return next;
                  })
                }
                className="flex min-w-0 flex-1 items-center gap-1 text-left text-[length:var(--ui-fs-metric-meta)] font-semibold"
              >
                <ChevronDown
                  className={`size-[length:var(--ui-icon-management-action)] transition-transform ${isExpanded ? "" : "-rotate-90"}`}
                />
                <span className="truncate">{section}</span>
                {customized ? (
                  <span className="rounded-full bg-muted px-1.5 text-[length:var(--ui-fs-axis)] text-muted-foreground">
                    {customized} Custom
                  </span>
                ) : null}
                {sectionWarnings ? (
                  <span className="inline-flex items-center gap-0.5 text-[length:var(--ui-fs-axis)] text-[color:var(--ui-feedback-warning)]">
                    <TriangleAlert className="size-[1em]" /> {sectionWarnings}
                  </span>
                ) : null}
              </button>
              {customized ? (
                <button
                  type="button"
                  onClick={() => onResetOverrides(sectionRoles.map((role) => role.id))}
                  className="inline-flex items-center gap-1 rounded-xs px-1.5 py-1 text-[length:var(--ui-fs-axis)] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                >
                  <RotateCcw className="size-[1em]" /> Reset Section to Auto
                </button>
              ) : null}
            </div>
            {isExpanded ? (
              <div className="border-t border-border px-2">
                <SectionRoles section={section} roles={roles} roleProps={roleProps} />
              </div>
            ) : null}
          </section>
        );
      })}
      {normalizedQuery && !hasMatches ? (
        <p className="py-4 text-center text-[length:var(--ui-fs-metric-meta)] text-muted-foreground">
          No Advanced roles match “{query}”.
        </p>
      ) : null}
    </div>
  );
}
