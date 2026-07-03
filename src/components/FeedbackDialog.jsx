import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { clampPanelPos } from "../lib/dragClamp.js";
import { submitFeedback } from "../lib/feedback.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INITIAL_POS = { x: 120, y: 120 };
const CLOSE_DELAY_MS = 2000;

/**
 * @param {{ onClose: () => void }} props
 */
export function FeedbackDialog({ onClose }) {
  const [content, setContent] = useState("");
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [status, setStatus] = useState(/** @type {"idle"|"sending"|"sent"|"error"} */ ("idle"));
  const [pos, setPos] = useState(INITIAL_POS);

  const ref = useRef(null);
  const dragRef = useRef(null);

  function onPointerDown(e) {
    const rect = ref.current.getBoundingClientRect();
    dragRef.current = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      w: rect.width,
      h: rect.height,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    setPos(
      clampPanelPos(
        { x: e.clientX - d.dx, y: e.clientY - d.dy },
        { w: d.w, h: d.h },
        { w: window.innerWidth, h: window.innerHeight }
      )
    );
  }
  function onPointerUp() {
    dragRef.current = null;
  }

  const emailInvalid = emailTouched && email.trim() !== "" && !EMAIL_RE.test(email);
  const canSubmit = content.trim().length > 0 && !emailInvalid && status !== "sending";

  async function handleSubmit() {
    setStatus("sending");
    const trimmedEmail = email.trim();
    const ok = await submitFeedback({
      content: content.trim(),
      email: trimmedEmail || undefined,
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
      className="fixed z-50 flex w-80 flex-col gap-2 overflow-hidden rounded-[var(--ui-radius-modal)] border border-border bg-card text-card-foreground shadow-lg"
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="flex cursor-move items-center justify-between border-b border-border px-3 py-2"
      >
        <span className="text-[length:var(--ui-fs-panel-title)] font-semibold">Send Feedback</span>
      </div>

      <div className="flex flex-col gap-2 px-3 py-2">
        <textarea
          aria-label="Feedback content"
          value={content}
          onInput={(e) => setContent(e.target.value)}
          rows={5}
          placeholder="What's on your mind?"
          className="resize-none rounded-md border border-input bg-transparent px-2 py-1.5 text-[length:var(--ui-fs-display)] outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <input
          aria-label="Your email (optional)"
          type="email"
          value={email}
          onInput={(e) => setEmail(e.target.value)}
          onBlur={() => setEmailTouched(true)}
          placeholder="you@example.com (optional)"
          className="rounded-md border border-input bg-transparent px-2 py-1.5 text-[length:var(--ui-fs-display)] outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
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
        {status === "sent" ? (
          <span className="text-[length:var(--ui-fs-axis)] text-muted-foreground">
            Thanks! Feedback sent.
          </span>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!canSubmit}>
          {status === "sending" ? "Sending..." : "Send"}
        </Button>
      </div>
    </div>
  );
}
