/**
 * @typedef {'levelMeter' | 'loudness' | 'stats' | 'vectorscope' | 'spectrum' | 'spectrogram' | 'waveform'} ModuleId
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
 * @typedef {{
 *   vectorscopePair: { x: number, y: number },
 *   vectorscopeMode: 'lissajous' | 'polarSample' | 'polarLevel',
 *   vectorscopePolarLevelPeakHold: boolean,
 *   spectrumChannel: { type: 'pair', x: number, y: number } | { type: 'single', ch: number },
 *   spectrumView: string,
 *   spectrumMaxHold: boolean,
 *   levelMeterMode: string,
 *   levelMeterPlaybackMax: boolean,
 *   levelMeterValueMarker: boolean,
 *   levelMeterTpMaxMarker: boolean,
 *   statsVisibleIds: string[],
 *   statsOrder: string[],
 *   loudnessHistoryVisibleLayerIds: string[],
 * }} PanelControls
 *
 * @typedef {{
 *   tree: TreeNode,
 *   panelsById: Record<PanelId, PanelInstance>,
 *   panelOrder: PanelId[],
 *   fullscreenId: PanelId | null,
 *   panelControlsById: Record<PanelId, PanelControls>,
 *   pinnedPanelsById: Record<PanelId, PinnedPanelSize>,
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
 * @typedef {{
 *   targetPath: number[],
 *   zone: 'tabs' | 'above' | 'below' | 'left' | 'right',
 *   tabIndex?: number,
 * }} DropTarget
 */
export {};
