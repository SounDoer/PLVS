# Capture soak reference recordings

These are reviewed, full four-hour recordings for historical drift comparison, not generated
test expectations or a replacement for the capture smoke and soak verdicts. The initial three
recordings come from GitHub Actions run `41280426903` on 2026-11-01, commit
`c76d2d90499a31c3fe6f40f14bc039166101fbec`. Each contains 1,440 ten-second samples and one
successful final report. Each platform currently has only one reference: this is insufficient
to establish its normal variation range.

`manifest.json` pins both gzip and decoded series hashes, the original artifact series hash,
source commit, run ID/attempt, platform, runner, rig revision and measurement contract. Gzip
files contain the original numeric samples and a final report with device IDs/names removed.
No machine paths, recorded media or full console logs are archived. RSS endpoints were extracted
from the original logs; an RSS time series and the original driver versions were not recorded
and must not be inferred. Original artifacts retain their usual 90-day Actions retention.

Verify the archive:

```sh
node scripts/capture-soak-baselines.mjs verify
```

Compare a future workflow recording (the directory must contain its `run.json` and exactly one
`soak-<timestamp>.jsonl`):

```sh
node scripts/capture-soak-baselines.mjs compare --run-dir artifacts/soak
```

The comparison verifies full duration, cadence, finite settled metrics, successful final capture
and zero dropped chunks. It recomputes spreads from the decoded samples with the capture rig's
warmup windows. References must match platform, runner name, rig revision and measurement contract;
the current run is excluded. Reports are JSON/Markdown beside the new series, also written to the
GitHub step summary. A larger historical spread produces an advisory warning, never a relaxed
threshold or an automatic baseline update. A mismatch is an explicit comparison gap. Failed or
interrupted evidence is never promoted. The regular capture verdict remains authoritative.

## Updating references

Only promote a recording after review, through an ordinary repository change:

1. Download the exact run's artifacts before expiry. Confirm source SHA, runner assignment,
   successful smoke, complete soak and clean teardown in the original workflow.
2. Verify 14,400 captured seconds, 1,440 samples, non-null settled/final metrics and zero drops.
   Investigate drift or memory changes; a green workflow alone is not approval.
3. Retain numeric samples and the final report's schema, app, format/duration, summary and health.
   Omit endpoint names/IDs, paths and other host identifiers; preserve the original source hash.
4. Gzip the sanitized JSONL, append a manifest entry with compressed/decoded hashes and provenance,
   then run the verifier and adjacent tests. Retain reviewed references rather than overwriting them.
5. Deliberately update the rig revision after hardware, driver or audio-route changes that invalidate
   comparison. `record` reads `CAPTURE_RIG_REVISION` (default `1`); configure the affected runner's
   environment before its next job. Signal, synthesis protocol and judgment changes require a
   measurement-contract revision. Never silently merge incompatible cohorts.

Keep a small reviewed collection per environment (for example 3–5 full runs), including its first
qualification and meaningful later changes. Weekly output remains in ignored `artifacts/soak/`
and Actions artifacts; CI has no baseline write/promotion command or repository write permission.
