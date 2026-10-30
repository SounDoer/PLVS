# Getting Started

Install PLVS and get through the first launch.

## Packages

Download the package for your platform from
[GitHub Releases](https://github.com/SounDoer/PLVS/releases).

| Platform              | Package                            | Notes                        |
| --------------------- | ---------------------------------- | ---------------------------- |
| Windows 10/11 (x64)   | `PLVS_<version>_x64-setup.exe`     | Installer                    |
| Windows 10/11 (x64)   | `PLVS-v<version>-x64-portable.zip` | Portable, no installation    |
| macOS (Apple Silicon) | `PLVS-v<version>-aarch64.dmg`      | Requires macOS 14.2 or later |
| Ubuntu 24.04 (x86_64) | `PLVS_<version>_amd64.deb`         | Debian package               |

## Windows

Run the installer, or extract the portable ZIP and launch `plvs.exe`. Keep all extracted portable
files together. Both builds use the WebView2 runtime that ships with Windows.

PLVS isn't code-signed yet, so Windows SmartScreen may warn on first run — choose **More info**, then
**Run anyway**.

## macOS

Open the DMG and drag PLVS into Applications. Official macOS builds are signed with the PLVS
Developer ID and notarized by Apple, so Gatekeeper can verify them normally. If Gatekeeper reports
that an official download is damaged or cannot be verified, delete it and download the DMG again
from the PLVS GitHub Releases page instead of bypassing the warning.

## Linux

The Linux package targets Ubuntu 24.04 x86_64. Install it with APT so it resolves the required
system libraries:

```sh
sudo apt install ./PLVS_<version>_amd64.deb
```

Launch **PLVS** from the application menu, or run `plvs`. `plvs-cli doctor --json` checks the
installed application and decoders. Audio capture requires a running PulseAudio server or PipeWire's
PulseAudio compatibility service. PLVS installs its own FFmpeg/FFprobe copies under
`/usr/lib/plvs/sidecars`; it neither needs nor replaces a system FFmpeg installation.

Stable packages that include the Linux update component can download signed updates in PLVS and
install them after you choose **Update and Restart**. Ubuntu shows its normal administrator
authentication prompt. The already verified package is installed offline through APT; PLVS does
not ask for or handle your password. Canceling authentication keeps the download so you can retry.
If the required system authorization tools or package dependencies are unavailable, update details
link to the `.deb` on GitHub Releases for manual installation. PLVS 0.23.0 and earlier need one
final manual `.deb` update: earlier versions lack the component, and 0.23.0 cannot complete the
installation. Your settings are kept.
Remove PLVS with `sudo apt remove plvs`; removing the package preserves user settings.

Dock and per-application capture are not available on Linux. See
[Signal Source](signal-source.md) for the Linux capture scope.

## Preview builds

Preview packages are test builds of unreleased commits, published as GitHub **Pre-releases** with
the source commit recorded in their notes. **PLVS Preview** is a separate application from PLVS: it
installs beside stable PLVS, keeps its own settings, and never checks for updates, so install each
new Preview by hand. A Preview usually contains a package for every platform:

| Platform              | Package                                                     |
| --------------------- | ----------------------------------------------------------- |
| Windows 10/11 (x64)   | `PLVS-Preview_<version>-preview.<commit>_x64-setup.exe`     |
| Windows 10/11 (x64)   | `PLVS-Preview-v<version>-preview.<commit>-x64-portable.zip` |
| macOS (Apple Silicon) | `PLVS-Preview_<version>-preview.<commit>_aarch64.dmg`       |
| Ubuntu 24.04 (x86_64) | `PLVS-Preview_<version>-preview.<commit>_amd64.deb`         |

On macOS, drag **PLVS Preview** into Applications. The DMG is signed and notarized like the
stable one. macOS asks for its permissions again, because it treats PLVS Preview as a separate app.

On Ubuntu, install the deb the same way as the stable package:

```sh
sudo apt install --reinstall ./PLVS-Preview_<version>-preview.<commit>_amd64.deb
```

Use `--reinstall` when switching Preview commits: their packages can share the same base version.
Launch **PLVS Preview** from the application menu, or run `plvs-preview`; its command-line tool is
`plvs-preview-cli`. Remove Preview with `sudo apt remove plvs-preview`. The PLVS 0.23.0 deb still
declares a conflict with Preview, so installing a Preview removes that one stable version; later
stable packages install side by side with Preview.

## First launch

### Quick Tour

After the first-launch update preferences are settled, **Quick Tour** offers a short introduction
to Start, Sources, Loudness Profile, Modules, Views, Presets, Panel Settings, Snapshot, and
Clear, and Settings in ten steps. Choose **Start Tour** or **Not Now**. You can also close it at any time.

The tour highlights real controls with a soft glow without blocking the rest of the interface. Every step has a
**Next** button; starting capture, changing settings, and entering Snapshot are optional. Opening a
menu or editor temporarily hides the tour. Once all menus and editors close, the same step returns
automatically without moving keyboard focus. Switching from a menu into an editor keeps the tour hidden.
Changes you make remain in place when you continue, finish, or close the tour.

The pointers follow controls when panels or the window move. If an entry is hidden or its panel
has been removed, the tour explains how to find it and still lets you continue. The tour covers
the normal Live workspace; File mode and Dock pause it until you return. It never switches modes
or restores your layout for you.

The invitation appears only for new installations, not on upgrade or in additional workbenches.
Your choice is stored locally for the application identity, with no tour telemetry. To view it
again, open **Settings** and choose **Quick Tour** beside **Docs** and **Feedback** at the bottom.
Reopening starts from the first step while keeping your measurement and settings.

### Initial Workspace and Update Preferences

A new installation opens with a starter workspace and a starter Loudness Profile. The workspace is
saved as the **PLVS Default** Preset, while the Profile is also named **PLVS Default**. The Preset lets you
return to the initial layout after rearranging it. **PLVS Default** is a general starting point, not
a delivery standard: True Peak above −1 dBTP fails, while Momentary above −6 LUFS, Short-term above
−12 LUFS, Integrated outside −30 to −16 LUFS, or Loudness Range above 18 LU warns. Both are ordinary
saved items that you can edit, rename, or delete. Once deleted, either one stays deleted; only
**Reset PLVS to Default** brings them back. PLVS never starts capturing audio on its own: pick a
signal source (see [Signal Source](signal-source.md)) and press Start when you're ready to monitor.

On a fresh first launch, **Update Preferences** offers automatic checking and automatic downloading.
The prompt links to the privacy policy.
Checking starts selected; downloading starts off. No automatic request is made before you save a
choice. **Skip** turns both off. Existing users retain checking on and downloading off without a
first-launch prompt. These preferences can be changed in Settings.

When checking is enabled, PLVS checks at startup and every 12 hours. Manual checks remain available
with automatic checking off. Update state appears in the toolbar's shared status area. Open its
status list and choose **View Update Details** for release notes, download progress and installation.
In Dock, the toolbar button shows a status icon while closed, and the toolbar names the state when
opened. Update checks and downloads never force the Dock toolbar open.

With automatic downloading enabled, PLVS verifies and keeps an update locally without interrupting
your work. On a later fresh launch, it offers **Update and Restart** or **Skip This Time**. Skipping
keeps the downloaded package. Installation always needs confirmation; there is no countdown. An
already active workbench defers the startup offer. Download completion does not open a dialog in
your current working session. Windows Portable copies use **Download Manually** on the release page;
they never run the installed-app updater. Installed stable Linux packages use the same verified
download and confirmation flow; Ubuntu supplies the administrator authentication dialog for the
APT installation. Preview builds do not check for updates.
