# Dialogue-Gated Loudness

Optional readouts that measure loudness only while dialogue is detected, using an on-device voice
activity detector — no audio leaves your machine.

## Turning it on

Add any dialogue readout to the Stats panel. Detection runs only while one is shown.

## Readouts

- **Dialogue Coverage** — the share of time dialogue is detected. It is highlighted while speech is
  detected right now.
- **Dialogue Integrated** — integrated loudness over dialogue only.
- **Dialogue Range** — loudness range over dialogue only.
- **Dialogue Offset** — how far dialogue sits above or below the overall mix.

## Choosing a detector

**Dialogue Detection** in [System Settings](system-settings.md) chooses the engine: Silero VAD (the
default), FireRedVAD, or TEN VAD. Changing the detector restarts the measurement.

## Limits

These readouts are a real-time monitoring estimate, not a certified dialogue measurement. The
open-source detectors differ from the proprietary Dolby Dialogue Intelligence used by certified
broadcast tools, so values can differ by a small margin. Singing counts as speech, so readings run
high on music with prominent vocals. Use them for monitoring, not compliance sign-off.
