/**
 * Reset in-memory metering buffers (mirrors main `clearAll` Tauri path).
 * @param {object} ctx
 * @param {import("react").MutableRefObject<number>} ctx.frameRef
 * @param {import("react").MutableRefObject<number>} ctx.selectedOffsetRef
 * @param {import("./FrameIntake.js").FrameIntake} ctx.intake
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
    intake,
    setAudio,
    setSpectrumPath,
    setSpectrumPeakPath,
    setVectorPath,
    setSelectedOffset,
  } = ctx;
  frameRef.current = 0;
  selectedOffsetRef.current = -1;
  intake.reset();
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
