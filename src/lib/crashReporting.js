export const CRASH_REPORT_ENDPOINT = "https://list.plvs.soundoer.com/crash-report";
const REQUEST_TIMEOUT_MS = 15_000;

export function buildCrashReportRequest({ report, note, email }) {
  const request = { report };
  const trimmedNote = note?.trim();
  const trimmedEmail = email?.trim();
  if (trimmedNote) request.note = trimmedNote;
  if (trimmedEmail) request.email = trimmedEmail;
  return request;
}

export async function submitCrashReport({
  report,
  note,
  email,
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new DOMException("Crash report request timed out.", "TimeoutError"));
  }, timeoutMs);
  try {
    const response = await fetchImpl(CRASH_REPORT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildCrashReportRequest({ report, note, email })),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Crash report server returned ${response.status}.`);
    }
  } finally {
    clearTimeout(timeout);
  }
}
