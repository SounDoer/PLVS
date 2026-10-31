# Canonical 48 kHz Speech PCM

These four losslessly gzip-compressed files contain mono, little-endian float32 samples derived
from the attributed LibriSpeech FLAC files in `../sources/`. Their license and attribution are
the same CC BY 4.0 terms documented in the [corpus README](../README.md).

`../manifest.json` owns file paths, compressed and raw SHA-256 pins, frame counts, sample rate,
the conversion recipe and complete generated-programme hashes. No decoder, resampler or network
access is needed to read these inputs during standard fixture generation.

| ID        | Original clip           | Frames at 48 kHz |
| --------- | ----------------------- | ---------------- |
| `clean-a` | `6930-75918-0000.flac`  | 168240           |
| `clean-b` | `1320-122617-0000.flac` | 376080           |
| `other-a` | `7902-96591-0000.flac`  | 100560           |
| `other-b` | `5764-299665-0095.flac` | 97920            |

The reviewed conversion uses the pinned FFmpeg 7.1.5 source, scalar arithmetic with separate
multiply/add, and `-ar 48000 -ac 1 -f f32le`. Assembly, compiler vectorization and floating-point
contraction were disabled when creating the reference samples. Gzip stores those bytes without
loss; the committed streams use no filename and a zero timestamp. The four complete programme
WAVs reconstructed from these inputs match the historical hashes, including both published
dialogue preview inputs. This build is not installed or used for production audio processing.

Keep the original FLACs as source provenance. For an intentional source/recipe change, prepare
candidate PCM outside this directory, inspect its duration and samples, review the audio and
rights, then update the compressed files, both hashes and programme pins together. Recheck the
full corpus and deliberately regenerate/review affected previews if their input identity changes.
Do not use a local generator result or new hash as automatic authority to replace a reference.
