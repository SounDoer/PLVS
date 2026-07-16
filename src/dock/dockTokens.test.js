import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOCK_EXPANDED_MIN_HEIGHT } from "./dockSizing.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const dockTokensCss = readFileSync(join(currentDir, "dockTokens.css"), "utf8");

describe("Dock typography density tokens", () => {
  it("enters the expanded typography tier at the shared expanded height", () => {
    expect(dockTokensCss).toContain(`@media (min-height: ${DOCK_EXPANDED_MIN_HEIGHT}px)`);
  });
});
