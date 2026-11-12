---
name: plvs-website-publish
description: Check and publish an independent PLVS website update from an exact commit, including responsive review, live-content comparison, CI and deployment verification. Use for website publication; use plvs-release for desktop releases and the Sharesets curation workflow for content-only Catalogue updates.
---

# PLVS Website Publication

Read the "Website checks and independent publication" section of `docs/website-and-sharesets.md` for commands
and marker recovery. This skill coordinates those commands; it does not replace repository gates.

## Prepare and review

- Work on `main` unless the maintainer authorizes an isolated checkout. Website-only publication
  does not change the PLVS version or create installers, tags, or a desktop Release.
- Resolve the published stable product, reviewed policy, and Catalogue revisions. Run the PLVS
  input exporter from clean checkouts at those exact commits. In PLVS-Website run
  `npm run check -- <input-directory>`. For PLVS changes, run `npm run check:changes` after the
  final intended commit and before pushing.
- Read both live publication markers. Review the complete website source diff from the live
  renderer to the candidate, and the product, guide, policy, and Catalogue diffs when their
  revisions change. On the initial cutover, compare the complete outputs from the former
  renderer and PLVS-Website. Review affected pages at desktop, tablet, and mobile widths.
- Follow Privacy policy review in `docs/website-and-sharesets.md`. Inspect changes to data collection,
  consent, payloads, recipients, retention and deletion, including related service changes.
  Record the baseline/candidate identities, evidence and conclusion even when wording is
  unchanged. For policy wording, links or date changes, update `docs/privacy-review.json` and
  validate the reviewed body before publishing. A matching fingerprint does not replace semantic review.
- Require successful exact-SHA push CI in PLVS-Website. The published product commit also needs
  successful push CI in PLVS. Recheck the live baseline before dispatch if it changed during review.

## Publish and verify

1. Dispatch the single production entry point on PLVS main:
   `gh workflow run deploy-website.yml --repo SounDoer/PLVS --ref main -f ref=v<stable> -f website_ref=<exact-website-sha>`.
   For independently reviewed policy changes, also supply `policy_ref=<exact-plvs-sha>`. Omit
   `website_ref` when retaining the live renderer.
2. Wait for the deployment run. The shared workflow checks both repositories' CI and holds the Pages
   lock across live Catalogue history validation and deployment. Diagnose a failure and retry
   with the verified candidate. Do not delete markers or rewrite published Catalogue bytes.
3. Verify `productSha`, `siteSourceSha`, `policySha` and `contentSha` from the live
   `/publication.json` and the Catalogue commit from `/sharesets/publication.json`.
   Inspect affected pages and report the deployment result and live URL.

Changing a candidate after validation requires fresh checks. Preserve the previous deployment
and recover missing live identities from its verified evidence.
