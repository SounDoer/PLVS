# Agent Control Editor Save

Date: 2026-10-09

This extends the earlier semantic editor-draft design with an explicit persistence action. The
user can review a live draft and ask the agent to save it without switching to direct library
creation or manually pressing Save.

`editor-draft save <theme|loudness-profile> <surface-id>` requires the existing revision,
UI generation, and draft generation tokens, plus JSON output. It has no dry-run or force option.
It resolves only the exact topmost mounted editor and delegates to its existing save owner.
Owner-side source comparisons close the race between inspection and the stale-state effect.
Stale sources preserve the draft; no generic conflict confirmation is exposed.

Successful Save reports the stable saved resource ID and normalized document after React has
observed the library state, the original editor has closed, and changed durable state has flushed.
An unchanged existing document closes without a write or revision increment. Create selects the
new resource according to existing GUI behavior; Profile edit restores its captured selection.
Post-commit errors identify the saved resource and distinguish failed settlement from failed
persistence. Existing commit-not-observed rescue flush behavior remains authoritative.

Validation covers both owners, all tokens and surface identity, stale/deleted sources, clean
saves, response replay, and persistence/settlement failure. Real desktop verification must save
both kinds, inspect them after a full restart, then remove only the resources created by the test.
