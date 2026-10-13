# Dialogue VAD benchmark — first reproducible corpus

Date: 2026-10-13

This note records the first result from the repository-owned programme-dialogue benchmark. It is a
decision input, not living product documentation and not a universal VAD quality claim.

## Reproduction

Run:

```text
npm run benchmark:dialogue
```

The command verifies and generates corpus `plvs-dialogue-synthetic-v1`, downloads the exact audited
Silero v6.2 model when absent, runs the feature-gated harness, and writes JSON plus Markdown results
under `artifacts/dialogue-benchmark/`.

Corpus manifest SHA-256 for this run:
`955973cb0b193ff97d13ddbd6aa18b73b7a7573ea7d4235a6451c976d1c994ab`.

The speech sources are four attributed LibriSpeech SLR12 clips under CC BY 4.0. Programme music,
noise, LFE energy, stereo cancellation, and the voice-like music negative case are generated
deterministically. See `fixtures/dialogue-benchmark/README.md` for source identities and hashes.

Model identities:

- FireRed model from `firered-vad` 0.1.0:
  `b3c97836130dc34fc32d56fab551e88cf9454511de2b3c250a5e6578dee74b93`;
- shipped Silero v5:
  `2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f`;
- evaluated-only Silero v6.2:
  `1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3`.

Silero v6.2 requires the official 64-sample 16 kHz streaming context. An initial run without that
context returned all-negative output; the harness now applies it only to the v6.2 candidate and
keeps the shipped v5 adapter unchanged.

## Aggregate result

All values aggregate four programme cases on 100 ms aligned blocks. DL error is measured against
the same BS.1770 programme-energy blocks selected by the annotated dialogue mask. Coverage error is
in percentage points.

| Engine | Fusion | F1 | Precision | Recall | FP | FN | Mean abs DL error | Mean abs Coverage error | RTF |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| FireRed 0.1.0 | centre-priority fallback | 0.884 | 0.967 | 0.814 | 1.0 s | 6.7 s | 0.97 LU | 8.9 pp | 0.136 |
| FireRed 0.1.0 | independent non-LFE maximum | 0.871 | 0.936 | 0.814 | 2.0 s | 6.7 s | 0.81 LU | 10.7 pp | 0.141 |
| Silero v6.2 | centre-priority fallback | 0.853 | 0.917 | 0.797 | 2.6 s | 7.3 s | 1.29 LU | 13.0 pp | 0.021 |
| Silero v6.2 | independent non-LFE maximum | 0.824 | 0.852 | 0.797 | 5.0 s | 7.3 s | 1.04 LU | 17.3 pp | 0.021 |
| FireRed 0.1.0 | non-LFE energy-weighted mono | 0.783 | 0.921 | 0.681 | 2.1 s | 11.5 s | 0.64 LU | 15.4 pp | 0.040 |
| Silero v5 | centre-priority fallback | 0.759 | 0.891 | 0.661 | 2.9 s | 12.2 s | 1.59 LU | 18.3 pp | 0.010 |
| FireRed 0.1.0 | all-channel arithmetic average | 0.627 | 0.955 | 0.467 | 0.8 s | 19.2 s | 1.41 LU | 26.5 pp | 0.041 |

The omitted lower-ranked combinations remain in the generated JSON. Runtime factor is wall-clock
inference time divided by programme duration on the test machine; it is not isolated CPU time.

## Decision

1. Keep FireRed as the default. On this corpus it has the strongest accuracy/recall trade-off and
   remains comfortably faster than real time. The corpus is too small to justify changing the
   default merely because Silero v6.2 is newer.
2. Do not ship Silero v6.2 yet. Keep its correct adapter in the evaluation harness and expand the
   corpus before reconsidering the shipped Silero generation.
3. Remove the all-channel arithmetic average from the production detector feed. Stereo
   anti-correlation and LFE dilution make it structurally unsuitable, independent of model choice.
4. Implement `center-priority-fallback-v1`: evaluate the centre independently when the layout has
   one, and accept independent non-LFE evidence as fallback when another channel's block energy is
   more than twice the centre energy. Unknown layouts use independent non-LFE maximum. LFE never
   enters detection.
5. Treat the policy as versioned method identity and retain the full-Live-clear rule when it
   changes.

## Remaining limits

- The committed speech is English read speech, not a representative programme corpus.
- The voice-like music case is deterministic synthesis, not recorded singing.
- Peak memory remains unavailable in schema v1, and wall-clock RTF is not isolated CPU time.
- Boundary matching is 100 ms aligned and is unsuitable for claims below that resolution.
- Real broadcast material must stay outside the repository and should be added through a local
  manifest before a future default-engine change.

These limits do not weaken the structural finding that arithmetic channel averaging can cancel or
dilute speech. They do limit claims comparing FireRed and Silero across languages and programme
genres.
