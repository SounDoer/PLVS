import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { HoverTip } from "@/components/HoverTip.jsx";
import { useBlockingEditor } from "../hooks/BlockingEditorsContext.jsx";
import { discardCrashReport } from "../ipc/commands.js";
import { openExternalUrl, PRIVACY_POLICY_URL } from "../ipc/openExternal.js";
import { buildCrashReportRequest, submitCrashReport } from "../lib/crashReporting.js";
import { LAYER_PRIORITY } from "@/components/ui/layers.js";
import { LinkButton } from "@/components/ui/link-button";
import { useUiSurface } from "../uiNavigation/UiNavigationContext.jsx";

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
  const laterRef = useRef(null);
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
  useUiSurface({
    kind: "crashReport",
    origin: "event",
    developmentFixture: "crash-report.pending",
    blocking: true,
    busy,
    dismissible: !busy,
    supportedActions: busy ? [] : ["close"],
    target: { phase: error ? "error" : busy ? "busy" : "decision" },
    choices: [
      { id: "disable-asking", label: "Don't Ask Again", run: handleDisableAsking },
      { id: "later", label: "Later", run: onClose },
      { id: "discard", label: "Don't Send", run: handleDiscard },
      { id: "send", label: "Send", run: handleSend, disabled: emailInvalid },
    ],
    onClose,
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        size="lg"
        layer={LAYER_PRIORITY}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          laterRef.current?.focus();
        }}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogTitle>PLVS Quit Unexpectedly</DialogTitle>

        <div className="my-3 flex min-h-0 flex-col gap-2 overflow-y-auto">
          <textarea
            aria-label="Crash report note (optional)"
            value={note}
            onInput={(event) => setNote(/** @type {HTMLTextAreaElement} */ (event.target).value)}
            maxLength={2000}
            rows={3}
            placeholder="What were you doing when PLVS quit? (optional)"
            className="resize-none rounded-md border border-input bg-transparent px-2 py-1 text-[length:var(--ui-fs-control)] outline-none"
          />
          <input
            aria-label="Your email (optional)"
            type="email"
            value={email}
            onInput={(event) => setEmail(/** @type {HTMLInputElement} */ (event.target).value)}
            onBlur={() => setEmailTouched(true)}
            placeholder="you@example.com (optional)"
            className="rounded-md border border-input bg-transparent px-2 py-1 text-[length:var(--ui-fs-control)] outline-none"
          />
          {emailTouched && emailInvalid ? (
            <span className="text-[length:var(--ui-fs-axis)] text-destructive">
              Enter a valid email or leave it blank.
            </span>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[length:var(--ui-fs-control)]">
            <LinkButton className="font-medium" onClick={() => setShowPreview((value) => !value)}>
              {showPreview ? "Hide Report" : "View Report"}
            </LinkButton>
            <LinkButton className="font-medium" onClick={() => openExternalUrl(PRIVACY_POLICY_URL)}>
              Privacy Policy
            </LinkButton>
          </div>
          {showPreview ? (
            <pre
              aria-label="Crash report payload"
              className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted p-3 font-mono text-[length:var(--ui-fs-axis)]"
            >
              {JSON.stringify(request, null, 2)}
            </pre>
          ) : null}

          {sendError ? (
            <span className="text-[length:var(--ui-fs-control)] text-destructive">{error}</span>
          ) : null}
        </div>

        <DialogFooter divided className="shrink-0 flex-wrap items-center">
          <HoverTip
            tip="Discard this report and stop future crash-report prompts."
            side="top"
            align="start"
            className="mr-2"
          >
            <Button variant="quiet" onClick={handleDisableAsking} disabled={busy}>
              Don&apos;t Ask Again
            </Button>
          </HoverTip>
          <Button ref={laterRef} variant="ghost" onClick={onClose} disabled={busy}>
            Later
          </Button>
          <Button variant="ghost" onClick={handleDiscard} disabled={busy}>
            Don&apos;t Send
          </Button>
          <Button onClick={handleSend} disabled={busy || emailInvalid}>
            {busy ? "Sending..." : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
