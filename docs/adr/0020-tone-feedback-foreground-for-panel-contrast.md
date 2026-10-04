# ADR 0020: Tone feedback foreground for panel contrast

## Status

Accepted.

## Context

The Interface Palette authors one colour each for Success, Warning, and Danger. That colour is used
in two ways: as a solid fill under primary content (chips, the destructive button), and as a
foreground drawn straight on the panel (feedback messages, the Live and Snapshot activity
indicators). The two uses already have separate roles, `interface.{success,warning,danger}` and
`interface.feedback.*` / `activity.*`, but the foreground roles simply repeated the fill colour.

A fill must be dark enough for light content in a Dark Theme and the foreground must be light
enough to read on a dark panel, so one value cannot serve both. With the built-in Dark Theme the
foreground measured about 3:1 against the panel, and 2.9:1 for Danger after the panel was lightened
in the default Theme redesign. These foregrounds are text.

## Decision

`interface.feedback.*` and `activity.*` use a `feedback` recipe. It keeps the authored colour's hue
and chroma and moves its lightness away from the panel until the colour reaches 5.5:1 against the
Panel Surface, close to Secondary Text. A colour that already meets the contrast is published
unchanged. Solid fill roles keep the authored colour exactly.

The roles remain overridable; an Advanced override is published as authored and is reported by
Visual Review when it falls short.

## Consequences

- Built-in Themes keep authoring no Advanced overrides and one Interface Palette.
- A custom Theme that leaves these roles on Auto gets lighter (Dark) or darker (Light) feedback and
  activity colours when its authored colour was below 5.5:1. No document migration is needed and
  the semantics version is unchanged, because authored values keep their meaning.
- The Theme Preview's solid chips and its feedback text may now show two tones of one hue.

## Alternatives considered

- Author separate fill and foreground colours in the Interface Palette. This doubles the palette
  for a relationship the compiler can derive.
- Switch solid fills to dark content on a bright fill so one bright colour serves both uses. This
  changes every solid control and was outside the redesign's style direction.
