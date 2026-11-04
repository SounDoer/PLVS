import { useEffect, useRef, useState } from "react";
import { submitFeedback } from "../lib/feedback.js";
import { readFeedbackDiagnostics } from "../ipc/commands.js";
import { useBlockingEditor } from "./BlockingEditorsContext.jsx";
import { frontendDiagnostics } from "../lib/feedbackDiagnostics.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CLOSE_DELAY_MS = 2000;

/**
 * Owns Feedback drafts and side effects independently of their presentation.
 * @param {{ active?: boolean, onClose: () => void, onDirtyChange?: (dirty: boolean) => void }} options
 */
export function useFeedbackDraft({ active = true, onClose, onDirtyChange = () => {} }) {
  const [content, setContent] = useState("");
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [attachDiagnostics, setAttachDiagnostics] = useState(false);
  const [diagnosticsPreview, setDiagnosticsPreview] = useState(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const mountedRef = useRef(true);
  const operationRef = useRef(null);
  const sessionRef = useRef(0);
  const closeTimerRef = useRef(null);
  useEffect(() => {
    mountedRef.current = active;
    sessionRef.current += 1;
    return () => {
      mountedRef.current = false;
      clearTimeout(closeTimerRef.current);
    };
  }, [active]);
  const [status, setStatus] = useState(
    /** @type {"idle"|"preparing"|"sending"|"sent"|"error"|"diagnostics-error"} */ ("idle")
  );

  useBlockingEditor("feedback", active);

  const dirty = content !== "" || email !== "" || attachDiagnostics;
  useEffect(() => {
    if (active) onDirtyChange(dirty);
  }, [active, dirty, onDirtyChange]);

  const emailInvalid = emailTouched && email.trim() !== "" && !EMAIL_RE.test(email);
  const busy = status === "preparing" || status === "sending";
  const canSubmit = content.trim().length > 0 && !emailInvalid && !busy;

  const isCurrent = (session) => mountedRef.current && sessionRef.current === session;

  async function prepareDiagnostics(refresh = false, session = sessionRef.current) {
    if (diagnosticsPreview && !refresh) return diagnosticsPreview;
    const result = await readFeedbackDiagnostics(frontendDiagnostics());
    if (isCurrent(session)) setDiagnosticsPreview(result);
    return result;
  }

  async function previewDiagnostics(refresh = false) {
    const session = sessionRef.current;
    if (!mountedRef.current) return;
    setStatus("preparing");
    try {
      await prepareDiagnostics(refresh, session);
      if (!isCurrent(session)) return;
      setShowDiagnostics(true);
      setStatus("idle");
    } catch {
      if (isCurrent(session)) setStatus("diagnostics-error");
    }
  }

  async function handleSubmit() {
    const session = sessionRef.current;
    if (!mountedRef.current || !canSubmit || operationRef.current === session) return;
    operationRef.current = session;
    try {
      let diagnostics;
      if (attachDiagnostics) {
        setStatus("preparing");
        try {
          diagnostics = await prepareDiagnostics(false, session);
        } catch {
          if (isCurrent(session)) setStatus("diagnostics-error");
          return;
        }
      }
      if (!isCurrent(session)) return;
      setStatus("sending");
      const trimmedEmail = email.trim();
      const ok = await submitFeedback({
        content: content.trim(),
        email: trimmedEmail || undefined,
        ...(attachDiagnostics ? { diagnostics } : {}),
      });
      if (!isCurrent(session)) return;
      if (ok) {
        setStatus("sent");
        closeTimerRef.current = setTimeout(onClose, CLOSE_DELAY_MS);
      } else {
        setStatus("error");
      }
    } finally {
      if (operationRef.current === session) operationRef.current = null;
    }
  }

  // A canceled session resets its draft before presenting any later session.
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) {
      setContent("");
      setEmail("");
      setEmailTouched(false);
      setAttachDiagnostics(false);
      setDiagnosticsPreview(null);
      setShowDiagnostics(false);
      setStatus("idle");
    }
  }

  return {
    content,
    setContent,
    email,
    setEmail,
    emailTouched,
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
  };
}
