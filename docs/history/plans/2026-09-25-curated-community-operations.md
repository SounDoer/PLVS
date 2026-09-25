# Curated Community Operations Plan

Date: 2026-09-25
Status: In progress

## Scope

Complete the maintainer-only publication path for the static Community Catalogue. This work does
not open public submissions and does not choose a submission channel, licence, or contribution
permission model.

## Publication invariants

- [x] Validate the real default content tree in the normal repository merge gate.
- [x] Compare a candidate content tree with its published predecessor before deployment.
- [x] Keep Listing identity, Release records, artifact bytes, and preview bytes immutable.
- [x] Allow Listing copy to improve, a new higher-numbered Release to be appended, or a published
      Release to move once to Withdrawn with a reason.
- [x] Reject deletion, restoration, history insertion, path replacement, and byte replacement.
- [ ] Document maintainer validation, publication, withdrawal, and rollback commands.
- [x] Cover accepted, appended, withdrawn, and rejected updates with end-to-end fixtures.

Gate: maintainers can update curated content without rewriting anything a visitor could previously
download or cite, and no public contribution workflow is implied.
