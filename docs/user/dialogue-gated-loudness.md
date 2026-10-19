# Dialogue-Gated Loudness

Readouts based on automatically detected spoken-voice activity, using an on-device voice activity
detector — no audio leaves your machine. Detection can include background speech or singing and can
miss quiet, masked, processed, or unusual speech; PLVS does not identify which voice is narratively
primary.

## Collection

Dialogue Detection is on by default and runs throughout Live and File measurements, whether or not
a dialogue row is currently visible in Stats. Adding or hiding a row changes only the display; it
does not restart the measurement.

For multichannel audio, PLVS analyzes non-LFE channels independently instead of averaging them.
When the channel layout has a centre channel, detected centre speech takes priority; substantially
stronger speech routed elsewhere can still be included. With no known centre channel, speech on
any non-LFE channel can be included. Choose the correct channel layout or channel roles so PLVS can
apply this routing as intended.

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
default) or Silero VAD v6.2. Changing the detector clears and restarts the complete Live measurement
so Programme Loudness and all dialogue values continue to cover the same time span. File Mode locks
the selected engine when analysis starts.

In Live, detection runs beside the meters rather than in step with them, so dialogue readouts can
trail the programme readouts by a fraction of a second; the values themselves are the same. If the
computer cannot keep up with detection on every channel, PLVS stops Dialogue Detection rather than
skip audio, and **Clear** starts it again.

If the selected detector cannot start or stops producing valid results, PLVS shows one explicit
error and leaves dialogue values as `—`; Programme Loudness and the other measurements continue.
File reports record the detector error instead of presenting the missing dialogue values as a
successful result. PLVS does not silently switch to the other detector.

## Limits

These readouts are monitoring estimates, not certified dialogue measurements. Automatic detectors
can disagree materially with a reviewed dialogue mask, especially with music vocals, background
voices, overlapping speakers, effects, or heavily processed speech. Use them for monitoring, not
compliance sign-off.
