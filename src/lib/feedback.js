/**
 * POST feedback content (and optional reply email) to the soundoer-newsletter
 * /feedback endpoint. Returns true on success, false on any failure (network
 * error, non-2xx response) — the caller doesn't need to distinguish why.
 */

const FEEDBACK_URL = "https://list.plvs.soundoer.com/feedback";

/**
 * @param {{ content: string, email?: string, diagnostics?: object }} input
 * @returns {Promise<boolean>}
 */
export async function submitFeedback({ content, email, diagnostics }) {
  try {
    const payload = { content, email };
    if (diagnostics !== undefined) payload.diagnostics = diagnostics;
    const res = await fetch(FEEDBACK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}
