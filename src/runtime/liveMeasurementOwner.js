const AUDIO_FIELDS = Object.freeze([
  "truePeakL",
  "truePeakR",
  "tpMax",
  "momentary",
  "shortTerm",
  "integrated",
  "mMax",
  "stMax",
  "lra",
  "correlation",
  "sideToMidDb",
  "vectorscopePairX",
  "vectorscopePairY",
  "dialogueIntegrated",
  "dialogueLra",
  "dialoguePercent",
  "dialogueActiveNow",
]);

function freezeAudio(audio) {
  const frozen = {
    peakDb: Object.freeze(Array.from(audio?.peakDb ?? [])),
    rmsDb: Object.freeze(Array.from(audio?.rmsDb ?? [])),
  };
  for (const field of AUDIO_FIELDS) frozen[field] = audio?.[field];
  return Object.freeze(frozen);
}

function freezeRecord(frame, audio, generation, receivedAtMs, dialogueActive) {
  return Object.freeze({
    generation,
    sequence: Number.isSafeInteger(frame?.seq) ? frame.seq : null,
    elapsedMs: Number.isFinite(frame?.timestampMs) ? frame.timestampMs : null,
    receivedAtMs,
    loudnessLayout: typeof frame?.loudnessLayout === "string" ? frame.loudnessLayout : "unknown",
    loudnessLayoutKnown: frame?.loudnessLayoutKnown === true,
    dialogueActive: dialogueActive === true,
    audio: freezeAudio(audio),
  });
}

/** Process-local owner for the latest immutable LIVE semantic sample. */
export function createLiveMeasurementOwner({ now = () => Date.now() } = {}) {
  let generation = 0;
  let latest = null;
  let pending = null;

  return {
    beginSession() {
      if (pending) return pending.generation;
      pending = { generation: generation + 1, latest: null };
      return pending.generation;
    },
    commitSession() {
      if (!pending) return generation;
      generation = pending.generation;
      latest = pending.latest;
      pending = null;
      return generation;
    },
    abortSession() {
      pending = null;
    },
    capture(frame, audio, { dialogueActive = false } = {}) {
      const targetGeneration = pending?.generation ?? generation;
      const record = freezeRecord(frame, audio, targetGeneration, now(), dialogueActive);
      if (pending) pending.latest = record;
      else latest = record;
      return record;
    },
    clear() {
      generation += 1;
      latest = null;
      pending = null;
      return generation;
    },
    read() {
      return Object.freeze({ generation, record: latest });
    },
  };
}
