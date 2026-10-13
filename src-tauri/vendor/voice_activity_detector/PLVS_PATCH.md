# PLVS Patch Notes

This directory vendors `voice_activity_detector` 0.2.1 (MIT) so PLVS can share
one ONNX Runtime version across its VAD engines and keep the Silero integration
auditable.

Local dependency changes:

- `ort` / `ort-sys`: `2.0.0-rc.10` to `2.0.0-rc.12`
- `ndarray`: `0.16.1` to `0.17.2`
- embedded Silero model: v5 to v6.2, SHA-256
  `1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3`
- streaming context support: 64 samples at 16 kHz (32 at 8 kHz)
