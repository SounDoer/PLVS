import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const capability = JSON.parse(readFileSync(join(currentDir, "default.json"), "utf8"));
const accessoryCapability = JSON.parse(
  readFileSync(join(currentDir, "dock-accessories.json"), "utf8")
);

describe("default Tauri capabilities", () => {
  it("allows Focus View to hide window decorations and drag frameless windows", () => {
    expect(capability.permissions).toContain("core:window:allow-set-decorations");
    expect(capability.permissions).toContain("core:window:allow-start-dragging");
  });

  it("allows profile import/export dialogs", () => {
    expect(capability.permissions).toContain("dialog:allow-open");
    expect(capability.permissions).toContain("dialog:allow-save");
  });

  it("allows the updater plugin to check and install updates", () => {
    expect(capability.permissions).toContain("updater:default");
  });
});

describe("Dock accessory Tauri capabilities", () => {
  it("targets only the two accessory windows with event permissions", () => {
    expect(accessoryCapability.windows).toEqual(["dock-header", "dock-editor"]);
    expect(accessoryCapability.permissions).toEqual(["core:event:default"]);
  });

  it("does not add accessory windows to the privileged main capability", () => {
    expect(capability.windows).toEqual(["main"]);
  });
});
