import { describe, it, expect } from 'vitest';
import { removeTabFromDock, workspaceReducer } from './reducer.js';
import { DEFAULT_WORKSPACE_STATE } from './constants.js';

// ---------------------------------------------------------------------------
// Minimal dock builders
// ---------------------------------------------------------------------------

/** One-slot dock with specified tabs in a region. */
function dock1(region, tabs, activeTab = tabs[0]) {
  const base = {
    regions: {
      left: { size: 220, slots: [] },
      center: { slots: [] },
      right: { size: 260, slots: [] },
      bottom: { size: 0, slots: [] },
    },
  };
  base.regions[region] = {
    size: region !== 'center' ? 220 : undefined,
    slots: [{ tabs, activeTab, collapsed: false }],
  };
  return base;
}

/** State helper wrapping a dock in DEFAULT_WORKSPACE_STATE shape. */
function state(dock, extra = {}) {
  return { ...DEFAULT_WORKSPACE_STATE, dock, ...extra };
}

// ---------------------------------------------------------------------------
// 1. removeTabFromDock — removes tab from slot
// ---------------------------------------------------------------------------

describe('removeTabFromDock: removes tab', () => {
  it('removes the only tab → slot is pruned', () => {
    const dock = dock1('left', ['peak']);
    const result = removeTabFromDock(dock, 'peak');
    expect(result.regions.left.slots).toHaveLength(0);
  });

  it('removes one of two tabs → slot remains with the other tab', () => {
    const dock = dock1('center', ['loudness', 'spectrum'], 'loudness');
    const result = removeTabFromDock(dock, 'spectrum');
    expect(result.regions.center.slots[0].tabs).toEqual(['loudness']);
  });

  it('does not touch other regions', () => {
    const dock = dock1('left', ['peak']);
    dock.regions.center.slots.push({ tabs: ['loudness'], activeTab: 'loudness', collapsed: false });
    const result = removeTabFromDock(dock, 'peak');
    expect(result.regions.center.slots).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. removeTabFromDock — updates activeTab when active tab is removed
// ---------------------------------------------------------------------------

describe('removeTabFromDock: activeTab repair', () => {
  it('falls back to first remaining tab when active tab is removed', () => {
    const dock = dock1('center', ['loudness', 'spectrum', 'spectrogram'], 'spectrum');
    const result = removeTabFromDock(dock, 'spectrum');
    // 'spectrum' was active; should fall back to first remaining tab
    expect(result.regions.center.slots[0].activeTab).toBe('loudness');
  });

  it('keeps activeTab unchanged when a non-active tab is removed', () => {
    const dock = dock1('center', ['loudness', 'spectrum'], 'loudness');
    const result = removeTabFromDock(dock, 'spectrum');
    expect(result.regions.center.slots[0].activeTab).toBe('loudness');
  });
});

// ---------------------------------------------------------------------------
// 3. MOVE_TAB — moves tab to another region
// ---------------------------------------------------------------------------

describe('MOVE_TAB: cross-region move', () => {
  it('tab appears in target region after move', () => {
    const d = dock1('left', ['peak']);
    d.regions.center.slots.push({ tabs: ['loudness'], activeTab: 'loudness', collapsed: false });
    const s = state(d, { visibleModules: ['peak', 'loudness'] });

    const next = workspaceReducer(s, {
      type: 'MOVE_TAB',
      payload: {
        sourceId: 'peak',
        drop: { targetRegion: 'center', slotIndex: 0, zone: 'tabs', tabIndex: 0 },
      },
    });

    expect(next.dock.regions.center.slots[0].tabs).toContain('peak');
    expect(next.dock.regions.left.slots).toHaveLength(0);
  });

  it('activeTab in target slot is set to the moved tab', () => {
    const d = dock1('left', ['peak']);
    d.regions.center.slots.push({ tabs: ['loudness'], activeTab: 'loudness', collapsed: false });
    const s = state(d, { visibleModules: ['peak', 'loudness'] });

    const next = workspaceReducer(s, {
      type: 'MOVE_TAB',
      payload: {
        sourceId: 'peak',
        drop: { targetRegion: 'center', slotIndex: 0, zone: 'tabs', tabIndex: 1 },
      },
    });

    expect(next.dock.regions.center.slots[0].activeTab).toBe('peak');
  });
});

// ---------------------------------------------------------------------------
// 4. MOVE_TAB — slot index adjustment when source slot is pruned same region
// ---------------------------------------------------------------------------

describe('MOVE_TAB: same-region slot index adjustment', () => {
  it('adjusts target slotIndex when earlier source slot is pruned', () => {
    // Two slots in center: [0] = peak (single tab), [1] = loudness
    const d = {
      regions: {
        left: { size: 220, slots: [] },
        center: {
          slots: [
            { tabs: ['peak'], activeTab: 'peak', collapsed: false },
            { tabs: ['loudness'], activeTab: 'loudness', collapsed: false },
          ],
        },
        right: { size: 260, slots: [] },
        bottom: { size: 0, slots: [] },
      },
    };
    const s = state(d, { visibleModules: ['peak', 'loudness'] });

    // Drag 'peak' from slot[0] → below slot[1] (zone=below, slotIndex=1)
    // After source slot[0] is removed, slot[1] becomes slot[0]
    // So the new slot should be inserted at index 1 (below the adjusted slot[0])
    const next = workspaceReducer(s, {
      type: 'MOVE_TAB',
      payload: {
        sourceId: 'peak',
        drop: { targetRegion: 'center', slotIndex: 1, zone: 'below' },
      },
    });

    const slots = next.dock.regions.center.slots;
    // Expected: [loudness] | [peak]
    expect(slots[0].tabs).toEqual(['loudness']);
    expect(slots[1].tabs).toEqual(['peak']);
  });
});

// ---------------------------------------------------------------------------
// 5. insertTabAt — zone=above and zone=below create new slots
// ---------------------------------------------------------------------------

describe('insertTabAt via MOVE_TAB: above/below zones', () => {
  it('zone=above inserts new slot before target', () => {
    const d = dock1('center', ['loudness']);
    d.regions.left.slots.push({ tabs: ['peak'], activeTab: 'peak', collapsed: false });
    const s = state(d, { visibleModules: ['peak', 'loudness'] });

    const next = workspaceReducer(s, {
      type: 'MOVE_TAB',
      payload: {
        sourceId: 'peak',
        drop: { targetRegion: 'center', slotIndex: 0, zone: 'above' },
      },
    });

    const slots = next.dock.regions.center.slots;
    expect(slots).toHaveLength(2);
    expect(slots[0].tabs).toEqual(['peak']); // inserted above
    expect(slots[1].tabs).toEqual(['loudness']);
  });

  it('zone=below inserts new slot after target', () => {
    const d = dock1('center', ['loudness']);
    d.regions.left.slots.push({ tabs: ['peak'], activeTab: 'peak', collapsed: false });
    const s = state(d, { visibleModules: ['peak', 'loudness'] });

    const next = workspaceReducer(s, {
      type: 'MOVE_TAB',
      payload: {
        sourceId: 'peak',
        drop: { targetRegion: 'center', slotIndex: 0, zone: 'below' },
      },
    });

    const slots = next.dock.regions.center.slots;
    expect(slots).toHaveLength(2);
    expect(slots[0].tabs).toEqual(['loudness']);
    expect(slots[1].tabs).toEqual(['peak']); // inserted below
  });
});

// ---------------------------------------------------------------------------
// 6. insertTabAt — zone=empty-region restores default region size
// ---------------------------------------------------------------------------

describe('insertTabAt via MOVE_TAB: empty-region zone', () => {
  it('dropping into empty region creates a slot and restores default size', () => {
    // bottom region is empty (size=0)
    const d = dock1('center', ['loudness']);
    const s = state(d, { visibleModules: ['loudness'] });

    const next = workspaceReducer(s, {
      type: 'MOVE_TAB',
      payload: {
        sourceId: 'loudness',
        drop: { targetRegion: 'bottom', slotIndex: 0, zone: 'empty-region' },
      },
    });

    expect(next.dock.regions.bottom.slots).toHaveLength(1);
    expect(next.dock.regions.bottom.slots[0].tabs).toContain('loudness');
    expect(next.dock.regions.bottom.size).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 7. TOGGLE_MODULE_VISIBLE — hide/show
// ---------------------------------------------------------------------------

describe('TOGGLE_MODULE_VISIBLE', () => {
  it('hides a visible module by removing it from visibleModules', () => {
    const s = { ...DEFAULT_WORKSPACE_STATE };
    const next = workspaceReducer(s, {
      type: 'TOGGLE_MODULE_VISIBLE',
      payload: { id: 'peak' },
    });
    expect(next.visibleModules).not.toContain('peak');
  });

  it('shows a hidden module by adding it to visibleModules', () => {
    const s = { ...DEFAULT_WORKSPACE_STATE, visibleModules: ['loudness'] };
    const next = workspaceReducer(s, {
      type: 'TOGGLE_MODULE_VISIBLE',
      payload: { id: 'peak' },
    });
    expect(next.visibleModules).toContain('peak');
  });

  it('clears focusId when hiding the focused module', () => {
    const s = { ...DEFAULT_WORKSPACE_STATE, focusId: 'peak' };
    const next = workspaceReducer(s, {
      type: 'TOGGLE_MODULE_VISIBLE',
      payload: { id: 'peak' },
    });
    expect(next.focusId).toBeNull();
  });

  it('auto-expands collapsed slot when re-showing a module', () => {
    // Build dock with peak in a collapsed slot
    const d = dock1('left', ['peak']);
    d.regions.left.slots[0].collapsed = true;
    const s = state(d, { visibleModules: ['loudness'] }); // peak is currently hidden

    const next = workspaceReducer(s, {
      type: 'TOGGLE_MODULE_VISIBLE',
      payload: { id: 'peak' },
    });

    expect(next.dock.regions.left.slots[0].collapsed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. SET_FOCUS — activates tab in slot and uncollapses
// ---------------------------------------------------------------------------

describe('SET_FOCUS', () => {
  it('sets focusId', () => {
    const s = { ...DEFAULT_WORKSPACE_STATE, focusId: null };
    const next = workspaceReducer(s, { type: 'SET_FOCUS', payload: { id: 'peak' } });
    expect(next.focusId).toBe('peak');
  });

  it('makes the focused tab active in its slot', () => {
    const d = dock1('center', ['loudness', 'spectrum'], 'loudness');
    const s = state(d, { visibleModules: ['loudness', 'spectrum'] });

    const next = workspaceReducer(s, {
      type: 'SET_FOCUS',
      payload: { id: 'spectrum' },
    });

    expect(next.dock.regions.center.slots[0].activeTab).toBe('spectrum');
  });

  it('uncollapses a collapsed slot when focusing a module inside it', () => {
    const d = dock1('left', ['peak']);
    d.regions.left.slots[0].collapsed = true;
    const s = state(d, { visibleModules: ['peak'] });

    const next = workspaceReducer(s, { type: 'SET_FOCUS', payload: { id: 'peak' } });
    expect(next.dock.regions.left.slots[0].collapsed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9a. APPLY_PRESET — applies builtin preset
// ---------------------------------------------------------------------------

describe('APPLY_PRESET', () => {
  it('applies a builtin preset, replacing dock and visibleModules', () => {
    const s = { ...DEFAULT_WORKSPACE_STATE };
    const next = workspaceReducer(s, {
      type: 'APPLY_PRESET',
      payload: { presetId: 'broadcast' },
    });

    expect(next.activePresetId).toBe('broadcast');
    expect(next.visibleModules).toEqual(['peak', 'loudness', 'loudnessStats']);
    expect(next.dock.regions.left.slots[0].tabs).toContain('peak');
  });

  it('clears fullscreenId when applying a preset', () => {
    const s = { ...DEFAULT_WORKSPACE_STATE, fullscreenId: 'peak' };
    const next = workspaceReducer(s, {
      type: 'APPLY_PRESET',
      payload: { presetId: 'broadcast' },
    });
    expect(next.fullscreenId).toBeNull();
  });

  it('does nothing when preset id is unknown', () => {
    const s = { ...DEFAULT_WORKSPACE_STATE };
    const next = workspaceReducer(s, {
      type: 'APPLY_PRESET',
      payload: { presetId: 'nonexistent' },
    });
    expect(next).toBe(s); // same reference — no change
  });
});

// ---------------------------------------------------------------------------
// 9b. SAVE_PRESET — saves current state as custom preset
// ---------------------------------------------------------------------------

describe('SAVE_PRESET', () => {
  it('adds a new custom preset with the given name', () => {
    const s = { ...DEFAULT_WORKSPACE_STATE, customPresets: [] };
    const next = workspaceReducer(s, {
      type: 'SAVE_PRESET',
      payload: { name: 'My Layout' },
    });

    expect(next.customPresets).toHaveLength(1);
    expect(next.customPresets[0].name).toBe('My Layout');
  });

  it('saved preset captures current dock and visibleModules', () => {
    const s = {
      ...DEFAULT_WORKSPACE_STATE,
      visibleModules: ['peak', 'loudness'],
      customPresets: [],
    };
    const next = workspaceReducer(s, {
      type: 'SAVE_PRESET',
      payload: { name: 'Minimal' },
    });

    const saved = next.customPresets[0];
    expect(saved.visibleModules).toEqual(['peak', 'loudness']);
    expect(saved.dock).toEqual(s.dock);
  });

  it('sets activePresetId to the new preset id', () => {
    const s = { ...DEFAULT_WORKSPACE_STATE, customPresets: [] };
    const next = workspaceReducer(s, {
      type: 'SAVE_PRESET',
      payload: { name: 'Custom' },
    });

    expect(next.activePresetId).toBe(next.customPresets[0].id);
  });

  it('appends to existing custom presets without removing old ones', () => {
    const existing = [{ id: 'custom-1', name: 'Old', builtin: false, dock: {}, visibleModules: [] }];
    const s = { ...DEFAULT_WORKSPACE_STATE, customPresets: existing };
    const next = workspaceReducer(s, {
      type: 'SAVE_PRESET',
      payload: { name: 'New' },
    });

    expect(next.customPresets).toHaveLength(2);
  });
});
