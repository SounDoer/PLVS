import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const SRC_ROOT = fileURLToPath(new URL("../", import.meta.url));
const KEY_CALL = /\b(?:spectrum|vectorscope|stereoMap)RequestKeyFromControls\(([^)]*)\)/g;

function sourceFiles(directory = SRC_ROOT) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.jsx?$/.test(entry.name) || /\.test\.jsx?$/.test(entry.name)) return [];
    return [path];
  });
}

/// A panel stores the channels the user requested, but Rust computes the effective ones
/// (`effectiveChannels.js`). A key derived from the stored controls names a result nobody
/// computes while the source lacks those channels, and the panel draws nothing.
describe("analysis request key callers", () => {
  const calls = sourceFiles().flatMap((path) =>
    [...readFileSync(path, "utf8").matchAll(KEY_CALL)].map((match) => ({
      file: relative(SRC_ROOT, path).replaceAll("\\", "/"),
      argument: match[1].trim(),
    }))
  );

  it("are limited to request derivation and the panels that resolve their channels", () => {
    expect([...new Set(calls.map(({ file }) => file))].sort()).toEqual([
      "analysis/analysisRequests.js",
      "components/panels/SpectrogramPanel.jsx",
      "components/panels/SpectrumPanel.jsx",
      "components/panels/StereoMapPanel.jsx",
      "components/panels/useVectorscopeDisplay.js",
      "dock/dockAnalysisRequest.js",
    ]);
  });

  it("derive panel keys from the effective controls", () => {
    const panelCalls = calls.filter(({ file }) => file.startsWith("components/panels/"));
    expect(panelCalls.length).toBeGreaterThan(0);
    for (const call of panelCalls)
      expect(call).toEqual({ ...call, argument: "effectivePanelControls" });
  });
});
