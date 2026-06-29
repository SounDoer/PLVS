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
 * @property {number[]} waveformMin
 * @property {number[]} waveformMax
 * @property {Float32Array|number[]} waveformSubPairs flat, stride 2*channelCount: [minCh0,maxCh0,...] per sub-block
 * @property {number} waveformSubCount sub-blocks in this tick
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
 * @property {number} vectorscopePairX
 * @property {number} vectorscopePairY
 * @property {Record<string, SpectrumFrameResult>} spectrumResultsByKey
 * @property {Record<string, VectorscopeFrameResult>} vectorscopeResultsByKey
 * @property {number} timestampMs
 * @property {MeterHistoryEntry|null|undefined} loudnessHistTick
 * @property {VisualHistEntry|null|undefined} visualHistTick
 */

/**
 * @typedef {object} SpectrumVisualEntry
 * @property {number[]} bandCentersHz
 * @property {number[]} smoothDb
 * @property {number[]} smoothDbB
 */

/**
 * @typedef {object} VectorscopeVisualEntry
 * @property {number[]} pairs
 * @property {number} correlation
 */

/**
 * @typedef {object} VisualHistEntry
 * @property {number} timestampMs
 * @property {number[]} waveformMin
 * @property {number[]} waveformMax
 * @property {number} correlation
 * @property {Record<string, SpectrumVisualEntry>} spectrumByKey
 * @property {Record<string, VectorscopeVisualEntry>} vectorscopeByKey
 */

/**
 * @typedef {object} SpectrumFrameResult
 * @property {string} path
 * @property {string} peakPath
 * @property {string} pathB
 * @property {string} peakPathB
 * @property {number[]} bandCentersHz
 * @property {number[]} smoothDb
 * @property {number[]} smoothDbB
 */

/**
 * @typedef {object} VectorscopeFrameResult
 * @property {string} path
 * @property {number} correlation
 * @property {number} pairX
 * @property {number} pairY
 */

/**
 * @typedef {object} EngineStateChangedPayload
 * @property {"running"|"stopped"|"error"} state
 * @property {string|undefined} error
 */

export {};
