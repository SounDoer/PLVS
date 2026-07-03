/**
 * POST feedback content (and optional reply email) to the soundoer-newsletter
 * /feedback endpoint. Returns true on success, false on any failure (network
 * error, non-2xx response) — the caller doesn't need to distinguish why.
 */

const FEEDBACK_URL = "https://list.plvs.soundoer.com/feedback";

/**
 * @param {{ content: string, email?: string }} input
 * @returns {Promise<boolean>}
 */
export async function submitFeedback({ content, email }) {
  try {
    const res = await fetch(FEEDBACK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, email }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
