/**
 * @typedef {'peak' | 'loudness' | 'loudnessStats' | 'vectorscope' | 'spectrum' | 'spectrogram'} ModuleId
 *
 * @typedef {{ type: 'leaf', tabs: ModuleId[], activeTab: ModuleId }} LeafNode
 *
 * @typedef {{ type: 'split', direction: 'h' | 'v', children: TreeNode[], sizes: (number | null)[] }} SplitNode
 *
 * @typedef {SplitNode | LeafNode} TreeNode
 *
 * @typedef {{
 *   tree: TreeNode,
 *   visibleModules: ModuleId[],
 *   focusId: ModuleId | null,
 *   activePresetId: string | null,
 *   fullscreenId: ModuleId | null,
 *   customPresets: Preset[],
 * }} WorkspaceState
 *
 * @typedef {{
 *   id: string,
 *   name: string,
 *   builtin: boolean,
 *   tree: TreeNode,
 *   visibleModules: ModuleId[],
 * }} Preset
 *
 * @typedef {{
 *   targetPath: number[],
 *   zone: 'tabs' | 'above' | 'below' | 'left' | 'right',
 *   tabIndex?: number,
 * }} DropTarget
 */
export {};
