<!-- Generated from the App Control schema builders by src/agentControl/publicSurfaceDocs.test.js.
     Do not edit by hand; run `npm run docs:agent-control` after changing the public surface. -->

# Axis Control — Public Ranges

One entry per linkable axis kind. `modules` lists the panels that participate in the kind.

Time bounds are reported against the history a session has actually accumulated. The maxima
below are the empty-history floor, which is why the offset maximum reads 0 here.

## `frequency`

Logarithmic frequency viewport shared by participating panels. Modules: `spectrum`, `spectrogram`, `stereo-map`.

Default: `{"minHz":20,"maxHz":20000}`. Patched atomically (`replace`).

| Field | Type | Unit | Default | Allowed | In the default state |
| --- | --- | --- | --- | --- | --- |
| `minHz` | number | Hz | - | 20 to 20000 | - |
| `maxHz` | number | Hz | - | 20 to 20000 | - |

## `time`

History viewport shared by participating panels. Modules: `loudness`, `spectrogram`, `waveform`.

Default: `{"windowSec":60,"offsetSec":0}`. Patched atomically (`replace`).

| Field | Type | Unit | Default | Allowed | In the default state |
| --- | --- | --- | --- | --- | --- |
| `windowSec` | number | s | - | 5 to 60 | - |
| `offsetSec` | number | s | - | 0 to 0 | - |
