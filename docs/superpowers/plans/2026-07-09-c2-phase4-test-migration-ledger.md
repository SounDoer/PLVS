# C2 Phase 4a — `App.toolbar.test.js` Migration Ledger

**Rule:** delete an old source assertion only after its destination test is green, or record why the
assertion protects implementation rather than behavior.

| #   | Existing test intent                                   | Classification             | Destination                                                  | Status   |
| --- | ------------------------------------------------------ | -------------------------- | ------------------------------------------------------------ | -------- |
| 1   | Dynamic loudness weights IPC                           | IPC behavior               | `src/ipc/commands.test.js`                                   | migrated |
| 2   | Dialogue VAD IPC                                       | IPC behavior               | `src/ipc/commands.test.js`                                   | migrated |
| 3   | Device icon size                                       | rendered UI                | `AppHeader.test.jsx`                                         | migrated |
| 4   | Devices copy                                           | rendered UI                | `AppHeader.test.jsx`                                         | migrated |
| 5   | Formatted device labels/footer                         | rendered UI                | `AppHeader.test.jsx` + `App.smoke.test.jsx`                  | migrated |
| 6   | Snapshot does not overwrite live vectorscope selection | panel/runtime behavior     | `VectorscopePanel.test.jsx`                                  | migrated |
| 7   | Restored controls update aggregate requests            | workspace/runtime behavior | `src/runtime/appRuntimeDerivations.test.js`                  | migrated |
| 8   | No obsolete pending vectorscope guard                  | implementation-negative    | delete after runtime move                                    | retired  |
| 9   | Request-keyed realtime results                         | panel behavior             | existing Spectrum/Vectorscope tests; verify coverage         | migrated |
| 10  | Settings persistence stays in `useSettings`            | architecture contract      | `useSettings.rtl.test.jsx`                                   | migrated |
| 11  | Channel label overrides reach live labels              | runtime behavior           | `src/runtime/appRuntimeDerivations.test.js`                  | migrated |
| 12  | Channel label overrides reach loudness weights         | runtime/IPC behavior       | `src/runtime/appRuntimeDerivations.test.js`                  | migrated |
| 13  | Visible dialogue stats drive gating/VAD                | workspace/runtime behavior | `src/runtime/appRuntimeDerivations.test.js`                  | migrated |
| 14  | Clear preserves live capture                           | runtime behavior           | `MeterRuntimeContext.test.jsx`                               | migrated |
| 15  | Stable panel-control update avoids render loop         | regression behavior        | `App.smoke.test.jsx`                                         | migrated |
| 16  | Presets popover trigger                                | rendered UI                | `AppHeader.test.jsx`                                         | migrated |
| 17  | Focus View popover/active state                        | rendered UI                | `AppHeader.test.jsx`                                         | migrated |
| 18  | Focus View precedes Presets                            | rendered UI                | `AppHeader.test.jsx`                                         | migrated |
| 19  | Pin only lives in Focus View                           | rendered UI                | `AppHeader.test.jsx`                                         | migrated |
| 20  | Focus View reveal zones/Escape                         | shell behavior             | `App.smoke.test.jsx`                                         | migrated |
| 21  | Space does not toggle transport                        | shell behavior             | `App.smoke.test.jsx`                                         | migrated |
| 22  | Native context menu suppressed                         | shell behavior             | `App.smoke.test.jsx`                                         | migrated |
| 23  | Auto-hidden controls held for popovers                 | shell behavior             | `AppHeader.test.jsx`                                         | migrated |
| 24  | Shared footer classes                                  | visual implementation      | `App.smoke.test.jsx` visible footer hierarchy                | migrated |
| 25  | Presets icon stays muted                               | rendered UI                | `AppHeader.test.jsx`                                         | migrated |
| 26  | Modules tooltip copy                                   | rendered UI                | `AppHeader.test.jsx`                                         | migrated |
| 27  | File probe IPC                                         | IPC behavior               | `src/ipc/commands.test.js`                                   | migrated |
| 28  | File start/stop IPC and Channel                        | IPC behavior               | `src/ipc/commands.test.js`                                   | migrated |
| 29  | Window-bounds event marks preset dirty                 | shell/preset behavior      | `App.smoke.test.jsx`                                         | migrated |
| 30  | Source-aware transport cluster composition             | rendered UI                | `AppHeader.test.jsx`                                         | migrated |
| 31  | Source transport derives from runtime state            | runtime behavior           | runtime interface + existing `sourceTransportState.test.js`  | migrated |
| 32  | File-analysis event subscriptions                      | IPC behavior               | `src/ipc/events.test.js`                                     | migrated |
| 33  | File dialog seam                                       | IPC behavior               | `src/ipc/fileDialog.test.js` + `AppHeader.test.jsx`          | migrated |
| 34  | File analysis/drop/summary assembly                    | App assembly               | `App.smoke.test.jsx` + `FileDropOverlay.test.jsx`            | migrated |

## Migration progress

- Original tests: 34
- Migrated/retired and removed: 34
- Remaining source-reading tests: 0

The ledger is now at zero; `App.toolbar.test.js` has been deleted.
