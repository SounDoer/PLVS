# Non-Data Visual Opacity Follow-up Design

## Context

Visual review after the initial non-data opacity implementation found two places where the general
rules removed useful hierarchy. This record documents the accepted exceptions without rewriting
the original design record.

## Source Transport emphasis

Live and Snapshot need to stand out more than ordinary flat status badges. The Source Transport
therefore uses opaque state-tinted surfaces built from its Activity role and `secondary`:

| Part | Activity share |
| --- | ---: |
| Shell fill | 10% |
| Action fill | 24% |
| Action Hover | 36% |
| Shell border | 50% |

The remaining share is always `secondary`, so the result is opaque and stable across Workspace,
Panel and Dock backgrounds. Text and icons use the full Activity color. The action is an edgeless
oval. These percentages belong to the component and are not new Theme Editor roles.

## Settings modal focus

The Settings drawer remains an opaque Modal surface. Its black-60 scrim adds a small backdrop blur
to push the workbench visually out of focus while Settings is active. This is interaction hierarchy,
not a blur used to compensate for a translucent readable surface. Other scrim consumers remain
unblurred unless they establish the same explicit modal-focus requirement.
