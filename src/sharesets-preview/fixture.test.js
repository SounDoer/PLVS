import { describe, expect, it } from "vitest";
import {
  selectPolarWindow,
  aggregatePolarLevel,
  buildPolarLevelMaxHoldTable,
  polarLevelMaxHoldAt,
} from "../math/vectorscopePolarMath.js";
import { SHARESETS_PREVIEW_STEREO_V1 } from "../transfer/fixtures/sharesetsPreviewStereoV1.js";
import { SHARESETS_PREVIEW_DIALOGUE_STEREO_V1 } from "../transfer/fixtures/sharesetsPreviewDialogueStereoV1.js";
import { SHARESETS_PREVIEW_DIALOGUE_MULTICHANNEL_V1 } from "../transfer/fixtures/sharesetsPreviewDialogueMultichannelV1.js";
import { buildDefaultSharesetsPreviewAnalysisRequests } from "./defaultAnalysisRequests.js";
import { buildSharesetsPreviewFixtureValues } from "./fixture.js";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";

const defaultRequests = buildDefaultSharesetsPreviewAnalysisRequests();
const vectorscopeKey = defaultRequests.vectorscope[0].key;
const combinedKey = defaultRequests.spectrum.find(({ view }) => view === "combined").key;
const msKey = defaultRequests.spectrum.find(({ view }) => view === "ms").key;

describe("Sharesets Vectorscope preview data", () => {
  it("supplies deterministic non-silent stereo history for Polar Sample and Polar Level", () => {
    const build = () => buildSharesetsPreviewFixtureValues(SHARESETS_PREVIEW_STEREO_V1);
    const history = build().historyData.getVectorscopeHistoryForKey(vectorscopeKey);
    const rows = selectPolarWindow(history, 400);
    expect(rows).toHaveLength(5);
    expect(rows.at(-1).timestampMs).toBe(SHARESETS_PREVIEW_STEREO_V1.clock.durationMs);
    expect(rows.every(({ pairs }) => pairs.length === 200 && pairs.every(Number.isFinite))).toBe(
      true
    );
    expect(rows.some(({ pairs }) => pairs.some((value) => Math.abs(value) > 0.1))).toBe(true);
    expect(aggregatePolarLevel(rows).some((value) => value > 0)).toBe(true);
    const initialMaxHold =
      build().frameData.displayAudio.vectorscopeResultsByKey[vectorscopeKey].initialMaxHold;
    expect(initialMaxHold).toHaveLength(64);
    expect(initialMaxHold.some((value) => value > 0)).toBe(true);
    const recentOnlyMaxHold = polarLevelMaxHoldAt(
      buildPolarLevelMaxHoldTable(history),
      history.length - 1
    );
    expect(initialMaxHold.some((value, index) => value > recentOnlyMaxHold[index])).toBe(true);
    expect(history.rowAt(0).pairs).toEqual(
      build().historyData.getVectorscopeHistoryForKey(vectorscopeKey).rowAt(0).pairs
    );
    expect(history.rowAt(0).pairs[2]).not.toBe(history.rowAt(0).pairs[3]);
  });

  it("uses measured Discovery data instead of interpolated display curves", () => {
    const values = buildSharesetsPreviewFixtureValues(SHARESETS_PREVIEW_STEREO_V1);
    expect(SHARESETS_PREVIEW_STEREO_V1.source).toMatchObject({
      fileName: "discovery-hero.wav",
      windowStartMs: 18000,
      windowEndMs: 78000,
    });
    expect(values.historyData.histSourceList).toHaveLength(601);
    expect(values.historyData.visualWaveformHist).toHaveLength(601);
    expect(
      values.frameData.displayAudio.spectrumResultsByKey[combinedKey].bandCentersHz.length
    ).toBeGreaterThan(200);
    const spectrogram = values.historyData.getSpectrogramSnapsForKey(combinedKey);
    expect(spectrogram.length).toBe(601);
    expect(
      Array.from(
        { length: spectrogram.length - 1 },
        (_, index) =>
          spectrogram.rowAt(index + 1).timestampMs - spectrogram.rowAt(index).timestampMs
      ).every((spacingMs) => spacingMs === 100)
    ).toBe(true);
    expect(values.historyData).toMatchObject({ sourceMode: "live", running: true });
  });

  it("derives and stores only the analysis requests used by the real PLVS Default Preset", () => {
    expect(SHARESETS_PREVIEW_STEREO_V1.analysisRequests).toEqual(defaultRequests);
    const values = buildSharesetsPreviewFixtureValues(SHARESETS_PREVIEW_STEREO_V1);
    const results = values.frameData.displayAudio.spectrumResultsByKey;
    const combined = results[combinedKey];
    const ms = results[msKey];

    expect(combined.smoothDb).toHaveLength(combined.bandCentersHz.length);
    expect(combined.smoothDbB).toHaveLength(0);
    expect(ms.smoothDbB).toHaveLength(ms.bandCentersHz.length);
    expect(ms.smoothDbB).not.toEqual(ms.smoothDb);
    expect(results["spectrum:pair:0:1:lr:sp25:smoff"]).toBeUndefined();
    expect(
      values.historyData.getSpectrogramSnapsForKey("spectrum:pair:0:1:lr:sp25:smoff")
    ).toHaveLength(0);
  });

  it("carries every stateful first-run visual with its production Default setting", () => {
    const controls = DEFAULT_WORKSPACE_STATE.panelControlsById;
    const values = buildSharesetsPreviewFixtureValues(SHARESETS_PREVIEW_STEREO_V1);
    const spectrum = values.frameData.displayAudio.spectrumResultsByKey[msKey];

    expect(controls.vectorscope).toMatchObject({
      vectorscopeMode: "polarLevel",
      vectorscopePolarLevelMaxHold: true,
    });
    expect(controls.spectrum.spectrumMaxMode).toBe("decay");
    expect(spectrum.peakDb).toHaveLength(spectrum.smoothDb.length);
    expect(spectrum.peakDbB).toHaveLength(spectrum.smoothDbB.length);
    expect(spectrum.peakDb).not.toEqual(spectrum.smoothDb);
    expect(controls.levelMeter.levelMeterTpMaxMarker).toBe(true);
    expect(values.frameData.hasTpMaxValue).toBe(true);
    expect(values.frameData.displayAudio.tpMax).toBe(
      SHARESETS_PREVIEW_STEREO_V1.measurementFrame.loudness.truePeakDbtp
    );
    expect(controls["stereo-map"].stereoMapHold).toBe(false);
  });

  it("freezes the measured final frame for the Snapshot workspace", () => {
    const values = buildSharesetsPreviewFixtureValues(SHARESETS_PREVIEW_STEREO_V1, {
      snapshot: true,
    });
    expect(values.historyData.selectedOffset).toBe(0);
    expect(values.historyData.snapshotSpectrumByKey[combinedKey].length).toBe(601);
    expect(values.historyData.resolveSpectrumSnapshotForKey(msKey)).toMatchObject({
      missing: false,
    });
    const vectorscope = values.historyData.resolveVectorscopeSnapshotForKey(vectorscopeKey, {
      withMaxHold: true,
    });
    expect(vectorscope).toMatchObject({ missing: false, hasSignal: true });
    expect(vectorscope.pairs).toHaveLength(200);
    expect(vectorscope.maxHold).toHaveLength(64);
    expect(vectorscope.maxHold.some((value) => value > 0)).toBe(true);
  });
});

describe("Sharesets Dialogue preview data", () => {
  it("carries measured Dialogue metrics and the speaking-now state into Stats", () => {
    const values = buildSharesetsPreviewFixtureValues(SHARESETS_PREVIEW_DIALOGUE_STEREO_V1);
    const audio = values.frameData.displayAudio;
    const metrics = new Map(values.metricsData.statsMetrics.map((metric) => [metric.id, metric]));

    expect(audio).toMatchObject({
      dialogueIntegrated: expect.any(Number),
      dialogueLra: expect.any(Number),
      dialoguePercent: expect.any(Number),
      dialogueActiveNow: true,
    });
    expect(metrics.get("dialogueIntegrated").value).not.toBe("-");
    expect(metrics.get("loudnessToDialogueRatio").value).not.toBe("-");
    expect(metrics.get("dialogueCoverage").value).not.toBe("-");
    expect(metrics.get("dialogueRange").value).not.toBe("-");
    expect(values.metricsData.dialogueActiveNow).toBe(true);
    expect(values.historyData.histSourceList[0].waveformSubCount).toBeGreaterThan(1);
    expect(values.historyData.histSourceList[0].waveformSubPairs.length).toBeGreaterThan(0);
  });

  it("uses the documented LFE-attenuated derivative for the 5.1 catalogue preview", () => {
    expect(SHARESETS_PREVIEW_DIALOGUE_MULTICHANNEL_V1.source.derivation).toMatchObject({
      sourceFileName: "surround-dialogue.wav",
      recipe: "plvs-sharesets-dialogue-preview-lfe-minus-18db",
    });
    expect(SHARESETS_PREVIEW_DIALOGUE_MULTICHANNEL_V1.measurementFrame.peaksDbfs[3]).toBeLessThan(
      -18
    );
  });
});
