import { formatClock } from "../hooks/useSessionTimer.js";

const LANGUAGE_LABELS = {
  eng: "English",
  en: "English",
  zho: "Chinese",
  chi: "Chinese",
  zh: "Chinese",
  jpn: "Japanese",
  ja: "Japanese",
  kor: "Korean",
  ko: "Korean",
  fra: "French",
  fre: "French",
  fr: "French",
  deu: "German",
  ger: "German",
  de: "German",
  spa: "Spanish",
  es: "Spanish",
};

function joinParts(parts) {
  return parts.filter(Boolean).join(" - ");
}

function titleCaseToken(value) {
  if (!value) return "";
  const normalized = String(value).replace(/[_-]+/g, " ").trim();
  if (!normalized) return "";
  return normalized
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function formatCodec(codec) {
  if (!codec) return "Unknown codec";
  const value = String(codec).trim();
  const aliases = {
    aac: "AAC",
    ac3: "AC-3",
    eac3: "E-AC-3",
    dts: "DTS",
    flac: "FLAC",
    mp3: "MP3",
    opus: "Opus",
    pcm: "PCM",
    pcm_f32le: "PCM f32le",
    pcm_s16le: "PCM s16le",
    truehd: "TrueHD",
  };
  return aliases[value.toLowerCase()] ?? titleCaseToken(value);
}

export function formatContainer(container) {
  if (!container) return null;
  const primary = String(container).split(",")[0]?.trim();
  if (!primary) return null;
  const aliases = {
    matroska: "MKV",
    mov: "MOV",
    mp3: "MP3",
    mpegts: "MPEG-TS",
    ogg: "Ogg",
    wav: "WAV",
  };
  return aliases[primary.toLowerCase()] ?? primary.toUpperCase();
}

export function formatLanguage(language) {
  if (!language) return null;
  const value = String(language).trim();
  if (!value) return null;
  return LANGUAGE_LABELS[value.toLowerCase()] ?? value.toUpperCase();
}

export function formatSampleRate(sampleRateHz) {
  if (!Number.isFinite(sampleRateHz)) return null;
  const khz = sampleRateHz / 1000;
  return `${Number.isInteger(khz) ? khz.toFixed(0) : khz.toFixed(1)} kHz`;
}

export function formatChannelLayout(channels) {
  if (!Number.isFinite(channels)) return null;
  const layouts = {
    1: "Mono",
    2: "Stereo",
    6: "5.1",
    8: "7.1",
  };
  return layouts[channels] ?? `${channels} ch`;
}

export function formatTrackLabel(track) {
  if (!track) return "No audio track metadata";
  return joinParts([
    `Audio track ${track.index ?? 0}`,
    formatLanguage(track.language),
    formatCodec(track.codec),
    formatSampleRate(track.sampleRateHz),
    formatChannelLayout(track.channels),
  ]);
}

export function formatSessionMetadataLine(session) {
  const metadata = session?.metadata;
  const track = metadata?.selectedTrack;
  if (!metadata && !track) return "No media metadata";

  const durationMs = session?.summary?.durationMs ?? metadata?.durationMs;
  return joinParts([
    formatContainer(metadata?.container),
    formatTrackLabel(track),
    Number.isFinite(durationMs) ? formatClock(durationMs) : null,
  ]);
}

export function formatCompactSessionMetadata(session) {
  const metadata = session?.metadata;
  const track = metadata?.selectedTrack;
  if (!metadata && !track) return null;

  return joinParts([
    formatContainer(metadata?.container),
    formatCodec(track?.codec),
    formatChannelLayout(track?.channels),
  ]);
}

export function formatMetric(value, suffix) {
  return Number.isFinite(value) ? `${value.toFixed(1)} ${suffix}` : `-- ${suffix}`;
}

export function formatPeakPair(summary = {}) {
  if (!Number.isFinite(summary.integratedLufs) && !Number.isFinite(summary.truePeakMaxDbtp)) {
    return null;
  }
  return joinParts([
    formatMetric(summary.integratedLufs, "LUFS"),
    formatMetric(summary.truePeakMaxDbtp, "dBTP"),
  ]);
}
