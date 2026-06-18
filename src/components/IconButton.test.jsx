/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Settings } from "lucide-react";
import { IconButton } from "./IconButton.jsx";

describe("IconButton", () => {
  it("uses its tooltip text as the accessible button name", () => {
    render(<IconButton icon={<Settings className="size-3.5" />} tip="Settings" />);
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  });
});
