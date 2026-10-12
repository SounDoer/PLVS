import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { portableToStoredPreset } from "../transfer/portablePreset.js";
import { MULTICHANNEL_MONITORING_PRESET } from "./multichannelMonitoringPreset.js";

describe("Multichannel Monitoring Preset", () => {
  it("is the exact document published by the official Sharesets artifact", () => {
    const pack = JSON.parse(
      readFileSync(
        new URL(
          "../../sharesets/catalogue/artifacts/multichannel-monitoring-v1.plvspreset",
          import.meta.url
        ),
        "utf8"
      )
    );
    const { id, ...published } = pack.items[0];

    expect(id).toBe("multichannel-monitoring");
    expect(published).toEqual(MULTICHANNEL_MONITORING_PRESET);
  });

  it("keeps the asymmetric five-panel layout and source-adaptive controls", () => {
    const preset = MULTICHANNEL_MONITORING_PRESET;
    expect(preset.name).toBe("Multichannel Monitoring");
    expect(preset.workspace.layout).toMatchObject({
      direction: "horizontal",
      weights: [0.38, 0.62],
      children: [
        { key: "level-meter" },
        {
          direction: "vertical",
          weights: [0.31, 0.31, 0.38],
          children: [
            { key: "waveform" },
            { key: "spectrum" },
            {
              direction: "horizontal",
              weights: [0.5, 0.5],
              children: [{ key: "vectorscope" }, { key: "stats" }],
            },
          ],
        },
      ],
    });
    expect(preset.workspace.panels.map(({ moduleId }) => moduleId)).toEqual([
      "levelMeter",
      "waveform",
      "stats",
      "spectrum",
      "vectorscope",
    ]);
    expect(preset.loudnessProfile.dependencyId).toBeNull();
  });

  it("compiles Level Zones, six-channel Waveform data, and an L/R Vectorscope without source state", () => {
    const stored = portableToStoredPreset(MULTICHANNEL_MONITORING_PRESET, "multichannel-preview");
    const byModule = Object.fromEntries(
      stored.panelOrder.map((id) => [stored.panelsById[id].moduleId, stored.panelControlsById[id]])
    );
    expect(byModule.levelMeter).toMatchObject({
      levelMeterMode: "peak",
      levelMeterBarColors: "levelZones",
      levelMeterTpMaxMarker: true,
      levelMeterPeakWarningDb: -6,
      levelMeterPeakCriticalDb: -1,
      levelMeterYMinDb: -60,
      levelMeterYMaxDb: 0,
    });
    expect(byModule.waveform).toMatchObject({
      waveformFrequencyColor: true,
      waveformCentroid: false,
    });
    expect(byModule.spectrum).toMatchObject({
      spectrumChannel: { type: "pair", x: 0, y: 1 },
      spectrumView: "combined",
      spectrumMaxMode: "decay",
      spectrumPeakLabels: true,
      spectrumGrid: false,
    });
    expect(byModule.vectorscope).toMatchObject({
      vectorscopePair: { x: 0, y: 1 },
      vectorscopeMode: "lissajous",
      vectorscopePolarLevelMaxHold: false,
    });
  });
});
