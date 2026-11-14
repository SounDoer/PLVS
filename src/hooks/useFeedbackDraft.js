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

  useBlockingEditor("feedback", active, true);

  const dirty = content !== "" || email !== "" || attachDiagnostics;
  useEffect(() => {
    if (active) onDirtyChange(dirty);
  }, [active, dirty, onDirtyChange]);

  const trimmedEmail = email.trim();
  const invalidAddress = trimmedEmail !== "" && !EMAIL_RE.test(trimmedEmail);
  const emailInvalid = emailTouched && invalidAddress;
  const busy = status === "preparing" || status === "sending";
  const canSubmit = content.trim().length > 0 && !invalidAddress && !busy && status !== "sent";
  const document = { content, email, attachDiagnostics };
  const key = JSON.stringify(document);
  const [draft, setDraft] = useState(() => ({ key, generation: 0 }));
  if (key !== draft.key) setDraft({ key, generation: draft.generation + 1 });

  function inspectDraft() {
    return { document, dirty, draftGeneration: draft.generation };
  }

  function commitDraftDocument(next) {
    if (!mountedRef.current || busy || status === "sent") {
      throw Object.assign(new Error("The Feedback draft is busy."), {
        code: "draftActionUnavailable",
      });
    }
    setContent(next.content);
    setEmail(next.email);
    setEmailTouched(true);
    setAttachDiagnostics(next.attachDiagnostics);
  }

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

  function submissionPayload(diagnostics) {
    return {
      content: content.trim(),
      ...(trimmedEmail && { email: trimmedEmail }),
      ...(attachDiagnostics && { diagnostics }),
    };
  }

  async function prepareSubmission(session, rememberDiagnostics) {
    const diagnostics = attachDiagnostics
      ? (diagnosticsPreview ??
        (rememberDiagnostics
          ? await prepareDiagnostics(false, session)
          : await readFeedbackDiagnostics(frontendDiagnostics())))
      : undefined;
    return submissionPayload(diagnostics);
  }

  async function previewSubmission() {
    try {
      return await prepareSubmission(sessionRef.current, false);
    } catch {
      throw Object.assign(new Error("Could not prepare Feedback diagnostics."), {
        reason: "uiActionUnavailable",
      });
    }
  }

  async function handleSubmit() {
    const session = sessionRef.current;
    if (!mountedRef.current || !canSubmit || operationRef.current === session) return;
    operationRef.current = session;
    try {
      if (attachDiagnostics) setStatus("preparing");
      let payload;
      try {
        payload = attachDiagnostics
          ? await prepareSubmission(session, true)
          : submissionPayload(undefined);
      } catch {
        if (isCurrent(session)) setStatus("diagnostics-error");
        return { submitted: false, status: "diagnostics-error" };
      }
      if (!isCurrent(session)) return { submitted: false, status: "cancelled" };
      setStatus("sending");
      const ok = await submitFeedback(payload);
      if (!isCurrent(session)) return;
      if (ok) {
        setStatus("sent");
        closeTimerRef.current = setTimeout(onClose, CLOSE_DELAY_MS);
      } else {
        setStatus("error");
      }
      return { submitted: ok, status: ok ? "sent" : "error" };
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
    previewSubmission,
    inspectDraft,
    commitDraftDocument,
  };
}
