# Dialogue VAD benchmark — first reproducible corpus

Date: 2026-10-13

This note records the first result from the repository-owned programme-dialogue benchmark. It is a
decision input, not living product documentation and not a universal VAD quality claim.

## Reproduction

Run:

```text
npm run benchmark:dialogue
```

The command verifies and generates corpus `plvs-dialogue-synthetic-v1`, runs the exact bundled
engines through the feature-gated harness, and writes JSON plus Markdown results under
`artifacts/dialogue-benchmark/`.

Private programme material stays outside the repository. Run the same audited engines and report
pipeline against a resolved schema-v1 manifest with paths and hashes relative to that manifest:

```text
npm run benchmark:dialogue -- --manifest D:\private-corpus\manifest.json
```

The command rejects a custom manifest inside the repository so non-redistributable audio cannot be
added accidentally. Generated results remain in the ignored artifact directory.

Corpus manifest SHA-256 for this run:
`955973cb0b193ff97d13ddbd6aa18b73b7a7573ea7d4235a6451c976d1c994ab`.

The speech sources are four attributed LibriSpeech SLR12 clips under CC BY 4.0. Programme music,
noise, LFE energy, stereo cancellation, and the voice-like music negative case are generated
deterministically. See `fixtures/dialogue-benchmark/README.md` for source identities and hashes.

Model identities at the time of the comparison:

- FireRed model from `firered-vad` 0.1.0:
  `b3c97836130dc34fc32d56fab551e88cf9454511de2b3c250a5e6578dee74b93`;
- then-shipped Silero v5 baseline:
  `2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f`;
- Silero v6.2 candidate, subsequently shipped:
  `1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3`.

Silero v6.2 requires the official 64-sample 16 kHz streaming context. An initial run without that
context returned all-negative output; the production adapter and harness now apply it.

## Aggregate result

All values aggregate four programme cases on 100 ms aligned blocks. DL error is measured against
the same BS.1770 programme-energy blocks selected by the annotated dialogue mask. Coverage error is
in percentage points.

| Engine        | Fusion                         |    F1 | Precision | Recall |    FP |     FN | Boundary | DL error | Coverage error |   RTF |
| ------------- | ------------------------------ | ----: | --------: | -----: | ----: | -----: | -------: | -------: | -------------: | ----: |
| FireRed 0.1.0 | centre-priority fallback       | 0.884 |     0.967 |  0.814 | 1.0 s |  6.7 s |   327 ms |  0.97 LU |         8.9 pp | 0.136 |
| FireRed 0.1.0 | independent non-LFE maximum    | 0.869 |     0.933 |  0.814 | 2.1 s |  6.7 s |   327 ms |  0.80 LU |        10.9 pp | 0.140 |
| Silero v6.2   | centre-priority fallback       | 0.858 |     0.920 |  0.803 | 2.5 s |  7.1 s |   360 ms |  1.38 LU |        12.8 pp | 0.020 |
| Silero v6.2   | independent non-LFE maximum    | 0.832 |     0.863 |  0.803 | 4.6 s |  7.1 s |   360 ms |  1.17 LU |        16.6 pp | 0.020 |
| FireRed 0.1.0 | non-LFE energy-weighted mono   | 0.782 |     0.914 |  0.683 | 2.3 s | 11.4 s |   381 ms |  0.80 LU |        15.7 pp | 0.040 |
| Silero v5     | centre-priority fallback       | 0.762 |     0.895 |  0.664 | 2.8 s | 12.1 s |   527 ms |  1.70 LU |        18.0 pp | 0.009 |
| FireRed 0.1.0 | all-channel arithmetic average | 0.631 |     0.960 |  0.469 | 0.7 s | 19.1 s |  1240 ms |  1.44 LU |        26.5 pp | 0.042 |

The generated summary and JSON also retain LDR and Dialogue Range errors, readiness exclusion, and
every lower-ranked combination. Runtime factor is wall-clock inference time divided by programme
duration on the test machine; it is not isolated CPU time.

## Decision

1. Keep FireRed as the default. On this corpus it has the strongest accuracy/recall trade-off and
   remains comfortably faster than real time. The corpus is too small to justify changing the
   default merely because Silero v6.2 is newer.
2. Upgrade the optional Silero engine from v5 to v6.2. It materially improves the Silero result on
   this corpus without changing the conclusion that FireRed should remain the default. Continue to
   expand the corpus before reconsidering the default engine.
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
