# PLVS Patch Notes

This directory vendors `voice_activity_detector` 0.2.1 (MIT) so PLVS can keep
the existing Silero VAD behavior while sharing one ONNX Runtime version with
additional VAD engines.

Local dependency changes:

- `ort` / `ort-sys`: `2.0.0-rc.10` to `2.0.0-rc.12`
- `ndarray`: `0.16.1` to `0.17.2`

No Silero model logic has been intentionally changed.
