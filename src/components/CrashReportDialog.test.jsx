/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlockingEditorsProvider, useBlockingEditors } from "../hooks/BlockingEditorsContext.jsx";
import { CrashReportDialog } from "./CrashReportDialog.jsx";

const { openExternalUrl } = vi.hoisted(() => ({ openExternalUrl: vi.fn() }));

vi.mock("../ipc/openExternal.js", () => ({
  openExternalUrl,
  PRIVACY_POLICY_URL: "https://plvs.soundoer.com/privacy/",
}));

const report = {
  schemaVersion: 1,
  id: "20260916T120000Z-01234567",
  createdAt: "2026-09-16T12:00:00Z",
  sessionId: "session-a",
  kind: "rust_panic",
  app: { version: "0.15.4", os: "windows", arch: "x86_64" },
  error: { message: "test panic" },
  logs: ["last line"],
};

function RegistryStatus() {
  const { activeBlockingEditors } = useBlockingEditors();
  return <output aria-label="blocking editors">{activeBlockingEditors.join(",")}</output>;
}

function renderDialog(overrides = {}) {
  const props = {
    report,
    onClose: vi.fn(),
    onDiscard: vi.fn().mockResolvedValue(true),
    onDisableAsking: vi.fn().mockResolvedValue(undefined),
    submit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const view = render(
    <BlockingEditorsProvider>
      <RegistryStatus />
      <CrashReportDialog {...props} />
    </BlockingEditorsProvider>
  );
  return { ...props, ...view };
}

beforeEach(() => vi.clearAllMocks());

describe("CrashReportDialog", () => {
  it("opens the Privacy Policy from the send decision", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Privacy Policy" }));
    expect(openExternalUrl).toHaveBeenCalledWith("https://plvs.soundoer.com/privacy/");
  });

  it("previews the exact request and registers as a blocking editor", () => {
    renderDialog();
    fireEvent.input(screen.getByLabelText("Crash report note (optional)"), {
      target: { value: "Happened after opening a file" },
    });
    fireEvent.input(screen.getByLabelText("Your email (optional)"), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "View Report" }));

    expect(screen.getByLabelText("blocking editors").textContent).toBe("crash-report");
    expect(JSON.parse(screen.getByLabelText("Crash report payload").textContent)).toEqual({
      report,
      note: "Happened after opening a file",
      email: "user@example.com",
    });
  });

  it("blocks Send for an invalid email", () => {
    renderDialog();
    fireEvent.input(screen.getByLabelText("Your email (optional)"), {
      target: { value: "not-an-email" },
    });
    fireEvent.blur(screen.getByLabelText("Your email (optional)"));

    expect(screen.getByText("Enter a valid email or leave it blank.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" }).disabled).toBe(true);
  });

  it("deletes only after a successful send and then closes", async () => {
    const props = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(props.submit).toHaveBeenCalledWith({ report, note: "", email: "" }));
    expect(props.onDiscard).toHaveBeenCalledWith(report.id);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the report and draft after send failure", async () => {
    const props = renderDialog({ submit: vi.fn().mockRejectedValue(new Error("offline")) });
    const note = screen.getByLabelText("Crash report note (optional)");
    fireEvent.input(note, { target: { value: "my draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await screen.findByText("Could not send the report. It is still saved on this device.");
    expect(note.value).toBe("my draft");
    expect(props.onDiscard).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("supports Don't Send and Don't Ask Again without uploading", async () => {
    const first = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Don't Send" }));
    await waitFor(() => expect(first.onDiscard).toHaveBeenCalledWith(report.id));
    expect(first.submit).not.toHaveBeenCalled();

    first.unmount();
    const second = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Don't Ask Again" }));
    await waitFor(() => expect(second.onDisableAsking).toHaveBeenCalledTimes(1));
    expect(second.onDiscard).toHaveBeenCalledWith(report.id);
    expect(second.submit).not.toHaveBeenCalled();
  });

  it("can close for now without deleting the saved report", () => {
    const props = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Later" }));

    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onDiscard).not.toHaveBeenCalled();
  });
});
