/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { frontendDiagnostics, updateDiagnosticDock } from "./feedbackDiagnostics.js";

describe("feedback snapshot whitelist", () => {
  it("captures dimensions and Dock state without text, paths or custom names", () => {
    document.body.innerHTML =
      '<div data-testid="dock-strip"><div data-testid="dock-module">Private Client</div></div>';
    updateDiagnosticDock({
      enabled: true,
      suspended: false,
      height: 80,
      previewHeight: 110,
      monitor: "private device",
      filePath: "D:/private/audio.wav",
    });
    const snapshot = frontendDiagnostics();
    expect(snapshot.dock).toEqual({
      enabled: true,
      suspended: false,
      height: 80,
      previewHeight: 110,
    });
    expect(snapshot.dockMounted).toBe(true);
    expect(snapshot.dockModuleCount).toBe(1);
    expect(JSON.stringify(snapshot)).not.toMatch(/Private Client|private device|audio.wav/);
    document.body.innerHTML = "";
  });
});
