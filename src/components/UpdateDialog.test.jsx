/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateDialog } from "./UpdateDialog.jsx";

const BASE_PROPS = {
  open: true,
  version: "0.9.5",
  releaseNotes: "### Fixed\n- Safer updates",
  installStatus: "idle",
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
  onRestart: vi.fn(),
  openExternalUrl: vi.fn(),
};

describe("UpdateDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when closed", () => {
    render(<UpdateDialog {...BASE_PROPS} open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders the version and basic Markdown without rendering raw HTML", () => {
    const { container } = render(
      <UpdateDialog
        {...BASE_PROPS}
        releaseNotes={"### Fixed\n- Safer updates\n\n<span data-unsafe>unsafe</span>"}
      />
    );

    expect(screen.getByText("What's new in v0.9.5")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Fixed" })).toBeTruthy();
    expect(screen.getByText("Safer updates")).toBeTruthy();
    expect(container.querySelector("[data-unsafe]")).toBeNull();
  });

  it("opens Markdown links through the external URL handler", () => {
    const openExternalUrl = vi.fn();
    render(
      <UpdateDialog
        {...BASE_PROPS}
        releaseNotes="[Full notes](https://example.com/release)"
        openExternalUrl={openExternalUrl}
      />
    );

    fireEvent.click(screen.getByRole("link", { name: "Full notes" }));
    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/release");
  });

  it("cancels without confirming", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<UpdateDialog {...BASE_PROPS} onCancel={onCancel} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("dismisses with Escape before installation starts", () => {
    const onCancel = vi.fn();
    render(<UpdateDialog {...BASE_PROPS} onCancel={onCancel} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("dismisses from the overlay before installation starts", () => {
    const onCancel = vi.fn();
    render(<UpdateDialog {...BASE_PROPS} onCancel={onCancel} />);

    fireEvent.click(screen.getByTestId("update-overlay"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("starts the update only from Update and Restart", () => {
    const onConfirm = vi.fn();
    render(<UpdateDialog {...BASE_PROPS} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: "Update and Restart" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("locks dismissal and submission while installing", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <UpdateDialog
        {...BASE_PROPS}
        installStatus="installing"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByRole("button", { name: "Cancel" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Updating..." }).disabled).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("update-overlay"));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("offers full retry after an installation failure", () => {
    const onConfirm = vi.fn();
    render(<UpdateDialog {...BASE_PROPS} installStatus="install-error" onConfirm={onConfirm} />);

    expect(screen.getByText("Update failed. Please try again.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("offers restart-only retry after a relaunch failure", () => {
    const onRestart = vi.fn();
    render(<UpdateDialog {...BASE_PROPS} installStatus="restart-error" onRestart={onRestart} />);

    expect(screen.getByText("Update installed. Restart PLVS to finish.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});
