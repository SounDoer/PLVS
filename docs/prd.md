# PLVS — Product Requirements (PRD)

## Abstract

PLVS is a **local, read-only real-time audio meter** for **sound designers and mix engineers**: **Peak/level**, **LUFS loudness**, **FFT spectrum (RTA-style)**, **spectrogram**, **vectorscope/correlation**, and **waveform**, delivered as a **Tauri desktop app** for **Windows and macOS** with **equal product intent** (implementation constraints are documented separately). PLVS centers on **live monitoring** but also supports an **offline file-analysis mode** for local audio files (still read-only). The app **does not process**, **route**, or **modify** audio; it **does not** ship as a plug-in, **does not** target Linux, and **does not** pursue storefront distribution in the near term. **Loudness** is based on **ITU-R BS.1770** measurement practice with **EBU R128** production/gating usage; **spectrum** is an **FFT-based RTA aligned with common DAW practice** (per-band power integrates FFT bins using **fractional Hz overlap** between band edges and each bin’s frequency tile; vertical scale is **in-band level in the dBFS domain**—same digital full-scale reference as peak meters but a different detector definition; see `docs/architecture.md`), not IEC 61260 filter-bank metrology. This PRD states **product intent and boundaries only**; the current feature inventory lives in the user guide (`docs/user/`) and `CHANGELOG.md`. **English is the default UI language**; **i18n** is a future option. **Privacy**: audio stays on device; **no default telemetry**; update checks are automatic; Feedback diagnostics and crash reports are transmitted only after an explicit user action; audio samples are never attached; **no silent failure** for user-visible metering health. **Legacy browser builds** are **not maintained** and **may be removed**. **Distribution** is via **GitHub Releases**; **in-app update checking** is a committed feature, while **code signing and Apple notarization** remain **optional future milestones**.

---

## 1. Structure and readers

This document states **product intent** only: target users, promises, non-goals, experience principles, and the reasoning behind each boundary.

It **does not inventory current capabilities**. Which panels exist, what each platform supports and what a release delivered are facts that change with every release; they live in the user guide **`docs/user/`** and **`CHANGELOG.md`**. **Tech stack, module layering and IPC details** are defined by **`architecture.md`**. The split lets this document stay unchanged for a long time; once it starts tracking the current state, it is guaranteed to go stale.

---

## 2. Problem statement (user view)

Sound design and mixing need meters that **stay open for long periods** and **read at a glance**: whether levels are dangerous, whether loudness is in a sensible range, whether the stereo image is abnormal, whether the spectrum is clearly unbalanced.  
The tool must **only monitor** and **never change the signal chain**. It should first support **what the system is playing** (native Windows/macOS paths), with **physical inputs** offered as the same kind of "signal source" choice.  
Distribution should be honest about **unsigned installs** and **Gatekeeper/SmartScreen**, rather than hiding the real situation behind something that merely looks official.

---

## 3. Solution overview (user view)

A **standalone desktop application**: the user chooses an **input source (including Automatic)** and starts monitoring, then sees **several meters** in one interface (current list in `docs/user/panels.md`).  
Data is **not uploaded by default**; history is **session-scoped**; export (if it appears) serves only the **current session**, and **reopening the app does not restore** earlier monitoring data.

---

## 4. Target users and scenarios

- **Primary persona**: **sound designers / mix engineers** — session-based, running for long periods.
- **Panel importance**: every meter matters **equally in daily use**; when resources or schedule are tight, **Loudness and Spectrum are polished first**.
- **Typical scenario**: working on headphones or speakers while a DAW or the system plays audio; needing to **quickly confirm** peak and loudness trends and glance at the vectorscope and spectrum when necessary.

---

## 5. Product promises

### 5.1 Capabilities and boundaries

- **Monitoring only**: no **audio processing** such as EQ, limiting or re-routing.
- **Form**: a **standalone app**; **no** VST/AU/AAX plug-in form.
- **Platforms**: **Windows and macOS told as equals**; OS differences and minimum versions are stated honestly in the user guide rather than smoothed over at the promise level.
- **Signal source**: **one signal-source dropdown (A)** — the same selector covers **system output (loopback / tap)** and **physical inputs**, including **Automatic / default output** semantics (the user chooses a **signal**, not an underlying API name).
- **Meters**: multiple meters **on one screen** (list in `docs/user/panels.md`); **English UI** by default; **themes** **follow the system** by default, keep **Light/Dark**, and support **custom themes**.
- **Privacy**: audio and metering data are **not sent anywhere by default**; **no default telemetry**; the **update check** is the only automatic outbound request (see 5.3); feedback diagnostics and crash reports leave the device **only after the user explicitly chooses to send them**, and **never include audio samples**; any future export or diagnostics must likewise be **explicit and optional**.
- **Ethical floor**: **no silent failure** (see 5.4), and never let the user believe the app has quit while it is still capturing (consistent with 5.7).
- **Overload**: when the system may **drop data / hit backpressure**, a **user-visible degraded notice** (for example **in the status bar**) is required; it must not pretend to still be accurate.
- **Startup**: **no automatic START by default (A)** — monitoring starts only when the user asks, avoiding background surprises and arguments over resource use.
- **Licence and attribution**: distribution and contributions follow the repository licence; third-party attribution is maintained in the repository **README / NOTICE** (see section 9).

### 5.2 Metering claims (expectation management)

- **Loudness**: the measurement core follows **ITU-R BS.1770**; production practice and gating are described in **EBU R128** terms (version and implementation details in `architecture.md`). The product **does not claim** legal or certified metering, or endorsement by any third-party platform.
- **User rules**: users can define **reference lines / ranges / rules** on the **same measurement results** for their own monitoring and judgement; the product does not promise an ever-growing set of platform-named presets.
- **Spectrum**: follows **common FFT RTA engineering practice** (in-band energy aggregated over **continuous Hz edges** with **fractional overlap** of each FFT bin, not integer-bin truncation; **STFT** with fixed **hop=N/4** and **4-frame** incoherent averaging of in-band linear power before converting to dB); the vertical axis is in-band spectral power in the **dBFS domain** (the **same reference, a different definition** from sample-peak dBFS); it **does not claim** an IEC 61260 filter-bank metering path, and it is **not interchangeable** with loudness. The first public promise is **Spectrum as a fixed-definition reference view (B)**; the implementation is described in the DSP layer of **`docs/architecture.md`**.
- **Multichannel**
  - **Loudness**: reliably identified standard layouts use **proper multichannel integration (L1)** with weights from **ITU-R BS.1770**, excluding LFE; supported layouts are listed in `docs/user/multichannel.md`, weights and channel order in `architecture.md`.
  - **True Peak**: **True Peak Max covers every channel**, not just the first two.
  - **Layout strategy**: **Z + Y** — use L1 when the layout is reliably identified; otherwise **fall back to Ch1/Ch2 stereo loudness** and mark the fallback clearly **everywhere that reading is shown**. A degraded reading must be readable and must never pose as a proper surround reading.
  - **Layout identification**: up to 8 channels may be identified automatically by channel count; **higher channel counts are never guessed from the count alone**; the user can always set the layout manually.
  - **Level Meter**: multichannel signals are shown **per channel**.
  - **Spectrum (>2ch)**: the user can choose a standard channel pair or a single channel.
  - **Vectorscope**: always **one channel pair**; **Front L/R** by default (when the mapping holds), and the user can switch pairs.

### 5.3 Distribution and updates (honest story + roadmap)

- **Distribution**: builds are obtained from **GitHub Releases**.
- **In-app update check**: **a firm promise** — the app checks for new versions and tells the user; this is the only automatic outbound request by default, with privacy terms as in 5.1.
- **Optional future milestone**: **code signing / Apple notarization** — **no committed date**; until then, the **SmartScreen / Gatekeeper** first-run friction is explained honestly in the user guide, README and release notes.

### 5.4 Runtime failure semantics

- **Floor (C)**: **silent failure is forbidden**; the user must be told "this is not trustworthy right now / has stopped / needs attention".
- **Self-healing vs conservative stop**: the PRD does not force one choice; each scenario is closed out through its own issue (consistent with **visible overload notice (A)**).

### 5.5 Sessions, history and export

- **History is session-scoped by default**: restoring history curves after a process restart is **not promised** (**A**).
- **Export**: if it exists, it serves only the **current session**; **closing and reopening does not restore** export context.

### 5.6 Multiple instances

- **No dedicated multi-instance promise (A)**; if the system allows several instances they are not actively blocked, but "multiple processes × multiple devices" is not guaranteed.

### 5.7 System tray and background capture

- **Background residence is the user's choice**: whether closing the window keeps the app running in the tray, and whether it opens at login, must both be **explicit user choices**; the product never makes the app resident or auto-start on the user's behalf.
- **Residence must be visible**: while the app runs in the tray, the user must be able to tell it is still running, so nobody mistakes it for quit while it is still capturing (see the ethical floor in 5.1).

### 5.8 Keyboard shortcuts

- Shortcuts work **inside the app only** by default; registering them as **global (system-level) shortcuts** must be explicitly enabled by the user, and the key combinations are user-customisable.

### 5.9 Diagnostics

- **Minimal strategy (B)**: the interface provides at least **version/build information** for troubleshooting; a heavier "copy diagnostic bundle" action is not a promise for now.

### 5.10 Internationalisation

- **v1 English interface**; **i18n** is an optional future milestone (**B**), with no committed timing or languages.

### 5.11 Accessibility

- **Not a near-term acceptance focus** (if raised later, it becomes its own project).

---

## 6. Explicit non-goals

**Unless this PRD is revised**, the following are **not implementation commitments**:

1. **Real audio processing** (EQ / effect chains / re-routing that takes control of where sound is output).
2. **Plug-in form** (VST/AU/AAX).
3. **App store distribution** (short to medium term).
4. **Linux desktop**.
5. **Monitoring several sources at once / A-B comparison in one app** (short to medium term).
6. **A general custom user-preference framework** (short to medium term favours **explicit, enumerated persistence** over an open, pluggable preference system).
7. **General data export for ordinary users** (CSV / history export entry points). Agent Control screenshots and recordings serve automation; they are not a general export, audio recording or desktop capture workflow.
8. **Object / scene-based audio** (ADM BWF, Dolby Atmos objects, Ambisonics). BS.1770-5 Annex 4 requires rendering to a BS.2051 loudspeaker layout before measuring, which needs a built-in renderer; to be evaluated separately.
9. **One-click diagnostic bundle export** (see 5.9) and **dedicated accessibility work** (see 5.11): neither is a near-term focus.
10. **MCP integration**: Agent Control uses `plvs-cli` as its only automation entry point; whether to also provide an MCP server is left to a separate product decision.

**Legacy browser version**: **no further feature maintenance**; the **repository branch / hosting may be removed**; see section 8.

---

## 7. User stories

1. As a **mix engineer**, I want to **choose a signal source after launching and then start monitoring**, so that **capture never starts by accident**.
2. As a **mix engineer**, I want to **choose a microphone or system playback in the same dropdown**, so that **I don't need to understand the underlying APIs**.
3. As a **mix engineer**, I want **Automatic to bind to the default output / system default source**, so that **first-time setup costs less**.
4. As a **mix engineer**, I want to **see Level Meter / Loudness / Spectrum / Vectorscope and other meters together**, so that **I can judge several dimensions at a glance**.
5. As a **mix engineer**, I want **loudness readings to be trustworthy and clearly explained** (including what Integrated means when there is not enough data), so that **I misjudge less**.
6. As a **mix engineer**, I want **the spectrum to be a stable, consistent reference view**, so that **comparisons across days are not muddled by UI options** (fixed definition in the first version).
7. As a **mix engineer**, I want **a notice when the system overloads or drops data**, so that **I don't trust the current reading blindly**.
8. As a **mix engineer**, I want **to see the reason when capture fails instead of fake data**, so that **I can get back to a trustworthy state quickly**.
9. As a **mix engineer**, I want **closing the app to really mean monitoring has stopped**, so that **I don't worry about covert background capture**.
10. As a **mix engineer**, I want **my audio not to be uploaded by default**, so that **I can safely use it on unreleased work**.
11. As a **Windows user**, I want **to hear and measure system playback without a virtual sound card**.
12. As a **macOS user**, I want **to use the native tap path on supported system versions**, so that **I avoid the old web version's routing setup**.
13. As a **downloading user**, I want **to know how to handle SmartScreen/Gatekeeper**, so that **the first run goes smoothly**.
14. As a **mix engineer**, I want **Loudness Profiles to be session-level, custom-first rule sets**: first-time setup provides one example **named after its actual parameters, editable and deletable**, and the rest are user-built. They drive **Loudness reference lines, Stats value colouring and the Level Meter TP Max marker**, and they neither provide nor imply **platform, broadcast or regulatory certification presets**, while loudness measurement still follows **ITU-R BS.1770**.
15. As a **surround content user**, I want **proper multichannel loudness when the layout is identified**, so that **it is not passed off with stereo semantics**.
16. As a **surround content user**, I want **a clear notice and fallback when the layout is unknown**, so that **I know this is not a "certified surround reading"**.
17. As a **contributor**, I want **the licence and third-party attribution to be clear**, so that **distribution and redistribution are compliant**.
18. As a **developer**, I want **a clear split between the PRD and the architecture document**: product intent here, protocols and layering in the architecture document.

---

## 8. Legacy Web

- **Status**: the historical browser version is no longer the main line of development.
- **Policy**: **no feature maintenance**; hosting / branches **may be deleted** (to reduce reader confusion).
- **Expectation management**: PRD readers should understand that **the active product is the desktop repository's `main`**.

---

## 9. Licence and attribution

- The project licence is the root **LICENSE** file (currently MIT).
- Third-party fonts, icons and other assets: **attribution and licences** are maintained in the **README / NOTICE (if present)**; the PRD does not paste legal text, to avoid two copies drifting.

---

## 10. Testing decisions

- **Good tests** verify **observable behaviour** and **public interfaces**, and avoid binding to internal implementation details.
- **Coverage priorities**: **pure functions and math utilities** (the existing Vitest setup); later, vertical-slice tests for **key session logic** (for example merging slow loudness, layout fallback strategy) — scoped by issue.
- **Rust**: keep the **`cargo test`** baseline; aligning metering-critical modules with **reference vectors / tolerances** is handled by dedicated issues.

---

## 11. Out of scope for this document

- **Specific class names / file paths / function signatures** (they go stale; the repository is authoritative).
- **Full DSP derivations** (carried by **`dsp-notes` (if added later)** and the architecture document).

---

## 12. Further notes

- **When this conflicts with `architecture.md`**: the **code** wins, then the documents are corrected.
- **Revising this document**: significant changes in product intent update this PRD, with the reason summarised in the commit message.

---

**End of document.**
