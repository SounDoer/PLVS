# Dialogue-Gated Loudness

Readouts based on automatically detected spoken-voice activity, using an on-device voice activity
detector — no audio leaves your machine. Detection can include background speech or singing and can
miss quiet, masked, processed, or unusual speech; PLVS does not identify which voice is narratively
primary.

## Collection

Dialogue Detection is on by default and runs throughout Live and File measurements, whether or not
a dialogue row is currently visible in Stats. Adding or hiding a row changes only the display; it
does not restart the measurement.

## Readouts

- **Dialogue Loudness (DL)** — BS.1770 loudness over detected dialogue, with the −70 LUFS absolute
  gate and without the Programme Loudness relative gate.
- **Loudness-to-Dialogue Ratio (LDR)** — Programme Loudness minus Dialogue Loudness. A positive
  value means the programme is louder than its dialogue-gated measurement.
- **Dialogue Coverage (Dlg Cov)** — detected dialogue duration as a share of valid measurement time,
  including silence but excluding audio gaps. It is highlighted while speech is detected now.
- **Dialogue Range (Dlg Rng)** — the weighted 10th–95th percentile variation of dialogue-masked
  three-second loudness observations.

DL and LDR follow the dialogue-measurement relationship used by EBU R 128 S4 and ATSC A/85.
Dialogue Coverage and Dialogue Range are PLVS auxiliary metrics, not standardized compliance
measurements.

## Choosing a detector

**Dialogue Detection** in [System Settings](system-settings.md) chooses the engine: FireRedVAD (the
default) or Silero VAD. Changing the detector clears and restarts the complete Live measurement so
Programme Loudness and all dialogue values continue to cover the same time span. File Mode locks
the selected engine when analysis starts.

## Limits

These readouts are monitoring estimates, not certified dialogue measurements. Automatic detectors
can disagree materially with a reviewed dialogue mask, especially with music vocals, background
voices, overlapping speakers, effects, or heavily processed speech. Use them for monitoring, not
compliance sign-off.
