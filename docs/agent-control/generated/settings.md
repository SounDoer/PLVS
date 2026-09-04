<!-- Generated from the App Control schema builders by src/agentControl/publicSurfaceDocs.test.js.
     Do not edit by hand; run `npm run docs:agent-control` after changing the public surface. -->

# Settings Control — Public Fields

Current values and writability are runtime state and are reported by `settings.inspect`, not
here. `appearance.resolvedThemeId` is read-only.

| Field | Type | Unit | Default | Allowed | In the default state |
| --- | --- | --- | --- | --- | --- |
| `openAtLogin` | boolean | - | `false` | - | - |
| `closeBehavior` | enum | - | `"ask"` | "ask", "tray", "quit" | - |
| `clearShortcut` | object | - | - | - | - |
| `clearShortcut.accelerator` | accelerator | - | `"CmdOrCtrl+K"` | - | - |
| `clearShortcut.global` | boolean | - | `false` | - | - |
| `interfaceSize` | enum | - | `"default"` | "small", "default", "large", "extra-large" | - |
| `appearance` | object | - | - | - | - |
| `appearance.mode` | enum | - | `"system"` | "system", "fixed" | - |
| `appearance.themeId` | enum | - | `null` | "<theme ids, from the theme library>" | - |
| `appearance.resolvedThemeId` | string | - | - | - | - |
| `historyRetentionSec` | enum | s | `3600` | 1800, 3600, 7200, 14400 | - |
| `dialogueVadEngine` | enum | - | `"firered"` | "firered", "silero", "ten" | - |
| `channelLabels` | object | - | - | - | - |
| `channelLabels.channelCount` | integer | - | - | - | - |
| `channelLabels.mode` | enum | - | - | "auto", "custom" | - |
| `channelLabels.roles` | array | - | - | each of "generic", "M", "L", "R", "C", "LFE", "Ls", "Rs", "Lb", "Rb", "Cs", "Ltf", "Rtf", "Ltr", "Rtr" | - |
