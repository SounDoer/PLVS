# C2 Phase 4a — `App.toolbar.test.js` Migration Ledger

**Rule:** delete an old source assertion only after its destination test is green, or record why the
assertion protects implementation rather than behavior.

| #   | Existing test intent                                   | Classification             | Destination                                                  | Status   |
| --- | ------------------------------------------------------ | -------------------------- | ------------------------------------------------------------ | -------- |
| 1   | Dynamic loudness weights IPC                           | IPC behavior               | `src/ipc/commands.test.js`                                   | migrated |
| 2   | Dialogue VAD IPC                                       | IPC behavior               | `src/ipc/commands.test.js`                                   | migrated |
| 3   | Device icon size                                       | rendered UI                | `AppHeader.test.jsx`                                         | pending  |
| 4   | Devices copy                                           | rendered UI                | `AppHeader.test.jsx`                                         | pending  |
| 5   | Formatted device labels/footer                         | rendered UI                | `AppHeader.test.jsx` + shell test                            | pending  |
| 6   | Snapshot does not overwrite live vectorscope selection | panel/runtime behavior     | `VectorscopePanel.test.jsx`                                  | pending  |
| 7   | Restored controls update aggregate requests            | workspace/runtime behavior | runtime interface test                                       | pending  |
| 8   | No obsolete pending vectorscope guard                  | implementation-negative    | delete after runtime move                                    | pending  |
| 9   | Request-keyed realtime results                         | panel behavior             | existing Spectrum/Vectorscope tests; verify coverage         | pending  |
| 10  | Settings persistence stays in `useSettings`            | architecture contract      | C3 owner test                                                | pending  |
| 11  | Channel label overrides reach live labels              | runtime behavior           | runtime interface test                                       | pending  |
| 12  | Channel label overrides reach loudness weights         | runtime/IPC behavior       | runtime interface test                                       | pending  |
| 13  | Visible dialogue stats drive gating/VAD                | workspace/runtime behavior | runtime interface test                                       | pending  |
| 14  | Clear preserves live capture                           | runtime behavior           | `MeterRuntimeContext.test.jsx`                               | migrated |
| 15  | Stable panel-control update avoids render loop         | regression behavior        | App START regression test                                    | pending  |
| 16  | Presets popover trigger                                | rendered UI                | `AppHeader.test.jsx`                                         | pending  |
| 17  | Focus View popover/active state                        | rendered UI                | `AppHeader.test.jsx`                                         | pending  |
| 18  | Focus View precedes Presets                            | rendered UI                | `AppHeader.test.jsx`                                         | pending  |
| 19  | Pin only lives in Focus View                           | rendered UI                | `AppHeader.test.jsx`                                         | pending  |
| 20  | Focus View reveal zones/Escape                         | shell behavior             | focus-shell test                                             | pending  |
| 21  | Space does not toggle transport                        | shell behavior             | keyboard behavior test                                       | pending  |
| 22  | Native context menu suppressed                         | shell behavior             | shell event test                                             | pending  |
| 23  | Auto-hidden controls held for popovers                 | shell behavior             | focus-shell test                                             | pending  |
| 24  | Shared footer classes                                  | visual implementation      | retain only visible hierarchy behavior                       | pending  |
| 25  | Presets icon stays muted                               | rendered UI                | `AppHeader.test.jsx`                                         | pending  |
| 26  | Modules tooltip copy                                   | rendered UI                | `AppHeader.test.jsx`                                         | pending  |
| 27  | File probe IPC                                         | IPC behavior               | `src/ipc/commands.test.js`                                   | migrated |
| 28  | File start/stop IPC and Channel                        | IPC behavior               | `src/ipc/commands.test.js`                                   | migrated |
| 29  | Window-bounds event marks preset dirty                 | shell/preset behavior      | preset integration test                                      | pending  |
| 30  | Source-aware transport cluster composition             | rendered UI                | `AppHeader.test.jsx`                                         | pending  |
| 31  | Source transport derives from runtime state            | runtime behavior           | runtime interface + existing `sourceTransportState.test.js`  | migrated |
| 32  | File-analysis event subscriptions                      | IPC behavior               | `src/ipc/events.test.js`                                     | migrated |
| 33  | File dialog seam                                       | IPC behavior               | existing `fileDialog.test.js`; add caller behavior if needed | pending  |
| 34  | File analysis/drop/summary assembly                    | App assembly               | App smoke/integration test                                   | pending  |

## Migration progress

- Original tests: 34
- Migrated and removed: 7
- Remaining source-reading tests: 27

The ledger reaches zero only through incremental migrations. `App.toolbar.test.js` is deleted last.
