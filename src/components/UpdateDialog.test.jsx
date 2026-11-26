/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sliceChangelogSince } from "../lib/changelogAggregate.js";
import { UpdateDialog } from "./UpdateDialog.jsx";

const BASE_PROPS = {
  open: true,
  currentVersion: "0.9.4",
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

  it("renders the version and actions while loading Markdown, then shows formatted notes", async () => {
    render(
      <UpdateDialog
        {...BASE_PROPS}
        targetVersion="1.2.3"
        releaseNotes={"### Fixed\n- Safer updates\n\n<span data-unsafe>unsafe</span>"}
      />
    );

    expect(screen.getByRole("dialog", { name: "What’s New in v1.2.3" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Loading release notes…");
    expect(screen.getByRole("button", { name: "Update and Restart" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Fixed" })).toBeTruthy();
    expect(screen.getByText("Safer updates")).toBeTruthy();
    expect(screen.getByRole("dialog").querySelector("[data-unsafe]")).toBeNull();
  });

  it("shows a neutral heading when the target version is unknown", () => {
    render(<UpdateDialog {...BASE_PROPS} />);
    expect(screen.getByRole("dialog", { name: "What’s New" })).toBeTruthy();
  });

  it.each([
    ["0.27.0", "What’s New in v0.27.1"],
    ["0.26.0", "What’s New Since v0.26.0"],
    [undefined, "What’s New"],
  ])("titles the displayed release notes with installed version %s", (currentVersion, title) => {
    const changelog =
      "## [0.27.1] - 2026-11-26\n\n- Latest fixes.\n\n## [0.27.0] - 2026-11-25\n\n- New features.";
    render(
      <UpdateDialog
        {...BASE_PROPS}
        currentVersion={currentVersion}
        targetVersion="0.27.1"
        releaseNotes={sliceChangelogSince(changelog, currentVersion)}
        ready
      />
    );

    expect(screen.getByRole("dialog", { name: title })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Update Ready" })).toBeNull();
    expect(screen.getByRole("button", { name: "Skip This Time" })).toBeTruthy();
  });

  it("opens Markdown links through the external URL handler", async () => {
    const openExternalUrl = vi.fn();
    render(
      <UpdateDialog
        {...BASE_PROPS}
        releaseNotes="[Full notes](https://example.com/release)"
        openExternalUrl={openExternalUrl}
      />
    );

    fireEvent.click(await screen.findByRole("link", { name: "Full notes" }));
    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/release");
  });

  it("preserves release-note formatting, reference links, and entity decoding", async () => {
    const openExternalUrl = vi.fn();
    render(
      <UpdateDialog
        {...BASE_PROPS}
        releaseNotes={[
          "### Fixed",
          "",
          "3. **File &amp; Live** use `Ready`.",
          "   - See [the guide][guide].",
          "",
          "> _Note:_ applies after restart.",
          "",
          "```text",
          "<unchanged>",
          "```",
          "",
          '[guide]: https://example.com/guide?a=1&amp;b=2 "Guide"',
        ].join("\n")}
        openExternalUrl={openExternalUrl}
      />
    );

    const guide = await screen.findByRole("link", { name: "the guide" });
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("ol")?.start).toBe(3);
    expect(dialog.querySelector("ol ul")).toBeTruthy();
    expect(dialog.querySelector("strong")?.textContent).toBe("File & Live");
    expect(dialog.querySelector("blockquote em")?.textContent).toBe("Note:");
    expect(dialog.querySelector("pre code.language-text")?.textContent).toBe("<unchanged>\n");
    fireEvent.click(guide);
    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/guide?a=1&b=2");
  });

  it("does not activate raw HTML, inline scripts, or unsafe Markdown URLs", async () => {
    const openExternalUrl = vi.fn();
    render(
      <UpdateDialog
        {...BASE_PROPS}
        releaseNotes={[
          '<img src="https://example.com/raw.png" onerror="void 0">',
          "",
          "<script>void 0</script>",
          "",
          "[Link](javascript&#58;void%200) and ![Image](data:text/html,raw)",
        ].join("\n")}
        openExternalUrl={openExternalUrl}
      />
    );

    const label = await screen.findByText("Link");
    expect(screen.getByRole("dialog").querySelector("script, img[src], [onerror]")).toBeNull();
    expect(label.hasAttribute("href")).toBe(false);
    fireEvent.click(label);
    expect(openExternalUrl).not.toHaveBeenCalled();
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

    expect(
      /** @type {HTMLButtonElement} */ (screen.getByRole("button", { name: "Cancel" })).disabled
    ).toBe(true);
    expect(
      /** @type {HTMLButtonElement} */ (screen.getByRole("button", { name: "Updating..." }))
        .disabled
    ).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByTestId("update-overlay"));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("shows a download bar without a percentage while installing", () => {
    const { rerender } = render(<UpdateDialog {...BASE_PROPS} installStatus="installing" />);

    const indeterminate = screen.getByRole("progressbar", { name: "Update download" });
    expect(indeterminate.getAttribute("aria-valuenow")).toBeNull();
    expect(indeterminate.textContent).toBe("");

    expect(/** @type {HTMLElement} */ (indeterminate.firstElementChild).style.width).toBe("");

    rerender(<UpdateDialog {...BASE_PROPS} installStatus="installing" downloadProgress={0.4} />);
    const determinate = screen.getByRole("progressbar", { name: "Update download" });
    expect(determinate.getAttribute("aria-valuenow")).toBe("40");
    expect(/** @type {HTMLElement} */ (determinate.firstElementChild).style.width).toBe("40%");
    expect(determinate.textContent).toBe("");
    expect(screen.queryByText("40%")).toBeNull();
  });

  it("hides the download bar outside the download step", () => {
    const { rerender } = render(
      <UpdateDialog {...BASE_PROPS} installStatus="installing" downloadProgress={0.4} />
    );
    expect(screen.getByRole("progressbar")).toBeTruthy();

    rerender(<UpdateDialog {...BASE_PROPS} installStatus="restarting" downloadProgress={1} />);
    expect(screen.queryByRole("progressbar")).toBeNull();

    rerender(<UpdateDialog {...BASE_PROPS} installStatus="install-error" downloadProgress={0.4} />);
    expect(screen.queryByRole("progressbar")).toBeNull();

    rerender(<UpdateDialog {...BASE_PROPS} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("offers full retry after an installation failure", () => {
    const onConfirm = vi.fn();
    render(<UpdateDialog {...BASE_PROPS} installStatus="install-error" onConfirm={onConfirm} />);

    expect(screen.getByText("Update failed. Please try again.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("opens the exact public release after an installation failure", () => {
    const openExternalUrl = vi.fn();
    render(
      <UpdateDialog
        {...BASE_PROPS}
        targetVersion="1.2.3"
        manualDownloadUrl="https://github.com/SounDoer/PLVS/releases/tag/v1.2.3"
        installStatus="install-error"
        openExternalUrl={openExternalUrl}
      />
    );

    expect(
      screen.getByText(
        "Update failed. Please try again, or download v1.2.3 manually from GitHub Releases."
      )
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Download Manually" }));
    expect(openExternalUrl).toHaveBeenCalledWith(
      "https://github.com/SounDoer/PLVS/releases/tag/v1.2.3"
    );
  });

  it("offers restart-only retry after a relaunch failure", () => {
    const onRestart = vi.fn();
    render(<UpdateDialog {...BASE_PROPS} installStatus="restart-error" onRestart={onRestart} />);

    expect(screen.getByText("Update installed. Restart PLVS to finish.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});
