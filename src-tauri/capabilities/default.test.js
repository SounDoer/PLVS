import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const capability = JSON.parse(readFileSync(join(currentDir, "default.json"), "utf8"));

describe("default Tauri capabilities", () => {
  it("allows Focus View to hide window decorations and drag frameless windows", () => {
    expect(capability.permissions).toContain("core:window:allow-set-decorations");
    expect(capability.permissions).toContain("core:window:allow-start-dragging");
  });
});
