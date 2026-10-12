# Loudness Standard Profiles Design

## Status

Approved for implementation on 2026-10-12.

## Goal

Publish a first curated set of downloadable Loudness Profiles based on current industry
recommendations and platform guidance. PLVS Default remains the only built-in Profile.

## Catalogue

The first set contains:

1. EBU R 128 Programme
2. EBU R 128 Short-form
3. ATSC A/85 Short-form
4. ATSC A/85 Long-form Monitor
5. Spotify
6. Apple Podcasts
7. ITU-T H.872 Game Audio
8. ITU-T H.872 Portable Game Audio

The former EBU R 128 s1 Momentary variant is excluded because it was removed from the current
recommendation. Catalogue names avoid punctuation between the standard or platform name and its
variant.

## Product contract

- Each Profile is an ordinary downloadable `.plvsloudness` pack and is not built into PLVS.
- The downloadable artifact is the single source of truth for reference loudness and executable
  rules. The website renders rule values, units and severity from that artifact.
- The detail-page hero stays concise. Longer applicability, measurement and limitation notes appear
  under Details, followed by structured Sources linking to the publisher.
- PLVS displays LUFS. Where a source uses LKFS, Details explains that LKFS and LUFS are numerically
  equivalent; no second application unit is introduced.
- Standards and recommendations are not represented as endorsements. Listings are authored by PLVS
  and tagged by category.
- Loudness Profiles use generated rule summaries and have no screenshot requirement.

## Interpretation boundaries

- EBU rules use the current quality-control tolerance. Special cases such as live programmes or
  intentionally lower programme loudness remain contextual and are described rather than encoded.
- Spotify is platform mastering guidance, not a delivery acceptance specification. Its conditional
  stricter True Peak advice cannot be expressed by the current independent-rule model and remains a
  documented limitation.
- ATSC A/85 Long-form Monitor is intentionally named Monitor. PLVS dialogue estimation uses an open
  voice-activity detector and the application's existing gated dialogue calculation; it is not the
  BS.1770-1 plus dialogue-gating method requested by A/85 for conforming long-form measurement.
- H.872 guidance refers to a representative 30-minute gameplay window. A Profile cannot select that
  interval or verify portable-device capability and headphone safety behaviour, so Details states
  those operator responsibilities.

## Severity policy

Clear programme-delivery limits are represented as Fail. Platform targets, safe-listening guidance
and the approximate long-form dialogue monitor use Warn for loudness-band departures. True Peak
ceilings use Fail.
