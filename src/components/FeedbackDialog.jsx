import { useRef, useState } from "react";
import { useFeedbackDraft } from "../hooks/useFeedbackDraft.js";
import { FLOATING_WINDOW_CLASS } from "@/components/ui/surfaceStyles.js";
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFloatingPanelDrag } from "../hooks/useFloatingPanelDrag.js";
import { openExternalUrl, PRIVACY_POLICY_URL } from "../ipc/openExternal.js";
import { LinkButton } from "@/components/ui/link-button";
import { Checkbox } from "@/components/ui/checkbox";
import { HoverTip } from "./HoverTip.jsx";
import { IconAction } from "./ui/icon-action";

const INITIAL_POS = { x: 120, y: 120 };
const DIAGNOSTICS_HELP =
  "Includes app and window state, recent Dock operations, and up to 500 log lines. Audio and screenshots are never attached.";

/**
 * @param {{ onClose: () => void, onDirtyChange?: (dirty: boolean) => void }} props
 */
export function FeedbackDialog({ onClose, onDirtyChange = () => {} }) {
  const controller = useFeedbackDraft({ onClose, onDirtyChange });
  return <FeedbackContent controller={controller} onClose={onClose} />;
}

export function FeedbackContent({
  controller,
  onClose,
  onPrivacy = () => openExternalUrl(PRIVACY_POLICY_URL),
}) {
  const {
    content,
    setContent,
    email,
    setEmail,
    setEmailTouched,
    attachDiagnostics,
    setAttachDiagnostics,
    diagnosticsPreview,
    setDiagnosticsPreview,
    showDiagnostics,
    setShowDiagnostics,
    status,
    setStatus,
    emailInvalid,
    busy,
    canSubmit,
    previewDiagnostics,
    handleSubmit,
  } = controller;
  const [pos, setPos] = useState(INITIAL_POS);
  const ref = useRef(null);
  const dragHandlers = useFloatingPanelDrag(ref, setPos);

  return (
    <div
      ref={ref}
      role="dialog"
      data-settings-editor
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

      <div
        data-settings-editor-body
        className="flex min-h-0 flex-col gap-2 overflow-y-auto px-3 py-2"
      >
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
        <div className="flex items-center gap-1 text-[length:var(--ui-fs-control)]">
          <label className="flex items-center gap-2">
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
            <span className="font-medium">Attach Diagnostics</span>
          </label>
          <HoverTip
            tip={DIAGNOSTICS_HELP}
            side="top"
            align="start"
            className="inline-flex shrink-0"
            tipClassName="w-max max-w-[18rem] whitespace-normal"
          >
            <IconAction aria-label={`Attach Diagnostics help: ${DIAGNOSTICS_HELP}`} className="p-1">
              <CircleHelp className="size-[1em]" aria-hidden />
            </IconAction>
          </HoverTip>
        </div>
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
          onClick={onPrivacy}
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
