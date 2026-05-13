/**
 * Reset in-memory metering buffers for the float webview (mirrors main `clearAll` Tauri path).
 * @param {object} ctx
 * @param {import("react").MutableRefObject<number>} ctx.frameRef
 * @param {import("react").MutableRefObject<number>} ctx.selectedOffsetRef
 * @param {import("react").MutableRefObject} ctx.histRef
 * @param {import("react").MutableRefObject} ctx.loudnessHistRef
 * @param {import("react").MutableRefObject} ctx.spectrumDataRef
 * @param {import("react").MutableRefObject} ctx.spectrumDataSnapRef
 * @param {import("react").MutableRefObject} ctx.spectrumSnapRef
 * @param {import("react").MutableRefObject} ctx.vectorSnapRef
 * @param {import("react").MutableRefObject} ctx.corrSnapRef
 * @param {import("react").MutableRefObject} ctx.audioSnapRef
 * @param {(v: object) => void} ctx.setAudio
 * @param {(s: string) => void} ctx.setSpectrumPath
 * @param {(s: string) => void} ctx.setSpectrumPeakPath
 * @param {(s: string) => void} ctx.setVectorPath
 * @param {(n: number) => void} ctx.setSelectedOffset
 */
export function resetFloatMeteringState(ctx) {
  const {
    frameRef,
    selectedOffsetRef,
    histRef,
    loudnessHistRef,
    spectrumDataRef,
    spectrumDataSnapRef,
    spectrumSnapRef,
    vectorSnapRef,
    corrSnapRef,
    audioSnapRef,
    setAudio,
    setSpectrumPath,
    setSpectrumPeakPath,
    setVectorPath,
    setSelectedOffset,
  } = ctx;
  frameRef.current = 0;
  selectedOffsetRef.current = -1;
  histRef.current = [];
  loudnessHistRef.current = [];
  spectrumDataRef.current = null;
  spectrumDataSnapRef.current = [];
  spectrumSnapRef.current = [];
  vectorSnapRef.current = [];
  corrSnapRef.current = [];
  audioSnapRef.current = [];
  setSpectrumPath("");
  setSpectrumPeakPath("");
  setVectorPath("");
  setAudio({
    momentary: -Infinity,
    shortTerm: -Infinity,
    integrated: -Infinity,
    mMax: -Infinity,
    stMax: -Infinity,
    lra: -Infinity,
    tpL: -Infinity,
    tpR: -Infinity,
    truePeakL: -Infinity,
    truePeakR: -Infinity,
    tpMax: -Infinity,
    samplePeakMaxL: -Infinity,
    samplePeakMaxR: -Infinity,
    sampleL: -Infinity,
    sampleR: -Infinity,
    samplePeak: -Infinity,
    correlation: -Infinity,
  });
  setSelectedOffset(-1);
}
