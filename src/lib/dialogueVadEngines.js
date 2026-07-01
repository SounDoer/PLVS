export const DIALOGUE_VAD_ENGINE_OPTIONS = [
  {
    id: "silero",
    label: "Silero VAD",
    url: "https://github.com/snakers4/silero-vad",
  },
  {
    id: "firered",
    label: "FireRedVAD",
    url: "https://github.com/FireRedTeam/FireRedVAD",
  },
  {
    id: "ten",
    label: "TEN VAD",
    url: "https://github.com/TEN-framework/ten-vad",
  },
];

export const DEFAULT_DIALOGUE_VAD_ENGINE = "firered";

const DIALOGUE_VAD_ENGINE_IDS = new Set(DIALOGUE_VAD_ENGINE_OPTIONS.map((option) => option.id));

export function normalizeDialogueVadEngine(value) {
  return DIALOGUE_VAD_ENGINE_IDS.has(value) ? value : DEFAULT_DIALOGUE_VAD_ENGINE;
}
