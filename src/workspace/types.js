/**
 * @typedef {'peak' | 'loudness' | 'loudnessStats' | 'vectorscope' | 'spectrum' | 'spectrogram'} ModuleId
 * @typedef {'left' | 'center' | 'right' | 'bottom'} RegionKey
 *
 * @typedef {{ tabs: ModuleId[], activeTab: ModuleId, collapsed: boolean }} Slot
 *
 * @typedef {{
 *   size?: number,
 *   slots: Slot[],
 * }} Region
 *
 * @typedef {{ regions: Record<RegionKey, Region> }} DockState
 *
 * @typedef {{
 *   dock: DockState,
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
 *   dock: DockState,
 *   visibleModules: ModuleId[],
 * }} Preset
 *
 * @typedef {{
 *   targetRegion: RegionKey,
 *   slotIndex: number,
 *   zone: 'tabs' | 'above' | 'below' | 'empty-region',
 *   tabIndex?: number,
 * }} DropTarget
 */
export {};
