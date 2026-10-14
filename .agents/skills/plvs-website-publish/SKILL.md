---
name: plvs-website-publish
description: Check and publish an independent PLVS website update from an exact commit, including responsive review, live-content comparison, CI and deployment verification. Use for website publication; use plvs-release for desktop releases and the Sharesets curation workflow for content-only Catalogue updates.
---

# PLVS Website Publication

Read the "Website checks and independent publication" section of `CONTRIBUTING.md` for commands
and marker recovery. This skill coordinates those commands; it does not replace repository gates.

## Prepare and review

- Stay on `main` unless the user authorizes an isolated checkout. Do not bump desktop versions,
  produce installers, create tags, or invoke `plvs-release` for a website-only publication.
- Inspect the complete pending change range. Run `npm run check:changes`; it selects the website
  gate only for known website inputs and falls back to the full gate for mixed/unknown changes.
  Do not shorten its comparison range or manually skip a selected gate to save time.
- For rendering changes, compare before/after browser screenshots at desktop, tablet and mobile
  widths. Use the local complete-site server, `npm run website:dev`. App Agent Control is for the
  desktop UI, not the website.
- Follow **Privacy policy review** in `CONTRIBUTING.md`. Check the full live-to-candidate range
  for changes to collection, consent, payloads, providers/recipients, retention and deletion,
  including related service changes. Record the baseline/candidate SHAs, evidence and privacy
  conclusion in the publication review even when the policy is unchanged. Resolve relevant
  deployment uncertainties before publication. If policy wording, links or dates change, update
  `docs/privacy-review.json` with an explicit date decision and run
  `node scripts/privacy-review.mjs check` before committing the candidate. Cosmetic changes do
  not advance Effective, and a matching fingerprint never replaces semantic review.
- Commit only intended files using a scoped Conventional Commit after checks pass. Record the
  full candidate SHA. A user request to commit and publish already authorizes these operations;
  do not ask for the same approval again.
- Run `npm run website:review -- <candidate-sha>` and read the full live-to-candidate diff. The
  whole website and generated `docs/user/` ship together. Inspect guide differences from the latest
  stable app release for descriptions of unshipped features. Corrections can ship; do not quietly
  publish future behavior. If isolating the fix is necessary, explain the concrete conflict and
  ask before moving work off `main`. Do not revert unrelated pending product documentation.
- The report is evidence for semantic review, not automatic authorization. Review shared source
  and generator changes too. Missing-marker bootstrap requires evidence from the previous
  successful deployment, as documented in `CONTRIBUTING.md`; never guess from a content-only SHA.

## Publish and verify

1. Push the checked commit. Wait for successful `ci.yml` **push** CI on that exact SHA. Pure website
   changes skip unrelated desktop jobs; mixed changes retain them. Failure is not a reason to
   dispatch another publication path.
2. Recheck the live baseline if it may have changed during preparation. Dispatch
   `deploy-website.yml` on `main` with `ref=<full-candidate-sha>`. The workflow independently checks
   exact-SHA CI and passes the resolved SHA into the shared publication workflow.
3. Wait for that deployment run to conclude successfully. Keep the shared Sharesets history gate
   intact. If it fails, inspect the failure and fix its cause; do not delete publication markers,
   rewrite published Catalogue bytes, or roll back to an older content tree.
4. Fetch the live root `/publication.json` without cache, verify `websiteSha` equals the candidate,
   and inspect the affected live page. Report the commit, deployment outcome, and live URL. If
   verification fails, report the actual limitation rather than claiming publication is verified.

Changing files after validation invalidates the checked candidate. Recheck and publish a fresh
commit; never move an existing desktop release tag to carry a website fix.
