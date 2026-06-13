/**
 * @typedef {object} MeterHistoryEntry
 * @property {number} timestampMs
 * @property {number} lufsMomentary
 * @property {number} lufsShortTerm
 * @property {number} integrated
 * @property {number} lra
 * @property {number} truePeakL
 * @property {number} truePeakR
 * @property {number} truePeakMaxDbtp
 * @property {number} sampleLDb
 * @property {number} sampleRDb
 * @property {number} samplePeakMaxL
 * @property {number} samplePeakMaxR
 * @property {number} correlation
 * @property {number} vectorscopePairX
 * @property {number} vectorscopePairY
 * @property {number[]} spectrumBandCentersHz
 * @property {number[]} spectrumSmoothDb
 * @property {number[]} waveformMin
 * @property {number[]} waveformMax
 * @property {string} loudnessLayout
 * @property {boolean} loudnessLayoutKnown
 */

/**
 * @typedef {object} AudioFramePayload
 * @property {number[]} peakDb
 * @property {number[]} peakHoldDb
 * @property {number} truePeakMaxDbtp
 * @property {number} lufsMomentary
 * @property {number} lufsShortTerm
 * @property {number} lufsMMax
 * @property {number} lufsStMax
 * @property {number} integrated
 * @property {number} lra
 * @property {number} truePeakL
 * @property {number} truePeakR
 * @property {number} sampleLDb
 * @property {number} sampleRDb
 * @property {number} correlation
 * @property {string} vectorscopePath
 * @property {number} vectorscopePairX
 * @property {number} vectorscopePairY
 * @property {string} spectrumPath
 * @property {string} spectrumPeakPath
 * @property {number[]} spectrumBandCentersHz
 * @property {number[]} spectrumSmoothDb
 * @property {number} timestampMs
 * @property {MeterHistoryEntry|null|undefined} loudnessHistTick
 * @property {VisualHistEntry|null|undefined} visualHistTick
 */

/**
 * @typedef {object} VisualHistEntry
 * @property {number} timestampMs
 * @property {number[]} waveformMin
 * @property {number[]} waveformMax
 * @property {number[]} spectrumSmoothDb
 * @property {number[]} vectorscopePairs
 * @property {number} correlation
 */

/**
 * @typedef {object} EngineStateChangedPayload
 * @property {"running"|"stopped"|"error"} state
 * @property {string|undefined} error
 */

export {};
