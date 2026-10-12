# Loudness Measurement Lifetime — design

Date: 2026-10-12
Status: approved

## Problem

PLVS currently mixes three different lifetimes:

- the lifetime of a loudness measurement;
- the amount of Live history retained for inspection;
- the duration of an analysed file.

The DSP stores at most 36,000 100 ms loudness-energy blocks and 36,000 Short-term values. Both
limits equal 60 minutes. After that point, Integrated and Loudness Range silently become rolling
last-hour measurements in both Live and File analysis, even though the UI describes them as
whole-program values.

The frontend also sizes File history from the Live **History Length** setting. A long file can still
finish, but only the newest configured history window remains inspectable. The report marks that
display history as truncated; the user cannot navigate the complete file.

Finally, changing History Length while Live capture is running currently restarts the native capture
effect as an implementation side effect. The product does not define that restart as a measurement
operation, while the Settings help says that changing the setting does not restart measurement.

These behaviours are unsuitable foundations for Profiles based on whole-program broadcast and
platform specifications.

## Product model

PLVS uses three explicit lifetimes.

| Lifetime            | Applies to                                               | Boundary                                                                   |
| ------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------- |
| Measurement Session | Live cumulative metrics and holds                        | Start or Clear until the next Clear/stop/restart that begins a new session |
| Live History        | Inspectable Live curves and Snapshots                    | The selected History Length                                                |
| File Programme      | Authoritative File results and inspectable File timeline | The complete decoded file                                                  |

History retention is not a loudness gate and is not an input to a standards calculation.

## Live measurement semantics

The following values cover the complete current Measurement Session:

- Integrated;
- Loudness Range;
- Momentary Max and Short-term Max;
- True Peak Max and Sample Peak Max;
- Dialogue Integrated, Dialogue Range, and Dialogue Coverage when Dialogue Detection is active.

Integrated Dynamics (PLR) and Dialogue Offset inherit the lifetime of their cumulative inputs.
Short-term Dynamics (PSR) continues to combine the session True Peak Max with the current Short-term
reading.

Momentary remains a 400 ms window and Short-term remains a 3 s window. Correlation, Side/Mid, and
other current-window visual measurements keep their existing local windows.

PLVS does not impose a product-level maximum Measurement Session duration. Cumulative
implementations must append efficiently and must not silently evict old measurements. Clear remains
the explicit way to begin again.

## History Length

History Length applies only to Live history and offers the existing 30, 60, 120, and 240 minute
choices. It controls how far back Live charts can be scrolled and which past instants can be selected
as Snapshots.

Changing History Length is deliberately simple: it is equivalent to Clear for the current Live
measurement. The new setting is saved, a selected Snapshot is exited, accumulated values and holds
are reset, Live history is emptied, and the measurement clock starts again while capture continues.
The UI must state this consequence directly rather than describe the change as a passive resize.

If File is the active source, changing History Length changes the saved Live preference only. It
does not remove, restart, or reanalyse the file.

All entry points that change History Length, including Settings and Agent Control, use the same
business operation and therefore the same Clear behaviour.

## Snapshot semantics

A Snapshot is a retained historical state, not a fresh calculation from the rows that happen to
remain visible.

Each retained Live point stores the cumulative readings as they existed at that instant. For
example, in a three-hour Measurement Session with 30 minutes of history, a Snapshot selected 20
minutes ago displays the Integrated value accumulated over the first two hours and forty minutes.
The earlier raw history is no longer selectable, but its contribution to that stored cumulative
reading is intentional.

Entering Snapshot freezes the currently retained history as it does today. Changing History Length
exits Snapshot because the operation clears the underlying Live measurement.

## File analysis semantics

File analysis is independent of History Length.

- Authoritative Integrated, LRA, maxima, and available dialogue results cover the complete decoded
  audio track.
- The File timeline covers the complete file and remains navigable from beginning to end.
- Long files may use progressively coarser display checkpoints or multiresolution summaries. Display
  resolution may change; time coverage and authoritative final measurements may not be truncated.
- Profile evaluation and exported reports use authoritative whole-file results, never a display
  downsample.
- Changing History Length during or after File analysis does not restart or alter that analysis.

PLVS does not declare an artificial maximum File duration or size. Analysis can still fail for an
unsupported or corrupt source, decoder failure, resource exhaustion, or cancellation. Such failures
must be explicit; no metric may silently change to a rolling window.

## Accumulation and resource behaviour

Integrated and LRA require access to the distribution of qualifying programme blocks. The
implementation must preserve the existing BS.1770/EBU gating math across the full Measurement
Session or file and must not substitute a lower-precision approximation without a separate reviewed
decision.

Storage must use amortised append or chunked structures. Removing the oldest element from the front
of a contiguous vector on every 100 ms tick is not acceptable. The implementation must also respect
the capture-layer rule that the audio callback itself does not allocate, lock, or perform syscalls.

Live cumulative storage may grow with the Measurement Session because exact whole-session
measurement has no retention cutoff. File display history instead uses bounded multiresolution
storage because its purpose is navigation, not authoritative calculation. The final File summary is
computed in the decoding worker and does not depend on frontend timeline retention.

## Reset boundaries

A full Live Clear resets all session-scoped state together:

- Integrated, LRA, and dialogue accumulation;
- Momentary Max, Short-term Max, True Peak Max, and Sample Peak Max;
- visual and scalar Live history;
- selected Snapshot;
- the measurement clock;
- session-scoped visual holds already governed by the existing Clear operation.

Per-metric reset controls, such as resetting True Peak Max, retain their narrower existing meaning.
Switching History Length invokes the full Clear operation, not a collection of new partial resets.

## User communication

System Settings describes History Length as Live-only and states that changing it clears the current
Live measurement. User documentation distinguishes Live History from whole-session metrics and from
the complete File timeline.

No compliance or certification claim is introduced. Profiles based on EBU R 128, ATSC A/85, or
platform guidance remain monitoring and evaluation tools whose sources and rule interpretations are
documented separately.

## Verification

Implementation is complete only when:

- a signal sequence longer than 60 minutes proves that Live Integrated and LRA include material from
  before the former cutoff;
- the same long sequence proves that File summary metrics cover the complete file;
- Live and File use the same gating definitions for equivalent decoded samples;
- a retained Snapshot reports the cumulative values captured at its selected time;
- changing History Length in Live performs one coherent Clear without requiring capture to stop;
- changing History Length while File is active neither restarts analysis nor changes its results;
- the complete duration of a file longer than the largest Live History Length remains navigable;
- long-duration accumulation avoids per-tick front removal and remains within reviewed resource
  expectations;
- user-facing help and the user guide describe the implemented lifetime rules;
- capture smoke passes, and a four-hour capture soak is reviewed against the existing local drift
  baseline.
