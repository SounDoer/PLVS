import { buildAppStatusItems } from "../lib/appStatus.js";

export const STATUS_FIXTURE_NAMES = {
  layout: "status.layout",
  summary: "status.summary",
  details: "status.details",
  "capture-failed": "status.capture-failed",
  update: "status.update",
  "update-ready": "status.update-ready",
  "update-failed": "status.update-failed",
};

export function developmentStatusItems(phase) {
  if (phase === "layout") return buildAppStatusItems({ layoutUnknown: true });
  if (phase === "capture-failed")
    return buildAppStatusItems({
      notice: {
        kind: "error",
        text: "Capture Stopped",
        details:
          "The selected audio source disconnected. Reconnect it or choose another source, then start capture again.",
        requiresAttention: true,
      },
    });
  const update = {
    phase: phase === "update-ready" ? "ready" : phase === "update-failed" ? "error" : "available",
    text:
      phase === "update-ready"
        ? "Update Ready · v99.0.0"
        : phase === "update-failed"
          ? "Update Failed"
          : "Update Available · v99.0.0",
  };
  if (phase.startsWith("update")) return buildAppStatusItems({ update });
  return buildAppStatusItems({
    layoutUnknown: true,
    audioDrop: { chunks: 2, since: Date.UTC(2026, 9, 28, 2) },
    update,
  });
}
