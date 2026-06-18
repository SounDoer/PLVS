/**
 * @typedef {'peak' | 'loudness' | 'loudnessStats' | 'vectorscope' | 'spectrum' | 'spectrogram' | 'waveform'} ModuleId
 *
 * @typedef {{ type: 'leaf', tabs: ModuleId[], activeTab: ModuleId }} LeafNode
 *
 * @typedef {{ type: 'split', direction: 'h' | 'v', children: TreeNode[], sizes: (number | null)[] }} SplitNode
 *
 * @typedef {SplitNode | LeafNode} TreeNode
 *
 * @typedef {{
 *   vectorscopePair: { x: number, y: number },
 *   spectrumChannel: { type: 'pair', x: number, y: number } | { type: 'single', ch: number },
 *   loudnessStatsVisibleIds: string[],
 *   loudnessHistoryVisibleLayerIds: string[],
 * }} PanelControls
 *
 * @typedef {{
 *   tree: TreeNode,
 *   visibleModules: ModuleId[],
 *   fullscreenId: ModuleId | null,
 *   panelControls: PanelControls,
 * }} WorkspaceState
 *
 * @typedef {{
 *   id: string,
 *   name: string,
 *   windowBounds?: { x: number, y: number, width: number, height: number, isMaximized: boolean },
 *   tree: TreeNode,
 *   visibleModules: ModuleId[],
 *   panelControls: PanelControls,
 * }} Preset
 *
 * @typedef {{
 *   targetPath: number[],
 *   zone: 'tabs' | 'above' | 'below' | 'left' | 'right',
 *   tabIndex?: number,
 * }} DropTarget
 */
export {};
