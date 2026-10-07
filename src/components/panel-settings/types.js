/**
 * @typedef {Object} PanelSettingsProps
 * @property {string} [activeTab]
 * @property {number} [channelCount]
 * @property {any[]} [vectorscopeOptions]
 * @property {any[]} [spectrumOptions]
 * @property {string} [spectrumValueKey]
 * @property {string} [spectrumDisplayLabel]
 * @property {(...args: any[]) => any} [onSpectrumChange]
 * @property {string} [spectrumView]
 * @property {ReturnType<typeof import("../../math/spectrumChannelViewOptions.js").spectrumViewLegend> | null} [spectrumViewLegend]
 * @property {(...args: any[]) => any} [onSpectrumViewChange]
 * @property {string} [spectrumMaxMode]
 * @property {(...args: any[]) => any} [onSpectrumMaxModeChange]
 * @property {any[]} [stereoMapPairOptions]
 * @property {string} [stereoMapPairValueKey]
 * @property {string} [stereoMapPairDisplayLabel]
 * @property {(...args: any[]) => any} [onStereoMapPairChange]
 * @property {Partial<import("@/workspace/types.js").PanelControls>} [panelControls]
 * @property {(...args: any[]) => any} [onPanelControlsChange]
 */

export {};
