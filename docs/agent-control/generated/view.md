<!-- Generated from the Agent Control schema builders by src/agentControl/publicSurfaceDocs.test.js.
     Do not edit by hand; run `npm run docs:agent-control` after changing the public surface. -->

# View Control — Public Fields

Current values, platform writability, and Dock ownership are runtime state and are reported by
`view describe` and `view inspect`, not here.

| Field | Type | Unit | Default | Allowed | In the default state |
| --- | --- | --- | --- | --- | --- |
| `pinned` | boolean | - | `false` | - | - |
| `focusView` | object | - | - | - | - |
| `focusView.autoHideControls` | boolean | - | `false` | - | - |
| `focusView.compactPanels` | boolean | - | `false` | - | - |
| `focusView.borderless` | boolean | - | `false` | - | - |
| `panelPresentation` | object | - | - | - | - |
| `panelPresentation.workspace` | object | - | - | - | - |
| `panelPresentation.workspace.hidePanelHeaders` | boolean | - | `false` | - | - |
| `panelPresentation.workspace.hideAxesAndLabels` | boolean | - | `false` | - | - |
| `panelPresentation.dock` | object | - | - | - | - |
| `panelPresentation.dock.hideAxesAndLabels` | boolean | - | `false` | - | - |
| `surfaceOpacity` | integer | percent | `100` | 0 to 100 | - |
| `glassEnabled` | boolean | - | `false` | - | - |
