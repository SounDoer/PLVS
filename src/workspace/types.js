/**
 * @typedef {'levelMeter' | 'loudness' | 'stats' | 'vectorscope' | 'spectrum' | 'spectrogram' | 'waveform' | 'stereo-map'} ModuleId
 * @typedef {string} PanelId
 * @typedef {{
 *   id: PanelId,
 *   moduleId: ModuleId,
 *   customTitle?: string,
 *   config?: object,
 * }} PanelInstance
 *
 * @typedef {{ width: number, height: number }} PinnedPanelSize
 *
 * @typedef {{ type: 'leaf', tabs: PanelId[], activeTab: PanelId }} LeafNode
 *
 * @typedef {{ type: 'split', direction: 'h' | 'v', children: TreeNode[], sizes: (number | null)[] }} SplitNode
 *
 * @typedef {SplitNode | LeafNode} TreeNode
 *
 * A node read without first checking which kind it is: every field of both kinds, all optional.
 * For code that walks to a node at a known path, where naming the kind at each step would only
 * restate the path -- tests asserting on a result tree, mostly. Product code narrows on `type`.
 *
 * @typedef {{
 *   type: "leaf" | "split",
 *   tabs?: PanelId[],
 *   activeTab?: PanelId,
 *   direction?: "h" | "v",
 *   children?: AnyTreeNode[],
 *   sizes?: (number | null)[],
 * }} AnyTreeNode
 *
 * One flat record shared by every module; `src/lib/panelControls.js` owns the defaults and the
 * repair rule of each key, and its table is what this has to stay in step with.
 *
 * @typedef {{
 *   levelMeterMode: string,
 *   levelMeterPlaybackMax: boolean,
 *   levelMeterValueMarker: boolean,
 *   levelMeterTpMaxMarker: boolean,
 *   levelMeterBarColors: string,
 *   vectorscopePair: { x: number, y: number },
 *   vectorscopeMode: 'lissajous' | 'polarSample' | 'polarLevel',
 *   vectorscopePolarSamplePersistenceMs: number,
 *   vectorscopePolarLevelMaxHold: boolean,
 *   spectrumChannel: { type: 'pair', x: number, y: number } | { type: 'single', ch: number },
 *   spectrumView: "combined"|"lr"|"ms",
 *   spectrumMaxMode: "off"|"decay"|"hold",
 *   spectrumPeakLabels: boolean,
 *   spectrumSpeedPercent: number,
 *   spectrumTiltDbPerOctave: number,
 *   spectrumOctaveSmoothing: string,
 *   spectrumXMinFreq: number,
 *   spectrumXMaxFreq: number,
 *   spectrumYMinDb: number,
 *   spectrumYMaxDb: number,
 *   spectrogramYMinFreq: number,
 *   spectrogramYMaxFreq: number,
 *   spectrogramDbFloor: number,
 *   spectrogramMode: string,
 *   spectrogram3dColorize: boolean,
 *   spectrogram3dHeightGain: number,
 *   spectrogram3dAzimuthDeg: number,
 *   spectrogram3dElevationDeg: number,
 *   spectrogram3dFloor: boolean,
 *   loudnessYMinDb: number,
 *   loudnessYMaxDb: number,
 *   levelMeterPeakWarningDb: number,
 *   levelMeterPeakCriticalDb: number,
 *   levelMeterRmsWarningDb: number,
 *   levelMeterRmsCriticalDb: number,
 *   levelMeterYMinDb: number,
 *   levelMeterYMaxDb: number,
 *   statsVisibleIds: string[],
 *   statsOrder: string[],
 *   loudnessHistoryVisibleLayerIds: string[],
 *   loudnessGrid: boolean,
 *   spectrumGrid: boolean,
 *   stereoMapMode: 'position' | 'correlation' | 'monoLossDb' | 'msRatioDb',
 *   stereoMapGrid: boolean,
 *   stereoMapPair: { x: number, y: number },
 *   stereoMapHold: boolean,
 *   stereoMapSpeedPercent: number,
 *   stereoMapOctaveSmoothing: string,
 *   stereoMapEnergyFadePercent: number,
 *   stereoMapColorBlendPercent: number,
 *   stereoMapXMinFreq: number,
 *   stereoMapXMaxFreq: number,
 *   stereoMapMonoLossYMinDb: number,
 *   stereoMapMsRatioYMinDb: number,
 *   stereoMapMsRatioYMaxDb: number,
 *   waveformFrequencyColor: boolean,
 *   waveformLowMidSplitHz: number,
 *   waveformMidHighSplitHz: number,
 *   waveformCentroid: boolean,
 *   historyWindowSec: number,
 *   historyOffsetSec: number,
 *   linkFrequencyViewport: boolean,
 *   linkTimeViewport: boolean,
 * }} PanelControls
 *
 * The shared viewport of each linkable axis kind; `axisViewports.js` owns the list of kinds.
 *
 * @typedef {{
 *   frequency: { min: number, max: number },
 *   time: { windowSec: number, offsetSec: number },
 * }} AxisViewports
 *
 * `panelControls` is the single shared record from before each panel had its own; nothing writes
 * it any more, but the readers still fall back to it for a panel with no record of its own.
 *
 * @typedef {{
 *   tree: TreeNode,
 *   panelsById: Record<PanelId, PanelInstance>,
 *   panelOrder: PanelId[],
 *   fullscreenId: PanelId | null,
 *   panelControlsById: Record<PanelId, PanelControls>,
 *   panelControls?: PanelControls,
 *   pinnedPanelsById: Record<PanelId, PinnedPanelSize>,
 *   axisViewports: AxisViewports,
 * }} WorkspaceState
 *
 * @typedef {{
 *   id: string,
 *   name: string,
 *   windowBounds?: { x: number, y: number, width: number, height: number, isMaximized: boolean },
 *   tree: TreeNode,
 *   panelsById: Record<PanelId, PanelInstance>,
 *   panelOrder: PanelId[],
 *   panelControlsById: Record<PanelId, PanelControls>,
 *   pinnedPanelsById?: Record<PanelId, PinnedPanelSize>,
 *   axisViewports?: AxisViewports,
 *   dock?: {
 *     enabled: boolean,
 *     edge: 'top' | 'bottom',
 *     reserveSpace?: boolean,
 *     panelsById?: Record<PanelId, PanelInstance>,
 *     panelOrder?: PanelId[],
 *     controlsByPanelId?: Record<PanelId, object>,
 *     modules: string[],
 *     controlsByModuleId?: Record<string, object>,
 *   },
 * }} Preset
 *
 * The Dock as a scene describes it: whether the strip is up, where it sits and what is on it.
 * A preset stores one, and `usePresets` reads the live one to take a snapshot.
 *
 * @typedef {{
 *   enabled: boolean,
 *   edge: string,
 *   monitor?: string | null,
 *   reserveSpace?: boolean,
 *   height?: number,
 *   panelsById?: Record<PanelId, PanelInstance>,
 *   panelOrder?: PanelId[],
 *   panelSizesById?: Record<PanelId, any>,
 *   controlsByPanelId?: Record<PanelId, object>,
 * }} DockScene
 *
 * What Agent Control is told about the Dock: the scene, plus whether this platform has a Dock at
 * all and whether it is currently suspended.
 *
 * @typedef {DockScene & { supported?: boolean, suspended?: boolean }} AgentControlDock
 *
 * @typedef {{
 *   targetPath: number[],
 *   zone: 'tabs' | 'above' | 'below' | 'left' | 'right',
 *   tabIndex?: number,
 * }} DropTarget
 */
export {};
