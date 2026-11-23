const topics = new Set([
  "system-output-speaker-layout",
  "audio-capture",
  "output-in-use",
  "audio-dropped",
  "channel-layout-unknown",
  "channel-layout-inferred",
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
