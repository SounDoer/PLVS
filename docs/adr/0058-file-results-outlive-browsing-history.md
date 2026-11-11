# ADR 0058: File Results Outlive Browsing History

Date: 2026-11-11

## Context

A complete File result is compact, while the visual history required to inspect its timeline can
grow with duration, channel count and computed views. A file-count limit either deletes useful
results arbitrarily or retains too much history. Replaying a source automatically on selection
could consume the analysis slot unexpectedly and produce mismatched evidence if the source changed.

## Decision

Keep successful whole-file measurements and their analysis conditions until the entry is removed or
the session ends. Stage each replacement separately and publish it only after successful completion.
Manage File browsing history against an internal estimated storage target, with the current file
and active task's old/staging history protected. Release eligible histories least recently viewed
first. Leave Live's separate rolling window unchanged.

Restore History is explicit and publishes history only. Bind the result to a canonical local path,
track and full content fingerprint. File size and modification time alone cannot detect replacement
with the same size or restored timestamp. Recheck the fingerprint around decoding. Restore uses the
original accepted conditions and refuses changed content; Reanalyze can create a new entry.

## Consequences

Reports and statistics CSV remain available after a browsing history is released, and omit local
paths. The budget is a retention target: one protected file, a staging attempt, and retained Live
history can together exceed it. Full fingerprints add sequential read cost and are never computed
on the Live capture callback. No measurement data is persisted by this decision.
