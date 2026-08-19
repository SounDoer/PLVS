/**
 * @typedef {object} MeterHistoryEntry
 * @property {number} timestampMs
 * @property {number[]} rmsDb
 * @property {number} lufsMomentary
 * @property {number} lufsShortTerm
 * @property {number} lufsMMax
 * @property {number} lufsStMax
 * @property {number} integrated
 * @property {number} lra
 * @property {number} dialogueIntegrated
 * @property {number} dialogueLra
 * @property {number} dialoguePercent
 * @property {number} truePeakL
 * @property {number} truePeakR
 * @property {number} truePeakMaxDbtp
 * @property {number} sampleLDb
 * @property {number} sampleRDb
 * @property {number} samplePeakMaxL
 * @property {number} samplePeakMaxR
 * @property {number} correlation
 * @property {number} sideToMidDb
 * @property {number[]} waveformMin
 * @property {number[]} waveformMax
 * @property {number[]} dominantFrequencyHz
 * @property {number[]} spectralCentroidHz
 * @property {number[]} tonality
 * @property {Float32Array|number[]} waveformSubPairs flat, stride 2*channelCount: [minCh0,maxCh0,...] per sub-block
 * @property {number} waveformSubCount sub-blocks in this tick
 * @property {string} loudnessLayout
 * @property {boolean} loudnessLayoutKnown
 */

/**
 * @typedef {object} AudioFramePayload
 * @property {number[]} peakDb
 * @property {number[]} rmsDb
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
 * @property {number} sideToMidDb
 * @property {number} vectorscopePairX
 * @property {number} vectorscopePairY
 * @property {Record<string, SpectrumFrameResult>} spectrumResultsByKey
 * @property {Record<string, VectorscopeFrameResult>} vectorscopeResultsByKey
 * @property {Record<string, StereoMapFrameResult>} stereoMapResultsByKey
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
 * @property {number} sideToMidDb
 * @property {number} midEnergy
 * @property {number} sideEnergy
 */

/**
 * @typedef {object} StereoMapVisualEntry
 * @property {number[]} bandCentersHz
 * @property {number[]} pl
 * @property {number[]} pr
 * @property {number[]} c
 */

/**
 * @typedef {object} VisualHistEntry
 * @property {number} timestampMs
 * @property {number[]} waveformMin
 * @property {number[]} waveformMax
 * @property {number[]} dominantFrequencyHz
 * @property {number[]} spectralCentroidHz
 * @property {number[]} tonality
 * @property {number} correlation
 * @property {number} sideToMidDb
 * @property {Record<string, SpectrumVisualEntry>} spectrumByKey
 * @property {Record<string, VectorscopeVisualEntry>} vectorscopeByKey
 * @property {Record<string, StereoMapVisualEntry>} stereoMapByKey
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
 * @property {number} sideToMidDb
 * @property {number} midEnergy
 * @property {number} sideEnergy
 * @property {number} pairX
 * @property {number} pairY
 */

/**
 * @typedef {object} StereoMapFrameResult
 * @property {number[]} bandCentersHz
 * @property {number[]} pl
 * @property {number[]} pr
 * @property {number[]} c
 */

/**
 * @typedef {object} EngineStateChangedPayload
 * @property {"running"|"stopped"|"error"} state
 * @property {string|undefined} error
 */

/**
 * @typedef {object} SpectrumAnalysisRequest
 * @property {string} key
 * @property {{ type: "pair"; x: number; y: number } | { type: "single"; ch: number }} channel
 * @property {string} view
 * @property {number} speedPercent
 * @property {number} tiltDbPerOctave
 * @property {string} octaveSmoothing
 */

/**
 * @typedef {object} VectorscopeAnalysisRequest
 * @property {string} key
 * @property {number} x
 * @property {number} y
 */

/**
 * @typedef {object} StereoMapAnalysisRequest
 * @property {string} key
 * @property {{ first: number; second: number }} pair
 * @property {number} speedPercent
 * @property {string} octaveSmoothing
 */

/**
 * @typedef {object} AnalysisRequests
 * @property {SpectrumAnalysisRequest[]} spectrum
 * @property {VectorscopeAnalysisRequest[]} vectorscope
 * @property {StereoMapAnalysisRequest[]} stereoMap
 * @property {boolean} spectralWaveform
 */

export {};
