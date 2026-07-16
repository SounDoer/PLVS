/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Settings } from "lucide-react";
import { IconButton } from "./IconButton.jsx";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(currentDir, "IconButton.jsx"), "utf8");

describe("IconButton", () => {
  it("uses its tooltip text as the accessible button name", () => {
    render(
      <IconButton
        icon={<Settings className="size-[length:var(--ui-icon-shell-action)]" />}
        tip="Settings"
      />
    );
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  });

  it("uses a compact default hit area for app header actions", () => {
    expect(source).toContain("size-7");
    expect(source).not.toContain("size-8");
  });
});
