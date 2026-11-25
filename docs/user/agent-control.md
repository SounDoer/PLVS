# Agent Control

Agent Control lets you inspect and control the running PLVS from an AI client or the command line.
Open **Settings** and turn on **Agent Control** before connecting. Turning it off stops access for
all clients until you turn it on again.

<span id="chat-apps"></span>

## Connect an AI Client with MCP

MCP lets an AI client call PLVS tools. You can ask it which Loudness Profile is active, get a
screenshot of the Spectrum, or switch to a streaming profile. The client must support starting a
local MCP server over standard input and output (stdio).

1. Under **Settings → Agent Control → MCP Setup**, select **Copy**.
2. Paste the whole prompt into the AI client you want to connect. It includes the server name,
   the full path to this installation's `plvs-cli`, and the `mcp` argument. The prompt asks the client
   to use its own registration method and guide you through any steps you need to complete.
3. The client verifies the connection with `plvs_capabilities`. If it reports that PLVS is closed
   or Agent Control is off, open PLVS or turn Agent Control on, then ask it to check again.

### Register manually

If the AI client needs you to do the setup, open its MCP settings and add a local **stdio** server.
Use the server name, full command path, argument list, and any environment variables from the
copied prompt. Clients that accept `mcpServers` JSON can use the included entry. Merge it into
existing entries if needed. Follow the client's instructions for applying the change, then ask it
to run `plvs_capabilities` again.

You register the entry once per client. After a tool call reaches PLVS, **MCP Setup** can show the
last client's name and when it was used. Preview uses the server name `plvs-preview`, so stable and
Preview can be registered side by side.

### Use PLVS Tools

The client can check availability, read state, look up commands, run queries, wait for a change, take
screenshots, export files, and make changes.

Changes come in two tools so your chat app can treat them differently:

- **Ordinary changes**, such as choosing a Loudness Profile, adjusting a panel or switching a
  device, can be undone in PLVS. Many chat apps let you always allow them.
- **Risky changes** cannot be undone inside PLVS or end the connection: deleting or importing
  Presets, Themes or Loudness Profiles, overwriting a Preset, resetting or importing the
  configuration, resetting a layout or held readings, clearing measurements or File results,
  discarding an editor draft, answering a dialog, installing an update, or quitting. The chat app
  can ask you before each one even if you always allow ordinary changes, as long as it remembers
  permissions per tool.

A chat agent can be misled by content it reads elsewhere, such as a web page, into asking for a
change you did not intend. Read the confirmation before allowing a risky change.

Everything PLVS protects from the command line stays protected: the **Agent Control** switch only
you can turn on, open editors that refuse scene changes, and choices only you can make.

Long operations are waited for in steps of up to 45 seconds. Exports and File reports can appear
in the conversation. To create a Statistics CSV or keep a copy of a completed recording, ask the
client to save it. For example, ask it to save the MP4 to Downloads after the recording finishes.
Exports create new files under your home or Downloads folder. Give a full path, such as
`~/Documents/mix-report.md`, to choose where an export goes.

### What Leaves Your Computer

The MCP connection runs locally. Your chat app may send what the tools return to its own service
as part of the conversation. Results can include PLVS state and settings, measurement readings,
File reports and analysis results, exported Presets, Themes, Loudness Profiles and configuration,
file paths, and screenshots. Audio samples are never returned. PLVS keeps the most recent chat
app name and time in memory for the Settings status. See the
[Privacy Policy](https://plvs.soundoer.com/privacy/) and your chat app's privacy terms.

<span id="command-line"></span>

## Use the Command Line

Installed Windows, macOS, and Linux builds include `plvs-cli` for diagnosing the installation and
for inspecting or changing a running PLVS app. Agents with a local shell can use it directly.
See the [CLI Reference](cli.md) for the full command set.

### Where It Is

- **Windows**: `plvs-cli.exe` sits beside `plvs.exe`. Enabling **Agent Control** in Settings adds
  that directory to the current user's `PATH`; otherwise use the full path. From a Portable folder,
  run `.\plvs-cli.exe` and keep it beside `plvs.exe`.
- **macOS**: `/Applications/PLVS.app/Contents/MacOS/plvs-cli` (or the same path under
  `~/Applications`). Enabling **Agent Control** in Settings links it as `/usr/local/bin/plvs-cli`
  (`plvs-preview-cli` for Preview), which a new terminal finds by name. macOS asks for
  administrator authorization if writing there requires it. If you decline, or another
  installation owns the link, use the full path. To move the app, turn Agent Control off before
  moving it and enable it again from the new location. PLVS does not edit shell startup files.
- **Linux**: `/usr/bin/plvs-cli` for the stable package and `/usr/bin/plvs-preview-cli` for the
  Preview package, so the two can be installed side by side. Development builds
  stage `plvs-cli` beside the desktop executable. PLVS does not edit shell startup files.

### Check the Installation

`plvs-cli doctor --json` verifies the installed runtime and bundled sidecars, even while PLVS is
closed. Add `--out <file>` to write the result to a file.

### Control the Running App

Start PLVS and enable **Agent Control** in Settings. Then discover the available surface with
`plvs-cli capabilities --json` and read the app's current state with `plvs-cli inspect --json`.
Linux builds support PNG screenshots and H.264 MP4 recording of the visible PLVS
WebView, including optional AAC audio from the measured Live source. Keep the display session
unlocked and the window visible; Linux does not capture the system pointer. Recording on Linux uses
Ubuntu's own FFmpeg, which PLVS does not install: run `sudo apt install ffmpeg`, then restart PLVS.
`plvs-cli doctor` shows whether recording is available.

Queries return a global revision. Every change requires it, for example:

```bash
plvs-cli workspace apply layout.json --json --expected-revision 44
```

If the revision conflicts, inspect again and reconcile the change that happened in between, rather
than retrying blindly.
