import { loudnessProfileEvaluate } from "../lib/loudnessProfileEvaluate.js";
import { buildStatsValues, hasCorrelationSignal, STATS_META } from "../lib/statsCatalog.js";

export const MEASUREMENT_SCHEMA_VERSION = 1;
export const MEASUREMENT_FRESHNESS_THRESHOLD_MS = 2000;
export const MEASUREMENT_AVAILABILITY_REASONS = Object.freeze([
  "noSample",
  "notReady",
  "analysisInactive",
  "dialogueInactive",
  "noDialogue",
  "insufficientChannels",
  "belowSignalFloor",
]);

function descriptor(path, label, unit, basis) {
  return Object.freeze({ path, label, unit, basis });
}

export const MEASUREMENT_METRICS = Object.freeze([
  descriptor("levels.channels[].peakDbfs", "Sample Peak", "dBFS", "currentFrame"),
  descriptor("levels.channels[].rmsDbfs", "RMS", "dBFS", "liveWindow"),
  descriptor("levels.truePeak.leftDbtp", "True Peak Left", "dBTP", "currentFrame"),
  descriptor("levels.truePeak.rightDbtp", "True Peak Right", "dBTP", "currentFrame"),
  descriptor("levels.truePeak.maxDbtp", STATS_META.truePeak.label, "dBTP", "liveSession"),
  descriptor("loudness.momentaryLufs", STATS_META.momentary.label, "LUFS", "liveWindow"),
  descriptor("loudness.shortTermLufs", STATS_META.shortTerm.label, "LUFS", "liveWindow"),
  descriptor("loudness.integratedLufs", STATS_META.integrated.label, "LUFS", "liveSession"),
  descriptor("loudness.momentaryMaxLufs", STATS_META.momentaryMax.label, "LUFS", "liveSession"),
  descriptor("loudness.shortTermMaxLufs", STATS_META.shortTermMax.label, "LUFS", "liveSession"),
  descriptor("loudness.rangeLu", STATS_META.lra.label, "LU", "liveSession"),
  descriptor("loudness.psrDb", STATS_META.psr.label, "dB", "derived"),
  descriptor("loudness.plrDb", STATS_META.plr.label, "dB", "derived"),
  descriptor("stereo.correlation", STATS_META.correlation.label, "", "currentFrame"),
  descriptor("stereo.sideToMidDb", STATS_META.sideToMid.label, "dB", "currentFrame"),
  descriptor("dialogue.activeNow", "Dialogue Active Now", "boolean", "currentFrame"),
  descriptor("dialogue.coveragePercent", STATS_META.dialogueCoverage.label, "%", "liveSession"),
  descriptor("dialogue.integratedLufs", STATS_META.dialogueIntegrated.label, "LUFS", "liveSession"),
  descriptor("dialogue.rangeLu", STATS_META.dialogueRange.label, "LU", "liveSession"),
  descriptor("dialogue.offsetLu", STATS_META.dialogueOffset.label, "LU", "derived"),
  descriptor("profile.overall", "Loudness Profile Overall", "status", "evaluation"),
]);

export function buildMeasurementDescription(revision) {
  return {
    revision,
    schemaVersion: MEASUREMENT_SCHEMA_VERSION,
    source: "live",
    freshnessThresholdMs: MEASUREMENT_FRESHNESS_THRESHOLD_MS,
    metrics: MEASUREMENT_METRICS.map((metric) => ({ ...metric })),
    availabilityReasons: [...MEASUREMENT_AVAILABILITY_REASONS],
  };
}

function finiteOrNull(value, path, reason, unavailable) {
  if (Number.isFinite(value)) return value;
  unavailable[path] = reason;
  return null;
}

function nullWithReason(path, reason, unavailable) {
  unavailable[path] = reason;
  return null;
}

function overallProfileStatus(byMetric) {
  const rank = { ok: 0, pending: 1, warn: 2, fail: 3 };
  let overall = "ok";
  for (const status of Object.values(byMetric)) {
    if ((rank[status] ?? -1) > rank[overall]) overall = status;
  }
  return overall;
}

function profileResult(profile, values) {
  if (!profile?.document) {
    return { mode: "off", id: null, name: null, overall: "off", byMetric: {} };
  }
  const byMetric = loudnessProfileEvaluate(profile.document, {
    values,
    integratedReady: Number.isFinite(values.integrated),
  });
  return {
    mode: profile.mode === "preview" ? "preview" : "saved",
    id: typeof profile.id === "string" ? profile.id : null,
    name: typeof profile.name === "string" ? profile.name : null,
    overall: overallProfileStatus(byMetric),
    byMetric,
  };
}

function sourceState(value) {
  return ["starting", "running", "stopping", "stopped", "error"].includes(value)
    ? value
    : "stopped";
}

/**
 * Format one immutable LIVE record. This function is deliberately pure and bounded: it reads no
 * presentation/history state and cannot create optional analysis demand.
 */
export function buildMeasurementInspection({
  revision,
  observedAtMs = Date.now(),
  liveState,
  sessionGeneration = 0,
  record = null,
  channelLabels = [],
  vectorscopeRequest = null,
  dialogueActive = false,
  profile = null,
}) {
  const observed = Number.isFinite(observedAtMs) ? observedAtMs : Date.now();
  const unavailable = {};
  const noSample = !record;
  const audio = record?.audio ?? {};
  const stats = buildStatsValues(audio);
  const labels = Array.isArray(channelLabels) ? channelLabels : [];
  const peaks = Array.isArray(audio.peakDb) ? audio.peakDb : [];
  const rms = Array.isArray(audio.rmsDb) ? audio.rmsDb : [];
  const channelCount = noSample ? 0 : Math.max(peaks.length, rms.length);
  const missingReason = noSample ? "noSample" : "notReady";
  const channels = Array.from({ length: channelCount }, (_, index) => ({
    index,
    label: String(labels[index] ?? `Ch ${index + 1}`),
    peakDbfs: finiteOrNull(
      peaks[index],
      `levels.channels[${index}].peakDbfs`,
      missingReason,
      unavailable
    ),
    rmsDbfs: finiteOrNull(
      rms[index],
      `levels.channels[${index}].rmsDbfs`,
      missingReason,
      unavailable
    ),
  }));

  const scalar = (value, path) => finiteOrNull(value, path, missingReason, unavailable);
  const levels = {
    channels,
    truePeak: {
      leftDbtp: scalar(audio.truePeakL, "levels.truePeak.leftDbtp"),
      rightDbtp: scalar(audio.truePeakR, "levels.truePeak.rightDbtp"),
      maxDbtp: scalar(stats.truePeak, "levels.truePeak.maxDbtp"),
    },
  };
  const loudness = {
    momentaryLufs: scalar(stats.momentary, "loudness.momentaryLufs"),
    shortTermLufs: scalar(stats.shortTerm, "loudness.shortTermLufs"),
    integratedLufs: scalar(stats.integrated, "loudness.integratedLufs"),
    momentaryMaxLufs: scalar(stats.momentaryMax, "loudness.momentaryMaxLufs"),
    shortTermMaxLufs: scalar(stats.shortTermMax, "loudness.shortTermMaxLufs"),
    rangeLu:
      Number.isFinite(stats.integrated) && Number.isFinite(stats.lra)
        ? stats.lra
        : nullWithReason("loudness.rangeLu", missingReason, unavailable),
    psrDb: scalar(stats.psr, "loudness.psrDb"),
    plrDb: scalar(stats.plr, "loudness.plrDb"),
  };

  const validPair =
    vectorscopeRequest &&
    Number.isInteger(vectorscopeRequest.x) &&
    Number.isInteger(vectorscopeRequest.y) &&
    vectorscopeRequest.x >= 0 &&
    vectorscopeRequest.y >= 0 &&
    vectorscopeRequest.x < channelCount &&
    vectorscopeRequest.y < channelCount &&
    vectorscopeRequest.x !== vectorscopeRequest.y;
  let stereoReason = null;
  if (noSample) stereoReason = "noSample";
  else if (channelCount < 2) stereoReason = "insufficientChannels";
  else if (!vectorscopeRequest) stereoReason = "analysisInactive";
  else if (!validPair) stereoReason = "insufficientChannels";
  else if (
    audio.vectorscopePairX !== vectorscopeRequest.x ||
    audio.vectorscopePairY !== vectorscopeRequest.y
  ) {
    stereoReason = "notReady";
  } else if (!hasCorrelationSignal(audio)) stereoReason = "belowSignalFloor";
  const stereoPair = validPair
    ? {
        x: vectorscopeRequest.x,
        y: vectorscopeRequest.y,
        labels: [
          String(labels[vectorscopeRequest.x] ?? `Ch ${vectorscopeRequest.x + 1}`),
          String(labels[vectorscopeRequest.y] ?? `Ch ${vectorscopeRequest.y + 1}`),
        ],
      }
    : null;
  const stereo = {
    pair: stereoPair,
    correlation:
      stereoReason === null
        ? finiteOrNull(audio.correlation, "stereo.correlation", "notReady", unavailable)
        : nullWithReason("stereo.correlation", stereoReason, unavailable),
    sideToMidDb:
      stereoReason === null
        ? finiteOrNull(audio.sideToMidDb, "stereo.sideToMidDb", "notReady", unavailable)
        : nullWithReason("stereo.sideToMidDb", stereoReason, unavailable),
  };

  const sampleDialogueActive = record?.dialogueActive === true;
  let dialogueReason = null;
  if (noSample) dialogueReason = "noSample";
  else if (!dialogueActive || !sampleDialogueActive) dialogueReason = "dialogueInactive";
  const dialogue = {
    active: dialogueActive === true,
    activeNow:
      dialogueReason === null
        ? Boolean(audio.dialogueActiveNow)
        : nullWithReason("dialogue.activeNow", dialogueReason, unavailable),
    coveragePercent:
      dialogueReason === null
        ? finiteOrNull(stats.dialogueCoverage, "dialogue.coveragePercent", "notReady", unavailable)
        : nullWithReason("dialogue.coveragePercent", dialogueReason, unavailable),
    integratedLufs:
      dialogueReason === null
        ? finiteOrNull(
            stats.dialogueIntegrated,
            "dialogue.integratedLufs",
            "noDialogue",
            unavailable
          )
        : nullWithReason("dialogue.integratedLufs", dialogueReason, unavailable),
    rangeLu:
      dialogueReason === null && Number.isFinite(stats.dialogueIntegrated)
        ? finiteOrNull(stats.dialogueRange, "dialogue.rangeLu", "notReady", unavailable)
        : nullWithReason("dialogue.rangeLu", dialogueReason ?? "noDialogue", unavailable),
    offsetLu:
      dialogueReason === null && Number.isFinite(stats.dialogueIntegrated)
        ? finiteOrNull(stats.dialogueOffset, "dialogue.offsetLu", "notReady", unavailable)
        : nullWithReason("dialogue.offsetLu", dialogueReason ?? "noDialogue", unavailable),
  };

  const receivedAtMs = Number.isFinite(record?.receivedAtMs) ? record.receivedAtMs : null;
  const ageMs = receivedAtMs === null ? null : Math.max(0, observed - receivedAtMs);
  const state = sourceState(liveState);
  const freshness = noSample
    ? "unavailable"
    : state === "running" && ageMs <= MEASUREMENT_FRESHNESS_THRESHOLD_MS
      ? "fresh"
      : "stale";

  return {
    revision,
    schemaVersion: MEASUREMENT_SCHEMA_VERSION,
    observedAt: new Date(observed).toISOString(),
    source: {
      kind: "live",
      state,
      sessionGeneration,
    },
    sample: {
      sequence: Number.isSafeInteger(record?.sequence) ? record.sequence : null,
      elapsedMs: Number.isFinite(record?.elapsedMs) ? record.elapsedMs : null,
      receivedAt: receivedAtMs === null ? null : new Date(receivedAtMs).toISOString(),
      ageMs,
      freshness,
    },
    topology: {
      channelCount,
      channelLabels: channels.map((channel) => channel.label),
      loudnessLayout: noSample ? null : String(record.loudnessLayout ?? "unknown"),
      loudnessLayoutKnown: noSample ? false : record.loudnessLayoutKnown === true,
    },
    levels,
    loudness,
    stereo,
    dialogue,
    profile: profileResult(profile, stats),
    unavailable,
  };
}
