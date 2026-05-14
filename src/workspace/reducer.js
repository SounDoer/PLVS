/** @import { WorkspaceState, DockState, ModuleId, RegionKey, DropTarget, Slot } from './types.js' */
import { BUILTIN_PRESETS, DEFAULT_REGION_SIZES, DEFAULT_WORKSPACE_STATE } from './constants.js';

// ---------------------------------------------------------------------------
// Pure dock helpers
// ---------------------------------------------------------------------------

/** Returns { regionKey, slotIndex } or null. */
function findTabLocation(dock, tabId) {
  for (const [regionKey, region] of Object.entries(dock.regions)) {
    const slotIndex = region.slots.findIndex((s) => s.tabs.includes(tabId));
    if (slotIndex !== -1) return { regionKey, slotIndex };
  }
  return null;
}

/**
 * Remove tabId from wherever it lives in dock.
 * Empty slots are automatically pruned.
 * @returns {DockState}
 */
export function removeTabFromDock(dock, tabId) {
  const regions = {};
  for (const [key, region] of Object.entries(dock.regions)) {
    const slots = region.slots
      .map((slot) => {
        if (!slot.tabs.includes(tabId)) return slot;
        const tabs = slot.tabs.filter((t) => t !== tabId);
        if (!tabs.length) return null;
        const activeTab = tabs.includes(slot.activeTab) ? slot.activeTab : tabs[0];
        return { ...slot, tabs, activeTab };
      })
      .filter(Boolean);
    regions[key] = { ...region, slots };
  }
  return { regions };
}

/**
 * Insert tabId into dock according to drop target.
 * @param {DockState} dock
 * @param {ModuleId} tabId
 * @param {DropTarget & { adjustedSlotIndex: number }} drop
 * @returns {DockState}
 */
function insertTabAt(dock, tabId, drop) {
  const { targetRegion, adjustedSlotIndex, zone, tabIndex = 0 } = drop;
  const regions = { ...dock.regions };
  const region = { ...regions[targetRegion], slots: [...regions[targetRegion].slots] };

  if (zone === 'tabs') {
    const slot = { ...region.slots[adjustedSlotIndex] };
    const tabs = [...slot.tabs];
    tabs.splice(tabIndex, 0, tabId);
    region.slots[adjustedSlotIndex] = { ...slot, tabs, activeTab: tabId };
  } else if (zone === 'above') {
    const newSlot = { tabs: [tabId], activeTab: tabId, collapsed: false };
    region.slots.splice(adjustedSlotIndex, 0, newSlot);
  } else if (zone === 'below') {
    const newSlot = { tabs: [tabId], activeTab: tabId, collapsed: false };
    region.slots.splice(adjustedSlotIndex + 1, 0, newSlot);
  } else if (zone === 'empty-region') {
    const newSlot = { tabs: [tabId], activeTab: tabId, collapsed: false };
    region.slots = [...region.slots, newSlot];
    if (!region.size || region.size === 0) {
      region.size = DEFAULT_REGION_SIZES[targetRegion] ?? 200;
    }
  }

  regions[targetRegion] = region;
  return { regions };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/**
 * @param {WorkspaceState} state
 * @param {{ type: string, payload?: any }} action
 * @returns {WorkspaceState}
 */
export function workspaceReducer(state, action) {
  switch (action.type) {
    case 'SET_DOCK_STATE':
      return { ...state, dock: action.payload, activePresetId: null };

    case 'MOVE_TAB': {
      const { sourceId, drop } = action.payload;
      const sourceLocation = findTabLocation(state.dock, sourceId);

      // Track whether the source slot will be entirely removed (was a single-tab slot)
      const sourceSlotTabCount = sourceLocation
        ? state.dock.regions[sourceLocation.regionKey].slots[sourceLocation.slotIndex].tabs.length
        : 0;
      const sourceSlotRemoved = sourceSlotTabCount === 1;

      const dockAfterRemove = removeTabFromDock(state.dock, sourceId);

      // Adjust slotIndex: if source slot was removed from the same region and was before target
      let adjustedSlotIndex = drop.slotIndex;
      if (
        drop.zone !== 'empty-region' &&
        sourceLocation &&
        sourceSlotRemoved &&
        sourceLocation.regionKey === drop.targetRegion &&
        sourceLocation.slotIndex < drop.slotIndex
      ) {
        adjustedSlotIndex -= 1;
      }

      const newDock = insertTabAt(dockAfterRemove, sourceId, { ...drop, adjustedSlotIndex });
      return { ...state, dock: newDock, activePresetId: null };
    }

    case 'SET_ACTIVE_TAB': {
      const { region, slotIndex, tabId } = action.payload;
      const slots = [...state.dock.regions[region].slots];
      slots[slotIndex] = { ...slots[slotIndex], activeTab: tabId };
      return {
        ...state,
        dock: {
          regions: {
            ...state.dock.regions,
            [region]: { ...state.dock.regions[region], slots },
          },
        },
      };
    }

    case 'TOGGLE_SLOT_COLLAPSED': {
      const { region, slotIndex } = action.payload;
      const slots = [...state.dock.regions[region].slots];
      slots[slotIndex] = { ...slots[slotIndex], collapsed: !slots[slotIndex].collapsed };
      return {
        ...state,
        dock: {
          regions: {
            ...state.dock.regions,
            [region]: { ...state.dock.regions[region], slots },
          },
        },
      };
    }

    case 'TOGGLE_MODULE_VISIBLE': {
      const { id } = action.payload;
      const isVisible = state.visibleModules.includes(id);
      const visibleModules = isVisible
        ? state.visibleModules.filter((m) => m !== id)
        : [...state.visibleModules, id];
      // When re-showing, auto-expand its slot if collapsed
      let dock = state.dock;
      if (!isVisible) {
        const loc = findTabLocation(dock, id);
        if (loc) {
          const slot = dock.regions[loc.regionKey].slots[loc.slotIndex];
          if (slot.collapsed) {
            const slots = [...dock.regions[loc.regionKey].slots];
            slots[loc.slotIndex] = { ...slot, collapsed: false };
            dock = {
              regions: {
                ...dock.regions,
                [loc.regionKey]: { ...dock.regions[loc.regionKey], slots },
              },
            };
          }
        }
      }
      const focusId = !isVisible ? id : state.focusId === id ? null : state.focusId;
      return { ...state, dock, visibleModules, focusId };
    }

    case 'SET_FOCUS': {
      const { id } = action.payload;
      // When focusing, ensure module's tab is active in its slot
      const loc = findTabLocation(state.dock, id);
      let dock = state.dock;
      if (loc) {
        const slot = state.dock.regions[loc.regionKey].slots[loc.slotIndex];
        if (slot.activeTab !== id || slot.collapsed) {
          const slots = [...state.dock.regions[loc.regionKey].slots];
          slots[loc.slotIndex] = { ...slot, activeTab: id, collapsed: false };
          dock = {
            regions: {
              ...state.dock.regions,
              [loc.regionKey]: { ...state.dock.regions[loc.regionKey], slots },
            },
          };
        }
      }
      return { ...state, dock, focusId: id };
    }

    case 'SET_FULLSCREEN':
      return { ...state, fullscreenId: action.payload };

    case 'SET_SLOT_SIZE': {
      const { region, slotIndex, size } = action.payload;
      const slots = [...state.dock.regions[region].slots];
      slots[slotIndex] = { ...slots[slotIndex], size };
      return {
        ...state,
        dock: {
          regions: {
            ...state.dock.regions,
            [region]: { ...state.dock.regions[region], slots },
          },
        },
      };
    }

    case 'SET_REGION_SIZE': {
      const { region, size } = action.payload;
      return {
        ...state,
        dock: {
          regions: {
            ...state.dock.regions,
            [region]: { ...state.dock.regions[region], size },
          },
        },
        activePresetId: null,
      };
    }

    case 'APPLY_PRESET': {
      const { presetId } = action.payload;
      const preset =
        BUILTIN_PRESETS.find((p) => p.id === presetId) ||
        state.customPresets.find((p) => p.id === presetId);
      if (!preset) return state;
      return {
        ...state,
        dock: preset.dock,
        visibleModules: preset.visibleModules,
        activePresetId: presetId,
        fullscreenId: null,
      };
    }

    case 'SAVE_PRESET': {
      const { name } = action.payload;
      const id = `custom-${Date.now()}`;
      const newPreset = {
        id,
        name,
        builtin: false,
        dock: state.dock,
        visibleModules: state.visibleModules,
      };
      return {
        ...state,
        customPresets: [...state.customPresets, newPreset],
        activePresetId: id,
      };
    }

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Bound action creators (dispatch-bound)
// ---------------------------------------------------------------------------

/** @param {React.Dispatch} dispatch */
export function bindWorkspaceActions(dispatch) {
  return {
    setDockState: (dock) => dispatch({ type: 'SET_DOCK_STATE', payload: dock }),
    moveTab: (sourceId, drop) => dispatch({ type: 'MOVE_TAB', payload: { sourceId, drop } }),
    setActiveTab: (region, slotIndex, tabId) =>
      dispatch({ type: 'SET_ACTIVE_TAB', payload: { region, slotIndex, tabId } }),
    toggleSlotCollapsed: (region, slotIndex) =>
      dispatch({ type: 'TOGGLE_SLOT_COLLAPSED', payload: { region, slotIndex } }),
    toggleModuleVisible: (id) => dispatch({ type: 'TOGGLE_MODULE_VISIBLE', payload: { id } }),
    setFocus: (id) => dispatch({ type: 'SET_FOCUS', payload: { id } }),
    setFullscreen: (id) => dispatch({ type: 'SET_FULLSCREEN', payload: id }),
    setRegionSize: (region, size) =>
      dispatch({ type: 'SET_REGION_SIZE', payload: { region, size } }),
    setSlotSize: (region, slotIndex, size) =>
      dispatch({ type: 'SET_SLOT_SIZE', payload: { region, slotIndex, size } }),
    applyPreset: (presetId) => dispatch({ type: 'APPLY_PRESET', payload: { presetId } }),
    saveCurrentAsPreset: (name) => dispatch({ type: 'SAVE_PRESET', payload: { name } }),
  };
}
