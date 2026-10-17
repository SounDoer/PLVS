import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOCK_PAD_X, DOCK_PAD_Y, DOCK_STATS_ROW_GAP } from "./dockSizing.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const dockTokensCss = readFileSync(join(currentDir, "dockTokens.css"), "utf8");

describe("Dock spacing tokens", () => {
  it("uses one spacing set that the minimum-height calculation shares", () => {
    expect(dockTokensCss).toContain(`--ui-dock-pad-x: ${DOCK_PAD_X}px;`);
    expect(dockTokensCss).toContain(`--ui-dock-pad-y: ${DOCK_PAD_Y}px;`);
    expect(dockTokensCss).toContain(`--ui-dock-gap-row: ${DOCK_STATS_ROW_GAP}px;`);
    expect(dockTokensCss).not.toMatch(/@media \((min|max)-height/);
  });
});
