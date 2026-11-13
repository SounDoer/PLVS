const topics = new Set([
  "system-output-speaker-layout",
  "audio-capture",
  "audio-dropped",
  "channel-layout-unknown",
  "file-open-analysis",
  "file-analysis-stop",
  "file-report",
  "dialogue-detection",
  "dock",
  "update",
  "preset",
]);

/** @param {unknown} topic */
export function troubleshootingUrl(topic) {
  return typeof topic === "string" && topics.has(topic)
    ? `https://plvs.soundoer.com/docs/troubleshooting/#${topic}`
    : null;
}
