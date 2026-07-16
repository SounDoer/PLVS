import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DockHistoryWindowHud } from "./DockHistoryInteraction.jsx";

describe("DockHistoryWindowHud", () => {
  it("uses the Dock value typography role", () => {
    render(
      <DockHistoryWindowHud
        controls={{
          panelId: "loudness",
          dockHistoryHud: { panelId: "loudness", windowSec: 60 },
        }}
      />
    );

    const hud = screen.getByRole("status");
    expect(hud.className).toContain("var(--ui-dock-fs-value)");
    expect(hud.className).not.toContain("text-[10px]");
  });
});
