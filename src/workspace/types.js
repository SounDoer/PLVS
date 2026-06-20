/**
 * @typedef {'peak' | 'loudness' | 'loudnessStats' | 'vectorscope' | 'spectrum' | 'spectrogram' | 'waveform'} ModuleId
 * @typedef {string} PanelId
 * @typedef {{
 *   id: PanelId,
 *   moduleId: ModuleId,
 *   customTitle?: string,
 *   config?: object,
 * }} PanelInstance
 *
 * @typedef {{ type: 'leaf', tabs: PanelId[], activeTab: PanelId }} LeafNode
 *
 * @typedef {{ type: 'split', direction: 'h' | 'v', children: TreeNode[], sizes: (number | null)[] }} SplitNode
 *
 * @typedef {SplitNode | LeafNode} TreeNode
 *
 * @typedef {{
 *   vectorscopePair: { x: number, y: number },
 *   spectrumChannel: { type: 'pair', x: number, y: number } | { type: 'single', ch: number },
 *   spectrumView: string,
 *   spectrumPeakHold: boolean,
 *   levelMeterMode: string,
 *   loudnessStatsVisibleIds: string[],
 *   loudnessStatsOrder: string[],
 *   loudnessHistoryVisibleLayerIds: string[],
 * }} PanelControls
 *
 * @typedef {{
 *   tree: TreeNode,
 *   panelsById: Record<PanelId, PanelInstance>,
 *   panelOrder: PanelId[],
 *   fullscreenId: PanelId | null,
 *   panelControlsById: Record<PanelId, PanelControls>,
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
 * }} Preset
 *
 * @typedef {{
 *   targetPath: number[],
 *   zone: 'tabs' | 'above' | 'below' | 'left' | 'right',
 *   tabIndex?: number,
 * }} DropTarget
 */
export {};
