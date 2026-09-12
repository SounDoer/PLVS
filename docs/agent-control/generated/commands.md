<!-- Generated from the Agent Control schema builders by src/agentControl/publicSurfaceDocs.test.js.
     Do not edit by hand; run `npm run docs:agent-control` after changing the public surface. -->

# Agent Control — Command Catalog

Manifest version `1`. Entries are shown in stable presentation order.

| Command ID | CLI path | Execution / operation | Revision | Dry run | Output file |
| --- | --- | --- | --- | --- | --- |
| `app.capabilities` | `capabilities` | runningApp / query | none | no | none |
| `app.inspect` | `inspect` | runningApp / query | none | no | none |
| `measurement.describe` | `measurement describe` | runningApp / query | none | no | none |
| `measurement.inspect` | `measurement inspect` | runningApp / query | none | no | none |
| `measurement.wait` | `measurement wait` | runningApp / wait | none | no | none |
| `measurement.waitUntil` | `measurement wait-until` | runningApp / wait | none | no | none |
| `view.describe` | `view describe` | runningApp / query | none | no | none |
| `view.inspect` | `view inspect` | runningApp / query | none | no | none |
| `view.update` | `view update` | runningApp / mutation | required | yes | none |
| `view.reset` | `view reset` | runningApp / mutation | required | yes | none |
| `module.list` | `module list` | runningApp / query | none | no | none |
| `module.describe` | `module describe` | runningApp / query | none | no | none |
| `workspace.applyLayout` | `workspace apply` | runningApp / mutation | required | yes | none |
| `axis.describe` | `axis describe` | runningApp / query | none | no | none |
| `axis.inspect` | `axis inspect` | runningApp / query | none | no | none |
| `axis.shared.update` | `axis shared update` | runningApp / mutation | required | yes | none |
| `axis.shared.reset` | `axis shared reset` | runningApp / mutation | required | yes | none |
| `axis.panel.update` | `axis panel update` | runningApp / mutation | required | yes | none |
| `axis.panel.reset` | `axis panel reset` | runningApp / mutation | required | yes | none |
| `panel.describe` | `panel describe` | runningApp / query | none | no | none |
| `panel.update` | `panel update` | runningApp / mutation | required | yes | none |
| `panel.reset` | `panel reset` | runningApp / mutation | required | yes | none |
| `preset.list` | `preset list` | runningApp / query | none | no | none |
| `preset.describe` | `preset describe` | runningApp / query | none | no | none |
| `preset.rename` | `preset rename` | runningApp / mutation | required | yes | none |
| `preset.delete` | `preset delete` | runningApp / mutation | required | yes | none |
| `preset.reorder` | `preset reorder` | runningApp / mutation | required | yes | none |
| `preset.save` | `preset save` | runningApp / mutation | required | yes | none |
| `preset.update` | `preset update` | runningApp / mutation | required | yes | none |
| `preset.apply` | `preset apply` | runningApp / mutation | required | yes | none |
| `preset.export` | `preset export` | runningApp / query | none | no | optional |
| `preset.import` | `preset import` | runningApp / mutation | required | yes | none |
| `theme.list` | `theme list` | runningApp / query | none | no | none |
| `theme.inspect` | `theme inspect` | runningApp / query | none | no | none |
| `theme.describe` | `theme describe` | runningApp / query | none | no | none |
| `theme.select` | `theme select` | runningApp / mutation | required | yes | none |
| `theme.followSystem` | `theme follow-system` | runningApp / mutation | required | yes | none |
| `theme.create` | `theme create` | runningApp / mutation | required | yes | none |
| `theme.update` | `theme update` | runningApp / mutation | required | yes | none |
| `theme.rename` | `theme rename` | runningApp / mutation | required | yes | none |
| `theme.duplicate` | `theme duplicate` | runningApp / mutation | required | yes | none |
| `theme.delete` | `theme delete` | runningApp / mutation | required | yes | none |
| `theme.reorder` | `theme reorder` | runningApp / mutation | required | yes | none |
| `theme.export` | `theme export` | runningApp / query | none | no | optional |
| `theme.import` | `theme import` | runningApp / mutation | required | yes | none |
| `loudnessProfile.list` | `loudness-profile list` | runningApp / query | none | no | none |
| `loudnessProfile.describe` | `loudness-profile describe` | runningApp / query | none | no | none |
| `loudnessProfile.select` | `loudness-profile select` | runningApp / mutation | required | yes | none |
| `loudnessProfile.create` | `loudness-profile create` | runningApp / mutation | required | yes | none |
| `loudnessProfile.update` | `loudness-profile update` | runningApp / mutation | required | yes | none |
| `loudnessProfile.rename` | `loudness-profile rename` | runningApp / mutation | required | yes | none |
| `loudnessProfile.delete` | `loudness-profile delete` | runningApp / mutation | required | yes | none |
| `loudnessProfile.reorder` | `loudness-profile reorder` | runningApp / mutation | required | yes | none |
| `loudnessProfile.export` | `loudness-profile export` | runningApp / query | none | no | optional |
| `loudnessProfile.import` | `loudness-profile import` | runningApp / mutation | required | yes | none |
| `config.export` | `config export` | runningApp / query | none | no | optional |
| `config.import` | `config import` | runningApp / mutation | required | yes | none |
| `settings.describe` | `settings describe` | runningApp / query | none | no | none |
| `settings.inspect` | `settings inspect` | runningApp / query | none | no | none |
| `settings.update` | `settings update` | runningApp / mutation | required | yes | none |
| `device.list` | `device list` | runningApp / query | none | no | none |
| `device.inspect` | `device inspect` | runningApp / query | none | no | none |
| `device.select` | `device select` | runningApp / mutation | required | yes | none |
| `app.wait` | `wait` | runningApp / wait | none | no | none |
| `transport.inspect` | `transport inspect` | runningApp / query | none | no | none |
| `transport.source.live` | `transport source live` | runningApp / mutation | required | yes | none |
| `transport.source.file` | `transport source file` | runningApp / mutation | required | yes | none |
| `transport.live.start` | `transport live start` | runningApp / action | required | no | none |
| `transport.live.stop` | `transport live stop` | runningApp / action | required | no | none |
| `transport.live.clear` | `transport live clear` | runningApp / mutation | required | yes | none |
| `transport.file.analyze` | `transport file analyze` | runningApp / action | required | no | none |
| `transport.file.reanalyze` | `transport file reanalyze` | runningApp / action | required | no | none |
| `transport.file.stop` | `transport file stop` | runningApp / action | required | no | none |
| `transport.file.select` | `transport file select` | runningApp / mutation | required | yes | none |
| `transport.file.remove` | `transport file remove` | runningApp / mutation | required | yes | none |
| `transport.file.clear` | `transport file clear` | runningApp / mutation | required | yes | none |
| `transport.file.report` | `transport file report` | runningApp / query | none | no | optional |
| `dock.describe` | `dock describe` | runningApp / query | none | no | none |
| `dock.inspect` | `dock inspect` | runningApp / query | none | no | none |
| `dock.enter` | `dock enter` | runningApp / mutation | required | yes | none |
| `dock.exit` | `dock exit` | runningApp / mutation | required | yes | none |
| `dock.layout.apply` | `dock layout apply` | runningApp / mutation | required | yes | none |
| `dock.panel.describe` | `dock panel describe` | runningApp / query | none | no | none |
| `dock.panel.update` | `dock panel update` | runningApp / mutation | required | yes | none |
| `dock.panel.reset` | `dock panel reset` | runningApp / mutation | required | yes | none |
| `visual.describe` | `visual describe` | runningApp / query | none | no | none |
| `visual.screenshot` | `visual screenshot` | runningApp / action | optional | no | required |
| `visual.recording.start` | `visual recording start` | runningApp / action | optional | no | none |
| `visual.recording.inspect` | `visual recording inspect` | runningApp / query | none | no | none |
| `visual.recording.wait` | `visual recording wait` | runningApp / wait | none | no | optional |
| `visual.recording.stop` | `visual recording stop` | runningApp / action | none | no | optional |
| `doctor` | `doctor` | offline / query | none | no | optional |
| `schema.list` | `schema list` | offline / query | none | no | none |
| `schema.get` | `schema get` | offline / query | none | no | none |
| `completion` | `completion` | offline / query | none | no | none |

## `app.capabilities`

Report the running app compatibility and capability surface.

- CLI path: `capabilities`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `app.capabilities`

```text
plvs-cli capabilities <--json|--format text>
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `app.inspect`

Inspect the running application's public mutable state.

- CLI path: `inspect`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `app.inspect`

```text
plvs-cli inspect <--json|--format text>
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `measurement.describe`

Describe the measurement read contract.

- CLI path: `measurement describe`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `measurement.describe`

```text
plvs-cli measurement describe <--json|--format text>
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `measurement.inspect`

Inspect the latest measurement state.

- CLI path: `measurement inspect`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `measurement.inspect`

```text
plvs-cli measurement inspect <--json|--format text>
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `measurement.wait`

Wait for a newer measurement frame.

- CLI path: `measurement wait`
- Execution: `runningApp`; operation: `wait`
- JSON: `required`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `measurement.wait`

```text
plvs-cli measurement wait --after-generation <n> [--after-sequence <n>] [--timeout-ms <n>] --json
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--after-generation` | `afterGeneration` | yes | integer; 0 to inf |
| `--after-sequence` | `afterSequence` | no | integer; 0 to inf |
| `--timeout-ms` | `timeoutMs` | no | integer; 100 to 300000; default 30000 |
| `--json` | local only | yes | boolean |

## `measurement.waitUntil`

Wait until a bounded LIVE measurement predicate is satisfied.

- CLI path: `measurement wait-until`
- Execution: `runningApp`; operation: `wait`
- JSON: `required`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `measurement.waitUntil`
- Schema references: `measurement.predicate`

```text
plvs-cli measurement wait-until <file|-> [--timeout-ms <n>] --json
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `file\|-` | `predicate` | yes | ref measurement.predicate |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--timeout-ms` | `timeoutMs` | no | integer; 100 to 300000; default 30000 |
| `--json` | local only | yes | boolean |

## `view.describe`

Describe public view controls.

- CLI path: `view describe`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `view.describe`

```text
plvs-cli view describe <--json|--format text>
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `view.inspect`

Inspect public view state.

- CLI path: `view inspect`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `view.inspect`

```text
plvs-cli view inspect <--json|--format text>
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `view.update`

Update public view state.

- CLI path: `view update`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `view.update`
- Schema references: `agentControl.revision`, `view.patch`

```text
plvs-cli view update <file|-> --expected-revision <n> --json [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `file\|-` | `patch` | yes | string; ref view.patch |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--json` | local only | yes | boolean |
| `--dry-run` | `dryRun` | no | boolean |

## `view.reset`

Reset public view state.

- CLI path: `view reset`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `view.reset`
- Schema references: `agentControl.revision`

```text
plvs-cli view reset --expected-revision <n> --json [--dry-run]
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--json` | local only | yes | boolean |
| `--dry-run` | `dryRun` | no | boolean |

## `module.list`

List available panel modules.

- CLI path: `module list`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `module.list`

```text
plvs-cli module list <--json|--format text>
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `module.describe`

Describe an available panel module.

- CLI path: `module describe`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `module.describe`

```text
plvs-cli module describe <module-id> <--json|--format text>
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `module-id` | `moduleId` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `workspace.applyLayout`

Apply a workspace layout document.

- CLI path: `workspace apply`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `workspace.applyLayout`
- Schema references: `workspace.layout`, `agentControl.revision`

```text
plvs-cli workspace apply <file|-> --json --expected-revision <n> [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `file\|-` | `layout` | yes | string; ref workspace.layout |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--dry-run` | `dryRun` | no | boolean |

## `axis.describe`

Describe public axis controls.

- CLI path: `axis describe`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `axis.describe`

```text
plvs-cli axis describe <--json|--format text>
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `axis.inspect`

Inspect public axis state.

- CLI path: `axis inspect`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `axis.inspect`

```text
plvs-cli axis inspect <--json|--format text>
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `axis.shared.update`

Update a shared workspace axis.

- CLI path: `axis shared update`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `axis.shared.update`
- Schema references: `agentControl.revision`, `axis.patch.runtime`

```text
plvs-cli axis shared update <frequency|time> <file|-> --json --expected-revision <n> [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `frequency\|time` | `kind` | yes | string |
| `file\|-` | `range` | yes | string; ref axis.patch.runtime |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--dry-run` | `dryRun` | no | boolean |

## `axis.shared.reset`

Reset a shared workspace axis.

- CLI path: `axis shared reset`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `axis.shared.reset`
- Schema references: `agentControl.revision`

```text
plvs-cli axis shared reset <frequency|time> --json --expected-revision <n> [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `frequency\|time` | `kind` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--dry-run` | `dryRun` | no | boolean |

## `axis.panel.update`

Update a panel-local axis.

- CLI path: `axis panel update`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `axis.panel.update`
- Schema references: `agentControl.revision`, `axis.patch.runtime`

```text
plvs-cli axis panel update <panel-id> <frequency|time> <file|-> --json --expected-revision <n> [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `panel-id` | `panelId` | yes | string |
| `frequency\|time` | `kind` | yes | string |
| `file\|-` | `patch` | yes | string; ref axis.patch.runtime |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--dry-run` | `dryRun` | no | boolean |

## `axis.panel.reset`

Reset a panel-local axis.

- CLI path: `axis panel reset`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `axis.panel.reset`
- Schema references: `agentControl.revision`

```text
plvs-cli axis panel reset <panel-id> <frequency|time> --json --expected-revision <n> [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `panel-id` | `panelId` | yes | string |
| `frequency\|time` | `kind` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--dry-run` | `dryRun` | no | boolean |

## `panel.describe`

Describe one live panel.

- CLI path: `panel describe`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `panel.describe`

```text
plvs-cli panel describe <panel-id> <--json|--format text>
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `panel-id` | `panelId` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `panel.update`

Update one live panel's public controls.

- CLI path: `panel update`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `panel.update`
- Schema references: `agentControl.revision`, `panel.patch.runtime`

```text
plvs-cli panel update <panel-id> <file|-> --json --expected-revision <n> [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `panel-id` | `panelId` | yes | string |
| `file\|-` | `patch` | yes | string; ref panel.patch.runtime |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--dry-run` | `dryRun` | no | boolean |

## `panel.reset`

Reset one live panel's public controls.

- CLI path: `panel reset`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `panel.reset`
- Schema references: `agentControl.revision`

```text
plvs-cli panel reset <panel-id> --json --expected-revision <n> [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `panel-id` | `panelId` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--dry-run` | `dryRun` | no | boolean |

## `preset.list`

List presets.

- CLI path: `preset list`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `preset.list`

```text
plvs-cli preset list <--json|--format text>
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `preset.describe`

Describe a preset.

- CLI path: `preset describe`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `preset.describe`

```text
plvs-cli preset describe <preset-id> <--json|--format text>
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `preset-id` | `presetId` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `preset.rename`

Rename a preset.

- CLI path: `preset rename`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `preset.rename`
- Schema references: `agentControl.revision`

```text
plvs-cli preset rename <preset-id> <name> --json --expected-revision <n> [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `preset-id` | `presetId` | yes | string |
| `name` | `name` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--dry-run` | `dryRun` | no | boolean |

## `preset.delete`

Delete a preset.

- CLI path: `preset delete`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `preset.delete`
- Schema references: `agentControl.revision`

```text
plvs-cli preset delete <preset-id> --json --expected-revision <n> [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `preset-id` | `presetId` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--dry-run` | `dryRun` | no | boolean |

## `preset.reorder`

Reorder presets.

- CLI path: `preset reorder`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `preset.reorder`
- Schema references: `agentControl.revision`, `preset.order`

```text
plvs-cli preset reorder <file|-> --json --expected-revision <n> [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `file\|-` | `presetIds` | yes | string; ref preset.order |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--dry-run` | `dryRun` | no | boolean |

## `preset.save`

Save the current scene as a preset.

- CLI path: `preset save`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `preset.save`
- Schema references: `agentControl.revision`

```text
plvs-cli preset save <name> --json --expected-revision <n> [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `name` | `name` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--dry-run` | `dryRun` | no | boolean |

## `preset.update`

Update a preset from the current scene.

- CLI path: `preset update`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `preset.update`
- Schema references: `agentControl.revision`

```text
plvs-cli preset update <preset-id> --json --expected-revision <n> [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `preset-id` | `presetId` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--dry-run` | `dryRun` | no | boolean |

## `preset.apply`

Apply a preset.

- CLI path: `preset apply`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `preset.apply`
- Schema references: `agentControl.revision`

```text
plvs-cli preset apply <preset-id> --json --expected-revision <n> [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `preset-id` | `presetId` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--dry-run` | `dryRun` | no | boolean |

## `preset.export`

Export presets as a library pack.

- CLI path: `preset export`
- Execution: `runningApp`; operation: `query`
- JSON: `required`; expected revision: `none`; dry-run: `false`; output file: `optional`
- Wire method: `preset.export`

```text
plvs-cli preset export <--all|--ids <id,...>> --json [--out <file>]
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--all` | local only | no | boolean |
| `--ids` | `ids` | no | array |
| `--json` | local only | yes | boolean |
| `--out` | local only | no | string |

## `preset.import`

Import a preset library pack.

- CLI path: `preset import`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `preset.import`
- Schema references: `preset.pack`, `agentControl.revision`

```text
plvs-cli preset import <file|-> --json --expected-revision <n> [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `file\|-` | `pack` | yes | string; ref preset.pack |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--dry-run` | `dryRun` | no | boolean |

## `theme.list`

List themes.

- CLI path: `theme list`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `theme.list`

```text
plvs-cli theme list <--json|--format text>
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `theme.inspect`

Inspect the active theme state.

- CLI path: `theme inspect`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `theme.inspect`

```text
plvs-cli theme inspect <--json|--format text>
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `theme.describe`

Describe a theme.

- CLI path: `theme describe`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `theme.describe`

```text
plvs-cli theme describe <theme-id> <--json|--format text>
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `theme-id` | `themeId` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `theme.select`

Select a theme.

- CLI path: `theme select`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `theme.select`
- Schema references: `agentControl.revision`

```text
plvs-cli theme select <theme-id> --expected-revision <n> --json [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `theme-id` | `themeId` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--json` | local only | yes | boolean |
| `--dry-run` | `dryRun` | no | boolean |

## `theme.followSystem`

Follow the system appearance mode.

- CLI path: `theme follow-system`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `theme.followSystem`
- Schema references: `agentControl.revision`

```text
plvs-cli theme follow-system --expected-revision <n> --json [--dry-run]
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--json` | local only | yes | boolean |
| `--dry-run` | `dryRun` | no | boolean |

## `theme.create`

Create a theme.

- CLI path: `theme create`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `theme.create`
- Schema references: `agentControl.revision`, `theme.document.v2`

```text
plvs-cli theme create <file|-> --expected-revision <n> --json [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `file\|-` | `document` | yes | string; ref theme.document.v2 |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--json` | local only | yes | boolean |
| `--dry-run` | `dryRun` | no | boolean |

## `theme.update`

Update a theme.

- CLI path: `theme update`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `theme.update`
- Schema references: `agentControl.revision`, `theme.document.v2`

```text
plvs-cli theme update <theme-id> <file|-> --expected-revision <n> --json [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `theme-id` | `themeId` | yes | string |
| `file\|-` | `document` | yes | string; ref theme.document.v2 |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--json` | local only | yes | boolean |
| `--dry-run` | `dryRun` | no | boolean |

## `theme.rename`

Rename a theme.

- CLI path: `theme rename`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `theme.rename`
- Schema references: `agentControl.revision`

```text
plvs-cli theme rename <theme-id> <name> --expected-revision <n> --json [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `theme-id` | `themeId` | yes | string |
| `name` | `name` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--json` | local only | yes | boolean |
| `--dry-run` | `dryRun` | no | boolean |

## `theme.duplicate`

Duplicate a theme.

- CLI path: `theme duplicate`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `theme.duplicate`
- Schema references: `agentControl.revision`

```text
plvs-cli theme duplicate <theme-id> <name> --expected-revision <n> --json [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `theme-id` | `themeId` | yes | string |
| `name` | `name` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--json` | local only | yes | boolean |
| `--dry-run` | `dryRun` | no | boolean |

## `theme.delete`

Delete a theme.

- CLI path: `theme delete`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `theme.delete`
- Schema references: `agentControl.revision`

```text
plvs-cli theme delete <theme-id> --expected-revision <n> --json [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `theme-id` | `themeId` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--json` | local only | yes | boolean |
| `--dry-run` | `dryRun` | no | boolean |

## `theme.reorder`

Reorder themes.

- CLI path: `theme reorder`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `theme.reorder`
- Schema references: `agentControl.revision`, `theme.order`

```text
plvs-cli theme reorder <file|-> --expected-revision <n> --json [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `file\|-` | `themeIds` | yes | string; ref theme.order |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--json` | local only | yes | boolean |
| `--dry-run` | `dryRun` | no | boolean |

## `theme.export`

Export themes as a library pack.

- CLI path: `theme export`
- Execution: `runningApp`; operation: `query`
- JSON: `required`; expected revision: `none`; dry-run: `false`; output file: `optional`
- Wire method: `theme.export`

```text
plvs-cli theme export <--all|--ids <id,...>> --json [--out <file>]
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--all` | local only | no | boolean |
| `--ids` | `ids` | no | array |
| `--json` | local only | yes | boolean |
| `--out` | local only | no | string |

## `theme.import`

Import a theme library pack.

- CLI path: `theme import`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `theme.import`
- Schema references: `theme.pack`, `agentControl.revision`

```text
plvs-cli theme import <file|-> --json --expected-revision <n> [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `file\|-` | `pack` | yes | string; ref theme.pack |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--dry-run` | `dryRun` | no | boolean |

## `loudnessProfile.list`

List loudness profiles.

- CLI path: `loudness-profile list`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `loudnessProfile.list`

```text
plvs-cli loudness-profile list <--json|--format text>
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `loudnessProfile.describe`

Describe a loudness profile.

- CLI path: `loudness-profile describe`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `loudnessProfile.describe`

```text
plvs-cli loudness-profile describe <profile-id> <--json|--format text>
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `profile-id` | `profileId` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `loudnessProfile.select`

Select or disable a loudness profile.

- CLI path: `loudness-profile select`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `loudnessProfile.select`
- Schema references: `agentControl.revision`

```text
plvs-cli loudness-profile select <profile-id|off> --expected-revision <n> --json [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `profile-id\|off` | `profileId` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--json` | local only | yes | boolean |
| `--dry-run` | `dryRun` | no | boolean |

## `loudnessProfile.create`

Create a loudness profile.

- CLI path: `loudness-profile create`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `loudnessProfile.create`
- Schema references: `agentControl.revision`, `loudnessProfile.document`

```text
plvs-cli loudness-profile create <file|-> --expected-revision <n> --json [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `file\|-` | `document` | yes | string; ref loudnessProfile.document |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--json` | local only | yes | boolean |
| `--dry-run` | `dryRun` | no | boolean |

## `loudnessProfile.update`

Update a loudness profile.

- CLI path: `loudness-profile update`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `loudnessProfile.update`
- Schema references: `agentControl.revision`, `loudnessProfile.document`

```text
plvs-cli loudness-profile update <profile-id> <file|-> --expected-revision <n> --json [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `profile-id` | `profileId` | yes | string |
| `file\|-` | `document` | yes | string; ref loudnessProfile.document |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--json` | local only | yes | boolean |
| `--dry-run` | `dryRun` | no | boolean |

## `loudnessProfile.rename`

Rename a loudness profile.

- CLI path: `loudness-profile rename`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `loudnessProfile.rename`
- Schema references: `agentControl.revision`

```text
plvs-cli loudness-profile rename <profile-id> <name> --expected-revision <n> --json [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `profile-id` | `profileId` | yes | string |
| `name` | `name` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--json` | local only | yes | boolean |
| `--dry-run` | `dryRun` | no | boolean |

## `loudnessProfile.delete`

Delete a loudness profile.

- CLI path: `loudness-profile delete`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `loudnessProfile.delete`
- Schema references: `agentControl.revision`

```text
plvs-cli loudness-profile delete <profile-id> --expected-revision <n> --json [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `profile-id` | `profileId` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--json` | local only | yes | boolean |
| `--dry-run` | `dryRun` | no | boolean |

## `loudnessProfile.reorder`

Reorder loudness profiles.

- CLI path: `loudness-profile reorder`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `loudnessProfile.reorder`
- Schema references: `agentControl.revision`, `loudnessProfile.order`

```text
plvs-cli loudness-profile reorder <file|-> --expected-revision <n> --json [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `file\|-` | `profileIds` | yes | string; ref loudnessProfile.order |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--json` | local only | yes | boolean |
| `--dry-run` | `dryRun` | no | boolean |

## `loudnessProfile.export`

Export loudness profiles as a library pack.

- CLI path: `loudness-profile export`
- Execution: `runningApp`; operation: `query`
- JSON: `required`; expected revision: `none`; dry-run: `false`; output file: `optional`
- Wire method: `loudnessProfile.export`

```text
plvs-cli loudness-profile export <--all|--ids <id,...>> --json [--out <file>]
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--all` | local only | no | boolean |
| `--ids` | `ids` | no | array |
| `--json` | local only | yes | boolean |
| `--out` | local only | no | string |

## `loudnessProfile.import`

Import a loudness profile library pack.

- CLI path: `loudness-profile import`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `loudnessProfile.import`
- Schema references: `loudnessProfile.pack`, `agentControl.revision`

```text
plvs-cli loudness-profile import <file|-> --json --expected-revision <n> [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `file\|-` | `pack` | yes | string; ref loudnessProfile.pack |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--dry-run` | `dryRun` | no | boolean |

## `config.export`

Export the complete public configuration.

- CLI path: `config export`
- Execution: `runningApp`; operation: `query`
- JSON: `required`; expected revision: `none`; dry-run: `false`; output file: `optional`
- Wire method: `config.export`

```text
plvs-cli config export --json [--out <file>]
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--out` | local only | no | string |

## `config.import`

Import the complete public configuration.

- CLI path: `config import`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `config.import`
- Schema references: `configurationProfile.v1`, `agentControl.revision`

```text
plvs-cli config import <file|-> --expected-revision <n> --json [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `file\|-` | `configuration` | yes | string; ref configurationProfile.v1 |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--json` | local only | yes | boolean |
| `--dry-run` | `dryRun` | no | boolean |

## `settings.describe`

Describe public settings.

- CLI path: `settings describe`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `settings.describe`

```text
plvs-cli settings describe <--json|--format text>
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `settings.inspect`

Inspect public settings.

- CLI path: `settings inspect`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `settings.inspect`

```text
plvs-cli settings inspect <--json|--format text>
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `settings.update`

Update public settings.

- CLI path: `settings update`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `settings.update`
- Schema references: `agentControl.revision`, `settings.patch`

```text
plvs-cli settings update <file|-> --json --expected-revision <n> [--allow-measurement-restart] [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `file\|-` | `patch` | yes | string; ref settings.patch |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--allow-measurement-restart` | `allowMeasurementRestart` | no | boolean |
| `--dry-run` | `dryRun` | no | boolean |

## `device.list`

List audio capture devices.

- CLI path: `device list`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `device.list`

```text
plvs-cli device list <--json|--format text>
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `device.inspect`

Inspect audio device selection.

- CLI path: `device inspect`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `device.inspect`

```text
plvs-cli device inspect <--json|--format text>
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `device.select`

Select an audio capture device.

- CLI path: `device select`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `device.select`
- Schema references: `agentControl.revision`

```text
plvs-cli device select <device-id|default> --expected-revision <n> --expected-generation <n> --json [--allow-measurement-restart] [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `device-id\|default` | `deviceId` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--expected-generation` | `expectedGeneration` | yes | integer; 0 to inf |
| `--json` | local only | yes | boolean |
| `--allow-measurement-restart` | `allowMeasurementRestart` | no | boolean |
| `--dry-run` | `dryRun` | no | boolean |

## `app.wait`

Wait for a newer application revision.

- CLI path: `wait`
- Execution: `runningApp`; operation: `wait`
- JSON: `required`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `app.wait`

```text
plvs-cli wait --after-revision <n> [--timeout-ms <n>] --json
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--after-revision` | `afterRevision` | yes | integer; 0 to inf |
| `--timeout-ms` | `timeoutMs` | no | integer; 100 to 300000; default 30000 |
| `--json` | local only | yes | boolean |

## `transport.inspect`

Inspect transport state.

- CLI path: `transport inspect`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `transport.inspect`

```text
plvs-cli transport inspect <--json|--format text>
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `transport.source.live`

Switch transport to the live source.

- CLI path: `transport source live`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `transport.source.live`
- Schema references: `agentControl.revision`

```text
plvs-cli transport source live --json --expected-revision <n> [--allow-stop-file-analysis] [--dry-run]
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--allow-stop-file-analysis` | `allowStopFileAnalysis` | no | boolean |
| `--dry-run` | `dryRun` | no | boolean |

## `transport.source.file`

Switch transport to the file source.

- CLI path: `transport source file`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `transport.source.file`
- Schema references: `agentControl.revision`

```text
plvs-cli transport source file --json --expected-revision <n> [--allow-stop-file-analysis] [--dry-run]
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--allow-stop-file-analysis` | `allowStopFileAnalysis` | no | boolean |
| `--dry-run` | `dryRun` | no | boolean |

## `transport.live.start`

Start live measurement.

- CLI path: `transport live start`
- Execution: `runningApp`; operation: `action`
- JSON: `required`; expected revision: `required`; dry-run: `false`; output file: `none`
- Wire method: `transport.live.start`
- Schema references: `agentControl.revision`

```text
plvs-cli transport live start --json --expected-revision <n> [--allow-stop-file-analysis]
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--allow-stop-file-analysis` | `allowStopFileAnalysis` | no | boolean |

## `transport.live.stop`

Stop live measurement.

- CLI path: `transport live stop`
- Execution: `runningApp`; operation: `action`
- JSON: `required`; expected revision: `required`; dry-run: `false`; output file: `none`
- Wire method: `transport.live.stop`
- Schema references: `agentControl.revision`

```text
plvs-cli transport live stop --json --expected-revision <n> [--allow-stop-file-analysis]
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--allow-stop-file-analysis` | `allowStopFileAnalysis` | no | boolean |

## `transport.live.clear`

Clear live measurements.

- CLI path: `transport live clear`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `transport.live.clear`
- Schema references: `agentControl.revision`

```text
plvs-cli transport live clear --json --expected-revision <n> [--dry-run]
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--dry-run` | `dryRun` | no | boolean |

## `transport.file.analyze`

Start file analysis.

- CLI path: `transport file analyze`
- Execution: `runningApp`; operation: `action`
- JSON: `required`; expected revision: `required`; dry-run: `false`; output file: `none`
- Wire method: `transport.file.analyze`
- Schema references: `agentControl.revision`

```text
plvs-cli transport file analyze <path> --json --expected-revision <n>
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `path` | `path` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |

## `transport.file.reanalyze`

Reanalyze a file session.

- CLI path: `transport file reanalyze`
- Execution: `runningApp`; operation: `action`
- JSON: `required`; expected revision: `required`; dry-run: `false`; output file: `none`
- Wire method: `transport.file.reanalyze`
- Schema references: `agentControl.revision`

```text
plvs-cli transport file reanalyze <session-id> --json --expected-revision <n>
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `session-id` | `sessionId` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |

## `transport.file.stop`

Stop file analysis.

- CLI path: `transport file stop`
- Execution: `runningApp`; operation: `action`
- JSON: `required`; expected revision: `required`; dry-run: `false`; output file: `none`
- Wire method: `transport.file.stop`
- Schema references: `agentControl.revision`

```text
plvs-cli transport file stop <session-id> --json --expected-revision <n>
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `session-id` | `sessionId` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |

## `transport.file.select`

Select a file session.

- CLI path: `transport file select`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `transport.file.select`
- Schema references: `agentControl.revision`

```text
plvs-cli transport file select <session-id> --json --expected-revision <n> [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `session-id` | `sessionId` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--dry-run` | `dryRun` | no | boolean |

## `transport.file.remove`

Remove a file session.

- CLI path: `transport file remove`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `transport.file.remove`
- Schema references: `agentControl.revision`

```text
plvs-cli transport file remove <session-id> --json --expected-revision <n> [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `session-id` | `sessionId` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--dry-run` | `dryRun` | no | boolean |

## `transport.file.clear`

Clear file sessions.

- CLI path: `transport file clear`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `transport.file.clear`
- Schema references: `agentControl.revision`

```text
plvs-cli transport file clear --json --expected-revision <n> [--dry-run]
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--dry-run` | `dryRun` | no | boolean |

## `transport.file.report`

Export a completed file analysis report.

- CLI path: `transport file report`
- Execution: `runningApp`; operation: `query`
- JSON: `required`; expected revision: `none`; dry-run: `false`; output file: `optional`
- Wire method: `transport.file.report`

```text
plvs-cli transport file report <session-id> --json [--report-format <json|markdown>] [--out <file>]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `session-id` | `sessionId` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--report-format` | `reportFormat` | no | string; one of "json", "markdown" |
| `--out` | local only | no | string |

## `dock.describe`

Describe Dock controls.

- CLI path: `dock describe`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `dock.describe`

```text
plvs-cli dock describe <--json|--format text>
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `dock.inspect`

Inspect Dock state.

- CLI path: `dock inspect`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `dock.inspect`

```text
plvs-cli dock inspect <--json|--format text>
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `dock.enter`

Enter Dock mode.

- CLI path: `dock enter`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `dock.enter`
- Schema references: `agentControl.revision`

```text
plvs-cli dock enter [--edge top|bottom] [--monitor <id>] [--reserve-space true|false] [--height <n>] --json --expected-revision <n> [--dry-run]
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--edge` | `edge` | no | string; one of "top", "bottom" |
| `--monitor` | `monitor` | no | string |
| `--reserve-space` | `reserveSpace` | no | string; one of "true", "false" |
| `--height` | `height` | no | integer; 0 to inf |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--dry-run` | `dryRun` | no | boolean |

## `dock.exit`

Exit Dock mode.

- CLI path: `dock exit`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `dock.exit`
- Schema references: `agentControl.revision`

```text
plvs-cli dock exit --json --expected-revision <n> [--dry-run]
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--dry-run` | `dryRun` | no | boolean |

## `dock.layout.apply`

Apply a Dock strip layout.

- CLI path: `dock layout apply`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `dock.layout.apply`
- Schema references: `dock.layout`, `agentControl.revision`

```text
plvs-cli dock layout apply <file|-> --json --expected-revision <n> [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `file\|-` | `layout` | yes | string; ref dock.layout |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--dry-run` | `dryRun` | no | boolean |

## `dock.panel.describe`

Describe a Dock panel.

- CLI path: `dock panel describe`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `dock.panel.describe`

```text
plvs-cli dock panel describe <panel-id> <--json|--format text>
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `panel-id` | `panelId` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `dock.panel.update`

Update a Dock panel.

- CLI path: `dock panel update`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `dock.panel.update`
- Schema references: `agentControl.revision`, `dock.panel.patch`

```text
plvs-cli dock panel update <panel-id> <file|-> --json --expected-revision <n> [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `panel-id` | `panelId` | yes | string |
| `file\|-` | `patch` | yes | string; ref dock.panel.patch |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--dry-run` | `dryRun` | no | boolean |

## `dock.panel.reset`

Reset a Dock panel.

- CLI path: `dock panel reset`
- Execution: `runningApp`; operation: `mutation`
- JSON: `required`; expected revision: `required`; dry-run: `true`; output file: `none`
- Wire method: `dock.panel.reset`
- Schema references: `agentControl.revision`

```text
plvs-cli dock panel reset <panel-id> --json --expected-revision <n> [--dry-run]
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `panel-id` | `panelId` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |
| `--expected-revision` | `expectedRevision` | yes | integer; 0 to inf |
| `--dry-run` | `dryRun` | no | boolean |

## `visual.describe`

Describe Visual Capture availability.

- CLI path: `visual describe`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `visual.describe`
- Feature gate: `visual`

```text
plvs-cli visual describe <--json|--format text>
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `visual.screenshot`

Capture a PLVS surface screenshot.

- CLI path: `visual screenshot`
- Execution: `runningApp`; operation: `action`
- JSON: `required`; expected revision: `optional`; dry-run: `false`; output file: `required`
- Wire method: `visual.screenshot`
- Feature gate: `visual.screenshot`
- Schema references: `visual.target`, `agentControl.revision`

```text
plvs-cli visual screenshot --target <main|workspace|panel|dock-header|dock-editor> [--panel-id <panel-id>] [--expected-revision <n>] --out <file> --json
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--target` | `target.kind` | yes | string; one of "main", "workspace", "panel", "dock-header", "dock-editor" |
| `--panel-id` | `target.panelId` | no | string |
| `--expected-revision` | `expectedRevision` | no | integer; 0 to inf |
| `--out` | local only | yes | string |
| `--json` | local only | yes | boolean |

## `visual.recording.start`

Start one bounded PLVS surface recording.

- CLI path: `visual recording start`
- Execution: `runningApp`; operation: `action`
- JSON: `required`; expected revision: `optional`; dry-run: `false`; output file: `none`
- Wire method: `visual.recording.start`
- Feature gate: `visual.recording`
- Schema references: `visual.target`, `agentControl.revision`

```text
plvs-cli visual recording start --target <main|workspace> [--audio <none|measured-source>] [--cursor <none|visible>] [--fps <15|30|60>] [--max-duration-seconds <1..1800>] [--expected-revision <n>] --json
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--target` | `target.kind` | yes | string; one of "main", "workspace" |
| `--audio` | `audio` | no | string; one of "none", "measured-source" |
| `--cursor` | `cursor` | no | string; one of "none", "visible"; default "none" |
| `--fps` | `fps` | no | integer; one of 15, 30, 60; default 30 |
| `--max-duration-seconds` | `maxDurationSeconds` | no | integer; 1 to 1800; default 60 |
| `--expected-revision` | `expectedRevision` | no | integer; 0 to inf |
| `--json` | local only | yes | boolean |

## `visual.recording.inspect`

Inspect a Visual recording.

- CLI path: `visual recording inspect`
- Execution: `runningApp`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `none`
- Wire method: `visual.recording.inspect`
- Feature gate: `visual.recording`

```text
plvs-cli visual recording inspect <recording-id> <--json|--format text>
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `recording-id` | `recordingId` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--format` | local only | no | string; one of "text" |

## `visual.recording.wait`

Wait for a Visual recording to finish.

- CLI path: `visual recording wait`
- Execution: `runningApp`; operation: `wait`
- JSON: `required`; expected revision: `none`; dry-run: `false`; output file: `optional`
- Wire method: `visual.recording.wait`
- Feature gate: `visual.recording`

```text
plvs-cli visual recording wait <recording-id> [--timeout-ms <100..300000>] [--out <file>] --json
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `recording-id` | `recordingId` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--timeout-ms` | `timeoutMs` | no | integer; 100 to 300000; default 30000 |
| `--out` | local only | no | string |
| `--json` | local only | yes | boolean |

## `visual.recording.stop`

Stop a Visual recording.

- CLI path: `visual recording stop`
- Execution: `runningApp`; operation: `action`
- JSON: `required`; expected revision: `none`; dry-run: `false`; output file: `optional`
- Wire method: `visual.recording.stop`
- Feature gate: `visual.recording`

```text
plvs-cli visual recording stop <recording-id> [--out <file>] --json
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `recording-id` | `recordingId` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--out` | local only | no | string |
| `--json` | local only | yes | boolean |

## `doctor`

Run installed-runtime health checks without launching PLVS.

- CLI path: `doctor`
- Execution: `offline`; operation: `query`
- JSON: `optional`; expected revision: `none`; dry-run: `false`; output file: `optional`

```text
plvs-cli doctor [--json] [--out <file>]
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | no | boolean |
| `--out` | local only | no | string |

## `schema.list`

List the installed CLI command catalog.

- CLI path: `schema list`
- Execution: `offline`; operation: `query`
- JSON: `required`; expected revision: `none`; dry-run: `false`; output file: `none`

```text
plvs-cli schema list --json
```

### Positionals

None.

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |

## `schema.get`

Get the installed CLI schema for one command.

- CLI path: `schema get`
- Execution: `offline`; operation: `query`
- JSON: `required`; expected revision: `none`; dry-run: `false`; output file: `none`

```text
plvs-cli schema get <command-id> --json
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `command-id` | `commandId` | yes | string |

### Options

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `--json` | local only | yes | boolean |

## `completion`

Generate a shell completion script from the installed command catalog.

- CLI path: `completion`
- Execution: `offline`; operation: `query`
- JSON: `none`; expected revision: `none`; dry-run: `false`; output file: `none`

```text
plvs-cli completion <powershell|bash|zsh>
```

### Positionals

| Name | Maps to | Required | Value |
| --- | --- | --- | --- |
| `shell` | local only | yes | string; one of "powershell", "bash", "zsh" |

### Options

None.
