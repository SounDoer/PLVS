# File History Retention Measurements

This implementation record covers the first internal File history target. It does not establish
a process-memory ceiling or change Live History Length.

## Reproduction and scope

Run `node --expose-gc scripts/file-history-memory.mjs` on Windows with the repository's Node runtime.
The script feeds real `FrameIntake` stores synthetic 10 Hz File checkpoints and writes the machine
results to `artifacts/file-mode-history/memory.json`. It includes scalar/audio/channel stores,
query indexes, waveform, Spectrum request keys, and a separate all-visual case with Vectorscope
and all Stereo Map modes. Unknown-duration stores grow lazily without a declared upper duration.

The retained estimate counts backing ArrayBuffers once across aliases plus estimated JavaScript
containers/references. It deliberately counts unused chunk capacity. Object headers are estimates,
not a JavaScript-engine contract. Process RSS includes allocator/GC effects and cannot be equated
to retained history. These are synthetic Node observations, not a completed WebView acceptance.

## Windows baseline, 2026-11-11

| Fixture                                        | Retained estimate (bytes) | Accounting (ms) | Process RSS (bytes) |
| ---------------------------------------------- | ------------------------: | --------------: | ------------------: |
| Stereo, 3 minutes, 256 bands                   |                 4,993,782 |            0.90 |          66,916,352 |
| Stereo, 30 minutes, 256 bands                  |                32,352,118 |            1.45 |          95,674,368 |
| Stereo, 2 hours, 256 bands                     |               122,525,022 |            3.47 |         190,525,440 |
| Stereo, 4 hours, 256 bands                     |               241,604,378 |            5.73 |         336,666,624 |
| 8 channels, 30 minutes, two 512-band requests  |                95,518,984 |            1.33 |         189,526,016 |
| 16 channels, 30 minutes, two 512-band requests |               103,908,232 |            1.47 |         198,180,864 |
| Stereo, 10 minutes, all visual families        |                28,578,648 |            1.08 |         124,825,600 |
| Unknown duration, 30 minutes, 256 bands        |                31,351,222 |            1.67 |         125,378,560 |

## Initial policy

Use a 256 MiB estimated retained-storage target shared by File entries. This accommodates one
four-hour stereo Spectrum example or several shorter/multichannel examples. The current file,
the active task's previous result and staging history, and a result preparing a task are protected;
they may exceed the target. Live's independent retained history also adds memory outside it.
The target is therefore a cache policy, never permission to truncate an individual file or drop
statistics. Budget pressure releases eligible histories in least-recently-viewed order. Background
progress/completion does not touch view recency. Result count has no automatic limit.

Account on admission, selection and task retirement, and at most once per second of lifecycle/
progress updates while histories grow. Do not traverse storage from the frame callback. Restoration
uses the shared worker with the original source fingerprint, track and conditions and publishes
history only; it does not replace the retained statistical result or original analysis timestamp.

## Remaining acceptance

Observe WebView/process memory with many short files, retained Live history, a protected reanalysis,
and restore/cancel/fail cycles. Confirm released histories become collectable after selection and
Snapshot changes; measure source fingerprint and restoration elapsed time. These checks belong to
the desktop/final integration stage and remain outstanding until recorded here. Tune the internal
target if those observations show excessive pressure; no user memory setting is introduced.
