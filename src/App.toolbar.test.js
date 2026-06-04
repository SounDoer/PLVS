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

  it("removes legacy channel persistence fields before writing ui state", () => {
    expect(appSource).toContain("delete nextPersisted.vectorscopePairX;");
    expect(appSource).toContain("delete nextPersisted.vectorscopePairY;");
    expect(appSource).toContain("delete nextPersisted.spectrumChannelType;");
    expect(appSource).toContain("delete nextPersisted.spectrumChannelX;");
    expect(appSource).toContain("delete nextPersisted.spectrumChannelY;");
    expect(appSource).toContain("delete nextPersisted.spectrumChannelCh;");
  });
});
