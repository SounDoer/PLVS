import { FLOATING_WINDOW_CLASS } from "@/components/ui/surfaceStyles.js";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useFloatingPanelDrag } from "../hooks/useFloatingPanelDrag.js";
import { submitFeedback } from "../lib/feedback.js";
import { readFeedbackDiagnostics } from "../ipc/commands.js";
import { openExternalUrl, PRIVACY_POLICY_URL } from "../ipc/openExternal.js";
import { LinkButton } from "@/components/ui/link-button";
import { Checkbox } from "@/components/ui/checkbox";
import { useBlockingEditor } from "../hooks/BlockingEditorsContext.jsx";
import { frontendDiagnostics } from "../lib/feedbackDiagnostics.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INITIAL_POS = { x: 120, y: 120 };
const CLOSE_DELAY_MS = 2000;

/**
 * @param {{ onClose: () => void, onDirtyChange?: (dirty: boolean) => void }} props
 */
export function FeedbackDialog({ onClose, onDirtyChange = () => {} }) {
  const [content, setContent] = useState("");
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [attachDiagnostics, setAttachDiagnostics] = useState(false);
  const [diagnosticsPreview, setDiagnosticsPreview] = useState(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const [status, setStatus] = useState(
    /** @type {"idle"|"preparing"|"sending"|"sent"|"error"|"diagnostics-error"} */ ("idle")
  );
  const [pos, setPos] = useState(INITIAL_POS);

  const ref = useRef(null);
  const dragHandlers = useFloatingPanelDrag(ref, setPos);
  useBlockingEditor("feedback", true);

  const dirty = content !== "" || email !== "" || attachDiagnostics;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const emailInvalid = emailTouched && email.trim() !== "" && !EMAIL_RE.test(email);
  const busy = status === "preparing" || status === "sending";
  const canSubmit = content.trim().length > 0 && !emailInvalid && !busy;

  async function prepareDiagnostics(refresh = false) {
    if (diagnosticsPreview && !refresh) return diagnosticsPreview;
    const result = await readFeedbackDiagnostics(frontendDiagnostics());
    if (mountedRef.current) setDiagnosticsPreview(result);
    return result;
  }

  async function previewDiagnostics(refresh = false) {
    setStatus("preparing");
    try {
      await prepareDiagnostics(refresh);
      if (!mountedRef.current) return;
      setShowDiagnostics(true);
      setStatus("idle");
    } catch {
      if (mountedRef.current) setStatus("diagnostics-error");
    }
  }

  async function handleSubmit() {
    let diagnostics;
    if (attachDiagnostics) {
      setStatus("preparing");
      try {
        diagnostics = await prepareDiagnostics();
      } catch {
        setStatus("diagnostics-error");
        return;
      }
    }
    if (!mountedRef.current) return;
    setStatus("sending");
    const trimmedEmail = email.trim();
    const ok = await submitFeedback({
      content: content.trim(),
      email: trimmedEmail || undefined,
      ...(attachDiagnostics ? { diagnostics } : {}),
    });
    if (ok) {
      setStatus("sent");
      setTimeout(onClose, CLOSE_DELAY_MS);
    } else {
      setStatus("error");
    }
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Send feedback"
      className={`${FLOATING_WINDOW_CLASS} w-80 gap-2`}
      style={{ left: pos.x, top: pos.y, maxHeight: `calc(100vh - ${pos.y + 12}px)` }}
    >
      <div
        {...dragHandlers}
        className="flex shrink-0 cursor-move items-center justify-between border-b border-border px-3 py-2"
      >
        <span className="text-[length:var(--ui-fs-panel-title)] font-semibold">Send Feedback</span>
      </div>

      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto px-3 py-2">
        <textarea
          aria-label="Feedback content"
          value={content}
          onInput={(e) => setContent(/** @type {HTMLTextAreaElement} */ (e.target).value)}
          rows={5}
          placeholder="What's on your mind?"
          className="resize-none rounded-md border border-input bg-transparent px-2 py-1 text-[length:var(--ui-fs-control)] outline-none"
        />
        <input
          aria-label="Your email (optional)"
          type="email"
          value={email}
          onInput={(e) => setEmail(/** @type {HTMLInputElement} */ (e.target).value)}
          onBlur={() => setEmailTouched(true)}
          placeholder="you@example.com (optional)"
          className="h-[var(--ui-control-h)] rounded-md border border-input bg-transparent px-2 py-0 text-[length:var(--ui-fs-control)] outline-none"
        />
        <label className="flex items-start gap-2 text-[length:var(--ui-fs-control)]">
          <Checkbox
            aria-label="attach diagnostics"
            checked={attachDiagnostics}
            onChange={(event) => {
              setAttachDiagnostics(event.target.checked);
              setDiagnosticsPreview(null);
              setShowDiagnostics(false);
              setStatus("idle");
            }}
            disabled={busy}
          />
          <span>
            <span className="font-medium">Attach Diagnostics</span>
            <span className="mt-0 block text-[length:var(--ui-fs-axis)] text-muted-foreground">
              Includes app and window state, recent Dock operations, and up to 500 log lines. Audio
              and screenshots are never attached.
            </span>
          </span>
        </label>
        {attachDiagnostics && (
          <>
            <LinkButton
              className="self-start text-[length:var(--ui-fs-axis)]"
              disabled={busy}
              onClick={() =>
                showDiagnostics ? setShowDiagnostics(false) : void previewDiagnostics()
              }
            >
              {showDiagnostics ? "Hide Diagnostics" : "View Diagnostics"}
            </LinkButton>
            {showDiagnostics && diagnosticsPreview && (
              <div className="flex flex-col gap-1">
                <span className="text-[length:var(--ui-fs-axis)] text-muted-foreground">
                  This snapshot will be attached when you send. Missing sections and shortened
                  records are marked in the file.
                </span>
                <pre
                  aria-label="diagnostics preview"
                  className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border p-2 text-[length:var(--ui-fs-axis)]"
                >
                  {JSON.stringify(diagnosticsPreview, null, 2)}
                </pre>
                <LinkButton
                  disabled={busy}
                  onClick={() => {
                    void previewDiagnostics(true);
                  }}
                >
                  Refresh Diagnostics
                </LinkButton>
              </div>
            )}
          </>
        )}
        <LinkButton
          className="self-start text-[length:var(--ui-fs-axis)] underline-offset-4 hover:underline"
          onClick={() => openExternalUrl(PRIVACY_POLICY_URL)}
        >
          Privacy Policy
        </LinkButton>
        {emailInvalid ? (
          <span className="text-[length:var(--ui-fs-axis)] text-destructive">
            Enter a valid email or leave it blank.
          </span>
        ) : null}
        {status === "error" ? (
          <span className="text-[length:var(--ui-fs-axis)] text-destructive">
            Failed to send, please try again.
          </span>
        ) : null}
        {status === "diagnostics-error" ? (
          <span className="text-[length:var(--ui-fs-axis)] text-destructive">
            Could not prepare diagnostics. Nothing was sent.
          </span>
        ) : null}
        {status === "sent" ? (
          <span className="text-[length:var(--ui-fs-axis)] text-muted-foreground">
            Thanks! Feedback sent.
          </span>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-3 py-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!canSubmit}>
          {status === "preparing" ? "Preparing..." : status === "sending" ? "Sending..." : "Send"}
        </Button>
      </div>
    </div>
  );
}
