# Chat Apps

A desktop chat app or agent can inspect and control the running PLVS for you: ask "Which Loudness
Profile is active?", "Show me the Spectrum", or "Switch to the streaming profile", and it reads or
changes PLVS through **Agent Control**. It connects through MCP (Model Context Protocol), the
common way such apps run tools on your computer, and can do what the [command line](command-line.md)
can do.

Terminal agents that run commands themselves, such as coding agents, can use `plvs-cli` directly
and need no MCP setup.

## Setting it up

1. Open **Settings** and turn on **Agent Control**.
2. Under **MCP Setup**, copy the entry. It names this installation's `plvs-cli` and the argument
   `mcp`, for example:

   ```json
   {
     "mcpServers": {
       "plvs": {
         "command": "/Applications/PLVS.app/Contents/MacOS/plvs-cli",
         "args": ["mcp"]
       }
     }
   }
   ```

3. Add it to your chat app as a local MCP server, then restart the app if it asks you to.
   - Apps with an MCP configuration file that uses `mcpServers` (Claude Desktop, for example) take
     the entry as it is, merged into that file.
   - Apps with a form for adding a local or "stdio" server take the same two values: the command
     path and the argument `mcp`.
   - A few apps name the outer key differently or use another file format; the command path and the
     argument `mcp` stay the same.
   - Agents that can edit their own configuration can be asked to add the entry for you.
4. Ask the chat app anything about PLVS. The line under **MCP Setup** then changes from "Not used
   yet" to the app's name and the time it last used PLVS.

You register the entry once. Turning **Agent Control** off stops every chat app and terminal agent
until you turn it on again; nothing needs to be removed. Only desktop apps can reach PLVS this way:
chat apps that run only in a web browser cannot start a program on your computer.

Preview installs show `plvs-preview` as the server name, so Stable and Preview can be registered
side by side.

## What the chat app can do

The app gets eight tools: it can check whether PLVS is available, read its state, look up how a
command works, run read-only queries, wait for a change, take screenshots, and make changes.

Changes come in two tools so your chat app can treat them differently:

- **Ordinary changes**, such as choosing a Loudness Profile, adjusting a panel or switching a
  device, can be undone in PLVS. Many chat apps let you always allow them.
- **Risky changes** cannot be undone inside PLVS or end the connection: deleting or importing
  Presets, Themes or Loudness Profiles, overwriting a Preset, resetting or importing the
  configuration, resetting a layout or held readings, clearing measurements or File results,
  discarding an editor draft, answering a dialog, installing an update, or quitting. The chat app
  asks you before each one even if you always allow ordinary changes, as long as it remembers
  permissions per tool.

A chat agent can be misled by content it reads elsewhere, such as a web page, into asking for a
change you did not intend. Read the confirmation before allowing a risky change.

Everything PLVS protects from the command line stays protected: the **Agent Control** switch only
you can turn on, open editors that refuse scene changes, and choices only you can make.

Long operations, such as analyzing a long file, are waited for in steps of up to 45 seconds; the
chat app keeps checking until the result is ready. Exports and File reports appear in the
conversation unless you ask the app to save them. File Statistics CSV and screen recordings are
saved to your Downloads folder, and the app tells you where. File paths you give it must be full
paths, such as `~/Music/mix.wav`.

## What leaves your computer

PLVS itself sends nothing. Your chat app sends what the tools return to its own service, as part
of the conversation: PLVS state and settings, measurement readings, File reports and analysis
results, exported Presets, Themes, Loudness Profiles and configuration, file paths, and
screenshots. Audio samples are never returned. Check your chat app's privacy terms before using it
with confidential material.
