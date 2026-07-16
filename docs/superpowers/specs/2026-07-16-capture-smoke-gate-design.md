# Capture Smoke Gate - Design

## Problem

`plvs-cli capture` made the live-capture path assertable, but nothing runs it. A
channel-map or format-conversion regression in `src-tauri/src/audio/` still ships
green: `npm run check` cannot reach that code because CI runners have no sound
card, and the one hardware verification performed so far was a hand-driven
sequence that took several rounds of fumbling with VLC device identifiers.

Two things are missing: a command that performs the check without human
improvisation, and something that makes it happen at the right moment.

## Goals

- `npm run smoke:capture` — one command that verifies the live-capture path end
  to end, with every rig operation encapsulated. The caller types one line.
- Wire it into the release flow so a release carrying audio changes cannot ship
  without it, and a release carrying none never touches hardware at all.
- Distinguish a **rig failure** from a **code failure** in the exit code, because
  the two demand opposite responses.

## Non-Goals

- Do not run in CI. There is no sound card; this is a local-only check.
- Do not add it to `npm run check`. That gate must stay hardware-free.
- Do not gate on soak. A four-hour run cannot block a release; soak is designed
  separately and is not a gate.
- Do not test macOS. The author develops on Windows; `audio/macos/` stays
  CI-verified only, which is to say unverified. This gap is known and not closed
  here.
- Do not test the installed package. See Which Binary below.

## The Operator Is An Agent

This design's shape follows from one fact: **the person who runs these commands
is an agent, not the author.** The author says "发版"; the agent reads
`plvs-release` and executes. Three consequences, each inverting what would be
right for a human operator:

**No escape-hatch flag.** A human typing `--skip-capture-check` is making a
decision they own. An agent hitting a red gate is prone to reaching for the flag
to get unstuck — rationalizing that the change looks unrelated, that the user is
in a hurry, that the rig is probably just misconfigured. The gate therefore has
no bypass. An agent that cannot get it green has exactly two moves: fix the rig,
or stop and ask the author. The author is the escape hatch.

**No warnings.** A warning to a human at least flashes. To an agent it is a
paragraph in a tool result, shaped exactly like success, gone two screens later.
Only a non-zero exit is not rationalizable.

**Every rig operation is scripted, not documented.** The first hardware
verification took three failed attempts at VLC device selection alone: an
argument array split the device name on spaces so VLC opened the fragments as
filenames; `directsound` turned out to reject a device *name* and require a GUID;
only `mmdevice` with an MMDevice endpoint id worked. A fresh agent handed a
document would re-derive all three. Anything left to on-the-spot improvisation
will be improvised badly.

## Rig Failure Is Not Code Failure

The two failure modes need opposite responses, so they must not share an exit
code. This reuses the CLI's existing `0/1/2` contract rather than inventing one:

| Exit | Meaning | Correct response |
|------|---------|------------------|
| 0 | Live path agrees with the file path | Proceed |
| 1 | **Assertion failed** — the numbers disagree | **A real capture-layer bug.** Stop. Do not adjust the tolerance. |
| 2 | **Rig unusable** — no VB-Cable, no VLC, device busy | Not a code signal. Fix the rig, or stop and ask the author. |

Collapsing these would produce the worst outcome available: a rig hiccup read as
a capture bug (a wild goose chase), or a real bug read as a rig hiccup (the exact
silent-wrong-number ship this whole line of work exists to prevent).

## Ground Truth Comes From `analyze`, Not From Constants

The assertion does not compare against hardcoded expected values. It measures the
same WAV through `analyze` — the already-trusted file path — and requires
`capture` to agree.

Hardcoding would work today and rot quietly: change the signal definition,
forget to update the constants, and the check goes green against numbers that no
longer describe anything. That failure mode is the one this project keeps paying
for and is exactly what the check exists to catch.

Taking truth from `analyze` costs about two seconds and can never fall out of
sync. It also upgrades what is being asserted: not "capture returns -22.03" but
**"the live path and the file path agree"** — the property actually worth
holding, and the same property the `file_analysis` cross-path test pins on the
other side.

Measured 2026-07-16, this agreement is exact where it can be:

| Field | `analyze` | `capture` | Delta |
|-------|-----------|-----------|-------|
| `samplePeakMaxLDb` | -19.999469871546843 | -19.999469871546843 | bit-identical |
| `samplePeakMaxRDb` | -26.00153564352592 | -26.00153564352592 | bit-identical |
| `integratedLufs` | -22.0306 | -22.0329 | 0.0024 dB |

Tolerances: peaks ±0.2 dB, integrated ±0.5 dB. The integrated delta is expected
rather than error — `capture` integrates a 10 s window of a looping file while
`analyze` integrates all 60 s.

## The Signal

1 kHz sine, 60 s, 48 kHz stereo, **L at -20 dBFS peak and R at -26 dBFS peak**.

The asymmetry is load-bearing, not incidental. Under BS.1770 any permutation
among equal-weight channels integrates identically — `dsp/loudness.rs` weighs
FL/FR/C at `1.0` and SL/SR at `SURROUND_LOUDNESS_WEIGHT` — so **an L↔R swap is
invisible to integrated loudness**. Only per-channel peaks catch it, and only if
the channels carry different levels.

Synthesized on the fly, not committed. It is deterministic, takes milliseconds,
and keeps a 11 MB binary out of git. **Do not generate it with the bundled
FFmpeg**: that sidecar is a trimmed build with no `volume` filter and fails with
`No such filter: 'volume'`.

## Routing

The signal must reach a capture device without touching the author's audio setup.

**Do not change the system default playback device.** It is intrusive, it
disrupts whatever the author is listening to, and 60 s of 1 kHz sine through real
monitors is a scream.

Point one player at VB-Cable's endpoint instead. VLC's `mmdevice` output accepts
an MMDevice endpoint id, discoverable from a read-only registry lookup under
`HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render`. Every
other device keeps working normally and nothing is audible.

**Why VB-Cable rather than the author's interface.** Capturing the real
interface's loopback would also be digital and might well work — but it carries
confounds this check cannot afford: the master volume may scale the loopback, and
any system sound landing during the capture window corrupts the reading. Both
produce **false alarms**, and a gate that cries wolf gets removed. VB-Cable is
isolated, silent, and format-pinned.

This makes VB-Cable and VLC rig requirements. That is acceptable precisely
because the gate only demands them when audio code actually changed.

The player must be stopped on every exit path, including assertion failure and
crash. A VLC left looping a 1 kHz sine into a virtual cable is silent, which is
exactly why it would go unnoticed — and it would poison the next run's reading
while looking like a capture-layer fault.

## Wiring Into The Release

`release:preflight` **conditionally runs** the smoke rather than checking whether
someone else ran it:

```
release:preflight
  ├─ check-release-state          (existing)
  ├─ npm run check                (existing)
  └─ if audio code changed since the last tag → npm run smoke:capture   (new)
```

The condition is pure git and touches no hardware:

```
git describe --tags --abbrev=0                        → <last-tag>
git diff --name-only <last-tag>..HEAD -- src-tauri/src/audio src-tauri/src/dsp src-tauri/src/engine
```

Resolve the tag in a separate step and pass it as a literal. PowerShell's
`$(...)` does not interpolate correctly inside git arguments — the `plvs-release`
skill already records this trap for `git log`, and it applies identically here.

If `git describe` finds no tag (a fresh clone with no release history), run the
smoke rather than skipping it: an unknown comparison base is not evidence that
nothing changed.

**Empty → skip entirely.** The capture layer is byte-identical to the shipped
version, so last release's verification still holds. Most releases land
`refactor(dock)` / `fix(dock)` / `feat(ui)` and never touch this. Zero friction,
no hardware, VB-Cable's state irrelevant.

**Non-empty → run it.** The rig is required only when the risk is real.

**Why conditional execution rather than a check.** An earlier draft had
`check-release-state` verify that the smoke had been run. It cannot: it knows
audio changed, not whether anything was done about it, so it would stay red after
a passing smoke — a gate nobody can clear. Recording "smoke passed at commit X"
in a ledger would fix that by adding state that can go stale and lie. Running the
smoke *as* the check needs no state at all: git decides whether it runs, and the
smoke decides whether it passes.

## Which Binary

The freshly built `plvs-cli`, not the installed one.

An earlier decision in this line of work was "test the bytes you ship". That
reasoning does not reach capture: nothing on this path is release-specific. The
installed binary is the same code, and capture touches no FFmpeg sidecar and no
install-relative path — the two things packaging can actually break, and both
already covered by `desktop:verify-windows-installer`.

**Use `--release`, not debug.** This is a realtime path: a debug build may not
keep up with a 48 kHz stereo stream, drop chunks, and fail the check for reasons
that have nothing to do with correctness. Verify this during implementation — if
debug turns out to keep up comfortably, prefer it for the build time; if there is
any doubt, release wins. A gate that false-alarms is worse than a slow one.

## Where This Gets Documented

| File | What | Read by |
|------|------|---------|
| `CLAUDE.md` | Touched `audio/` / `dsp/` / `engine/` → the release gate will run `smoke:capture`; consider a soak | **Every agent session, automatically** |
| `plvs-release` SKILL.md | Gate behaviour; on red, fix the rig or stop and ask — never bypass | The agent, at release time |
| `docs/cli.md` | Already documents `capture` itself | Users, other agents |

`CLAUDE.md` is the load-bearing one and the only one that solves discoverability.
The author does not read the project's own README, and will not remember these
commands — by their own account they never type them. What is guaranteed to be
read at the right moment is `CLAUDE.md`, because it enters every agent session
automatically. Documentation placed anywhere else is a note in a drawer the
person who needs it never opens.

## Follow-on

- **soak** — the same script with a long `--seconds` plus `--every`, and external
  RSS sampling against the PID. Trigger-based, never a gate. Its own spec.
- **macOS** — unreachable from this rig; still unverified.
