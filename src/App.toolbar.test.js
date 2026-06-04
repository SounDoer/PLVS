import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(currentDir, "App.jsx"), "utf8");

describe("App toolbar", () => {
  it("uses a slightly larger device icon to match neighboring toolbar glyphs visually", () => {
    expect(appSource).toContain('<Volume2 className="size-4 shrink-0" />');
  });

  it("uses formatted audio device labels in both the picker and footer", () => {
    expect(appSource).toContain("formatAudioDeviceLabel(device.label)");
    expect(appSource).toContain("formatAudioDeviceLabel(deviceName)");
    expect(appSource).toContain("const footerDeviceLabel = deviceDisplay");
    expect(appSource).toContain("deviceDisplay.secondary || deviceDisplay.primary");
    expect(appSource).toContain("{footerDeviceLabel}");
    expect(appSource).not.toContain("title={label.full}");
    expect(appSource).not.toContain("title={deviceDisplay?.full}");
    expect(appSource).toContain("w-[min(28rem,92vw)]");
  });

  it("does not sync live vectorscope selection from snapshot display audio", () => {
    expect(appSource).toContain("if (!running || selectedOffset >= 0) return;");
    expect(appSource).toContain("updatePanelControls((current) => {");
    expect(appSource).toContain(
      "if (current.vectorscopePair.x === x && current.vectorscopePair.y === y) return current;"
    );
    expect(appSource).toContain("displayAudio?.vectorscopePairY,");
    expect(appSource).not.toContain(
      "vectorscopePairUi.x,\n    vectorscopePairUi.y,\n    updatePanelControls,"
    );
  });

  it("syncs restored channel controls to the backend while running", () => {
    expect(appSource).toContain('const lastSentVectorscopePairKeyRef = useRef("");');
    expect(appSource).toContain('const lastSentSpectrumChannelKeyRef = useRef("");');
    expect(appSource).toContain("void sendTrackedVectorscopePair(vectorscopePairUi);");
    expect(appSource).toContain("void sendTrackedSpectrumChannel(spectrumChannelUi);");
  });

  it("does not let stale live vectorscope frames overwrite pending app changes", () => {
    expect(appSource).toContain("const pendingVectorscopePairSyncRef = useRef(null);");
    expect(appSource).toContain("pendingVectorscopePairSyncRef.current = null;");
    expect(appSource).toContain(
      "if (pendingPair && (pendingPair.x !== x || pendingPair.y !== y)) return;"
    );
  });

  it("removes legacy channel persistence fields before writing ui state", () => {
    expect(appSource).toContain("stripLegacyChannelPreferenceKeys");
    expect(appSource).toContain("const nextPersisted = stripLegacyChannelPreferenceKeys(prev);");
  });
});
