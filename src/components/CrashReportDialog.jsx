import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { SCRIM_CLASS } from "@/components/ui/surfaceStyles.js";
import { cn } from "@/lib/utils";
import { useBlockingEditor } from "../hooks/BlockingEditorsContext.jsx";
import { discardCrashReport } from "../ipc/commands.js";
import { buildCrashReportRequest, submitCrashReport } from "../lib/crashReporting.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CrashReportDialog({
  report,
  onClose,
  onDisableAsking,
  onDiscard = discardCrashReport,
  submit = submitCrashReport,
}) {
  const [note, setNote] = useState("");
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useBlockingEditor("crash-report", true);

  const trimmedEmail = email.trim();
  const emailInvalid = trimmedEmail !== "" && !EMAIL_RE.test(trimmedEmail);
  const request = useMemo(
    () => buildCrashReportRequest({ report, note, email }),
    [email, note, report]
  );

  async function run(action, failureMessage) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      setError(failureMessage);
    } finally {
      setBusy(false);
    }
  }

  function handleSend() {
    return run(async () => {
      await submit({ report, note, email });
      await onDiscard(report.id);
      onClose();
    }, "Could not send the report. It is still saved on this device.");
  }

  function handleDiscard() {
    return run(async () => {
      await onDiscard(report.id);
      onClose();
    }, "Could not delete the saved report. Please try again.");
  }

  function handleDisableAsking() {
    return run(async () => {
      await onDisableAsking();
      await onDiscard(report.id);
      onClose();
    }, "Could not update crash-report settings. The report is still saved on this device.");
  }

  const sendError = error && !busy;

  return (
    <div className={cn(SCRIM_CLASS, "z-[70] grid place-items-center p-4")}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="PLVS Quit Unexpectedly"
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl"
      >
        <header className="border-b border-border px-4 py-3">
          <h2 className="text-[length:var(--ui-fs-panel-title)] font-semibold">
            PLVS Quit Unexpectedly
          </h2>
          <p className="mt-1 text-[length:var(--ui-fs-display)] text-muted-foreground">
            PLVS saved a crash report on this device. Review it before choosing whether to send it.
          </p>
        </header>

        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-3">
          <textarea
            aria-label="Crash report note (optional)"
            value={note}
            onInput={(event) => setNote(event.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="What were you doing when PLVS quit? (optional)"
            className="resize-none rounded-md border border-input bg-transparent px-2 py-1.5 text-[length:var(--ui-fs-display)] outline-none"
          />
          <input
            aria-label="Your email (optional)"
            type="email"
            value={email}
            onInput={(event) => setEmail(event.target.value)}
            onBlur={() => setEmailTouched(true)}
            placeholder="you@example.com (optional)"
            className="rounded-md border border-input bg-transparent px-2 py-1.5 text-[length:var(--ui-fs-display)] outline-none"
          />
          {emailTouched && emailInvalid ? (
            <span className="text-[length:var(--ui-fs-axis)] text-destructive">
              Enter a valid email or leave it blank.
            </span>
          ) : null}

          <button
            type="button"
            className="self-start text-[length:var(--ui-fs-display)] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => setShowPreview((value) => !value)}
          >
            {showPreview ? "Hide Report" : "View Report"}
          </button>
          {showPreview ? (
            <pre
              aria-label="Crash report payload"
              className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-[length:var(--ui-fs-axis)]"
            >
              {JSON.stringify(request, null, 2)}
            </pre>
          ) : null}

          {sendError ? (
            <span className="text-[length:var(--ui-fs-display)] text-destructive">{error}</span>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Later
          </Button>
          <Button variant="ghost" onClick={handleDisableAsking} disabled={busy}>
            Don't Ask Again
          </Button>
          <Button variant="outline" onClick={handleDiscard} disabled={busy}>
            Don't Send
          </Button>
          <Button onClick={handleSend} disabled={busy || emailInvalid}>
            {busy ? "Sending..." : "Send"}
          </Button>
        </footer>
      </section>
    </div>
  );
}
