import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const settingsWidgets = readFileSync(
  new URL("./panel-settings/SettingsWidgets.jsx", import.meta.url),
  "utf8"
);
const statsPanel = readFileSync(new URL("./panels/StatsPanel.jsx", import.meta.url), "utf8");

describe("text baseline contract", () => {
  it("aligns panel-setting numbers with their unit suffixes", () => {
    expect(settingsWidgets).toContain('className="flex min-w-0 items-baseline gap-1"');
  });

  it("aligns Stats labels, values, and units while keeping the activity dot centered", () => {
    expect(statsPanel).toContain(
      '"flex min-h-[var(--ui-metric-row-min-h)] items-baseline gap-[var(--ui-metric-row-gap)]'
    );
    expect(statsPanel).toContain(
      'className="flex shrink-0 items-baseline gap-[var(--ui-metric-row-gap)]"'
    );
    expect(statsPanel).toContain(
      '"inline-block h-1.5 w-1.5 shrink-0 self-center rounded-full border"'
    );
  });
});
