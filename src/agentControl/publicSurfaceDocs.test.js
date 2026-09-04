import { describe, expect, it } from "vitest";

import { DEFAULT_PANEL_CONTROLS } from "../lib/panelControls.js";
import { MODULE_CATALOG } from "../workspace/moduleCatalog.js";
import { buildAxisSchema } from "./axisControl.js";
import { buildPublicPanelControlSchema } from "./panelControlSchema.js";
import { readPublicPanelControls } from "./panelControls.js";
import { buildSettingsSchema } from "./settingsControl.js";

/**
 * The reference half of `docs/agent-control/` is written from the schema builders rather than by
 * hand, so it cannot drift from what the commands accept. The prose pages stay hand-written and
 * link here for the numbers.
 *
 * These are file snapshots: a change to the public surface fails this test, and
 * `npm run docs:agent-control` rewrites the pages.
 */

const BANNER =
  "<!-- Generated from the App Control schema builders by src/agentControl/publicSurfaceDocs.test.js.\n" +
  "     Do not edit by hand; run `npm run docs:agent-control` after changing the public surface. -->";

const escapeCell = (text) => text.replaceAll("|", "\\|");

const json = (value) => JSON.stringify(value);

function optionValue(option) {
  if (option === null || typeof option !== "object") return option;
  if ("value" in option) return option.value;
  if ("id" in option) return option.id;
  return option;
}

const optionList = (options) => options.map((o) => json(optionValue(o))).join(", ");

/** The one column a hand-written doc always got wrong: what a field actually accepts. */
function describeAllowed(field) {
  const parts = [];
  const options = field.options ? optionList(field.options) : null;
  if (options) parts.push(options);
  const items = field.items?.options ? optionList(field.items.options) : null;
  // An array usually repeats its own option list under `items`; only say it once.
  if (items && items !== options) parts.push(`each of ${items}`);
  if (field.uniqueItems) parts.push("unique");
  const min = field.minimum;
  const max = field.maximum ?? field.exclusiveMaximum;
  if (min !== undefined || max !== undefined) {
    const upper = field.exclusiveMaximum === undefined ? `${max}` : `<${field.exclusiveMaximum}`;
    parts.push(`${min ?? "-inf"} to ${max === undefined ? "inf" : upper}`);
  }
  if (field.required) parts.push(`requires ${field.required.join(", ")}`);
  for (const constraint of field.constraints ?? []) {
    if (constraint.kind === "ordered") parts.push(`${constraint.lower} < ${constraint.upper}`);
    else if (constraint.kind === "minimumSpan") parts.push(`span >= ${constraint.value}`);
    else if (constraint.kind === "includes") parts.push(`includes ${json(constraint.value)}`);
    else if (constraint.kind === "fullPermutation") parts.push("every id exactly once");
    else parts.push(constraint.kind);
  }
  if (field.suggestedStep !== undefined) parts.push(`step ${field.suggestedStep} (UI hint)`);
  return parts.join("; ") || "-";
}

function describeState(field) {
  if (field.effective === undefined) return "-";
  return field.effective ? "active" : `inactive (${field.inactiveReason ?? "unspecified"})`;
}

function fieldRows(properties, prefix = "") {
  const rows = [];
  for (const [name, field] of Object.entries(properties)) {
    rows.push(
      [
        `\`${prefix}${name}\``,
        field.type,
        field.unit ?? "-",
        field.default === undefined || field.properties
          ? "-"
          : `\`${escapeCell(json(field.default))}\``,
        escapeCell(describeAllowed(field)),
        describeState(field),
      ].join(" | ")
    );
    if (field.properties) rows.push(...fieldRows(field.properties, `${prefix}${name}.`));
  }
  return rows;
}

function table(properties) {
  return [
    "| Field | Type | Unit | Default | Allowed | In the default state |",
    "| --- | --- | --- | --- | --- | --- |",
    ...fieldRows(properties).map((row) => `| ${row} |`),
  ].join("\n");
}

function panelPage(moduleId) {
  const schema = buildPublicPanelControlSchema(moduleId, DEFAULT_PANEL_CONTROLS);
  const values = readPublicPanelControls(moduleId, DEFAULT_PANEL_CONTROLS);
  return [
    BANNER,
    "",
    `# ${MODULE_CATALOG[moduleId].title} — Public Controls`,
    "",
    `Module id \`${moduleId}\`. Rendered against panel-control defaults and the assumed stereo`,
    "topology PLVS reports before a device is known; channel choices widen with the real topology.",
    "",
    "## Defaults",
    "",
    "```json",
    JSON.stringify(values, null, 2),
    "```",
    "",
    "## Fields",
    "",
    table(schema.properties),
    "",
    "The last column is this field's availability while every control sits at its default. A field",
    "reported inactive still accepts a patch; the result carries a `currentlyInactive` warning.",
    "",
  ].join("\n");
}

function axesPage() {
  return [
    BANNER,
    "",
    "# Axis Control — Public Ranges",
    "",
    "One entry per linkable axis kind. `modules` lists the panels that participate in the kind.",
    "",
    "Time bounds are reported against the history a session has actually accumulated. The maxima",
    "below are the empty-history floor, which is why the offset maximum reads 0 here.",
    "",
    ...Object.entries(buildAxisSchema()).flatMap(([kindId, kind]) => [
      `## \`${kindId}\``,
      "",
      `${kind.description} Modules: ${kind.modules.map((id) => `\`${id}\``).join(", ")}.`,
      "",
      `Default: \`${json(kind.default)}\`. Patched atomically (\`${kind.patchMode}\`).`,
      "",
      table(kind.properties),
      "",
    ]),
  ].join("\n");
}

/** Public settings at their documented defaults; only the state-free half of the schema is shown. */
const SETTINGS_AT_DEFAULTS = {
  openAtLogin: false,
  closeBehavior: "ask",
  clearShortcut: { accelerator: "CmdOrCtrl+K", global: false },
  interfaceSize: "default",
  appearance: { mode: "system", themeId: null, resolvedThemeId: "plvs-dark" },
  historyRetentionSec: 3600,
  dialogueVadEngine: "firered",
  channelLabels: { channelCount: 2, mode: "auto", roles: ["L", "R"] },
};

function settingsPage() {
  const schema = buildSettingsSchema(SETTINGS_AT_DEFAULTS, {
    autostartReady: true,
    channelCount: 2,
    channelLabelMode: "auto",
    channelLabelRoles: ["L", "R"],
    themeOptions: ["<theme ids, from the theme library>"],
  });
  const withoutState = Object.fromEntries(
    Object.entries(schema).map(([name, field]) => [name, stripState(field)])
  );
  return [
    BANNER,
    "",
    "# Settings Control — Public Fields",
    "",
    "Current values and writability are runtime state and are reported by `settings.inspect`, not",
    "here. `appearance.resolvedThemeId` is read-only.",
    "",
    table(withoutState),
    "",
  ].join("\n");
}

function stripState(field) {
  const { current, availability, ...rest } = field;
  void current;
  void availability;
  if (rest.properties) {
    rest.properties = Object.fromEntries(
      Object.entries(rest.properties).map(([name, nested]) => [name, stripState(nested)])
    );
  }
  return rest;
}

describe("generated App Control reference", () => {
  it.each(Object.keys(MODULE_CATALOG))("documents the %s panel controls", async (moduleId) => {
    await expect(panelPage(moduleId)).toMatchFileSnapshot(
      `../../docs/agent-control/generated/panel-${moduleId}.md`
    );
  });

  it("documents the axis ranges", async () => {
    await expect(axesPage()).toMatchFileSnapshot("../../docs/agent-control/generated/axes.md");
  });

  it("documents the settings fields", async () => {
    await expect(settingsPage()).toMatchFileSnapshot(
      "../../docs/agent-control/generated/settings.md"
    );
  });
});
