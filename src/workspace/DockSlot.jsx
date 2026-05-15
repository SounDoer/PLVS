import { ChevronDown, ChevronUp, Maximize2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MODULE_REGISTRY } from './registry.jsx';
import { useWorkspaceStore } from './WorkspaceContext.jsx';
import { useDrag } from './DragContext.jsx';

function TabPill({ tabId, isActive, regionKey, slotIndex, tabCount, slotTabIndex }) {
  const { setActiveTab, toggleModuleVisible } = useWorkspaceStore();
  const { dragState, onTabMouseDown } = useDrag();
  const def = MODULE_REGISTRY[tabId];
  if (!def) return null;

  const isSourceTab = dragState?.sourceId === tabId;

  return (
    <div
      data-tab-pill
      data-tab-pill-index={slotTabIndex}
      className={cn(
        'flex items-center gap-1 rounded-t-[5px] px-2 py-0.5 text-xs font-medium select-none cursor-pointer transition-colors',
        isActive
          ? 'text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
        isSourceTab && 'opacity-35'
      )}
      onMouseDown={(e) => onTabMouseDown(e, tabId)}
      onClick={() => !dragState && setActiveTab(regionKey, slotIndex, tabId)}
    >
      <span className="flex shrink-0"><def.Icon /></span>
      <span className="truncate max-w-[8rem]">{def.title}</span>
      {tabCount > 1 && (
        <button
          type="button"
          aria-label={`Hide ${def.title}`}
          className="ml-0.5 rounded opacity-50 hover:opacity-100 focus-visible:outline-none"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            toggleModuleVisible(tabId);
          }}
        >
          <X size={10} />
        </button>
      )}
    </div>
  );
}

/** Derive which visual zone hint to show based on hoverDrop. */
function getZoneHint(hoverDrop, regionKey, slotIndex) {
  if (!hoverDrop) return null;
  if (hoverDrop.targetRegion !== regionKey || hoverDrop.slotIndex !== slotIndex) return null;
  return hoverDrop.zone; // 'tabs' | 'above' | 'below'
}

export function DockSlot({ slot, regionKey, slotIndex, isLast = false }) {
  const { state, toggleSlotCollapsed, toggleModuleVisible, setFullscreen, hoveredModuleId } = useWorkspaceStore();
  const { visibleModules } = state;
  const { dragState, hoverDrop } = useDrag();

  const visibleTabs = slot.tabs.filter((id) => visibleModules.includes(id));
  const activeTab = visibleTabs.includes(slot.activeTab) ? slot.activeTab : visibleTabs[0];
  const ActiveComponent = activeTab ? MODULE_REGISTRY[activeTab]?.Component : null;
  const isFocused = activeTab && hoveredModuleId === activeTab;
  const zoneHint = getZoneHint(hoverDrop, regionKey, slotIndex);
  const isDragging = !!dragState;

  return (
    <div
      data-slot
      data-region={regionKey}
      data-slot-index={slotIndex}
      className={cn(
        'relative flex min-h-0 flex-col overflow-hidden rounded-[10px] border bg-card/55 shadow-sm backdrop-blur-md transition-[border-color,box-shadow] duration-150',
        slot.collapsed ? 'shrink-0' : (slot.size ? '' : 'flex-1'),
        isFocused
          ? 'border-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.6)]'
          : 'border-border/80 hover:border-border',
        isDragging && zoneHint === 'above' && 'ring-2 ring-primary ring-offset-0',
        isDragging && zoneHint === 'below' && 'ring-2 ring-primary ring-offset-0'
      )}
      style={slot.size && !slot.collapsed ? { flexBasis: slot.size, flexGrow: isLast ? 1 : 0, flexShrink: 1 } : undefined}
    >
      {/* Zone hint: above */}
      {isDragging && zoneHint === 'above' && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-1/2 items-start justify-center rounded-t-[10px] border-t-2 border-dashed border-primary bg-primary/5 pt-2 text-[10px] text-primary">
          Insert above
        </div>
      )}

      {/* Zone hint: below */}
      {isDragging && zoneHint === 'below' && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex h-1/2 items-end justify-center rounded-b-[10px] border-b-2 border-dashed border-primary bg-primary/5 pb-2 text-[10px] text-primary">
          Insert below
        </div>
      )}

      {/* Slot header: tab bar + action buttons */}
      <div
        data-slot-tabs
        className={cn(
          'relative flex h-9 shrink-0 items-center gap-0.5 border-b border-border/60 bg-card px-1',
          isDragging && zoneHint === 'tabs' && 'border-t-2 border-t-primary'
        )}
      >
        {/* Tab insertion indicator */}
        {isDragging && zoneHint === 'tabs' && (
          <div
            className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-primary"
            style={{ left: getTabInsertX(hoverDrop?.tabIndex, visibleTabs.length) }}
          />
        )}

        {visibleTabs.map((tabId, i) => (
          <TabPill
            key={tabId}
            tabId={tabId}
            isActive={tabId === activeTab}
            regionKey={regionKey}
            slotIndex={slotIndex}
            tabCount={visibleTabs.length}
            slotTabIndex={i}
          />
        ))}

        <div className="ml-auto flex shrink-0 items-center gap-0.5 pl-1">
          <button
            type="button"
            aria-label="Fullscreen"
            className="rounded p-0.5 text-muted-foreground opacity-50 hover:opacity-100 focus-visible:outline-none"
            onClick={() => activeTab && setFullscreen(activeTab)}
          >
            <Maximize2 size={12} />
          </button>
          <button
            type="button"
            aria-label={slot.collapsed ? 'Expand' : 'Collapse'}
            className="rounded p-0.5 text-muted-foreground opacity-50 hover:opacity-100 focus-visible:outline-none"
            onClick={() => toggleSlotCollapsed(regionKey, slotIndex)}
          >
            {slot.collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
          <button
            type="button"
            aria-label="Hide all in slot"
            className="rounded p-0.5 text-muted-foreground opacity-50 hover:opacity-100 focus-visible:outline-none"
            onClick={() => visibleTabs.forEach((id) => toggleModuleVisible(id))}
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Slot body */}
      {!slot.collapsed && (
        <div data-slot-body className="flex min-h-0 flex-1 overflow-hidden">
          {ActiveComponent && <ActiveComponent compact={false} />}
        </div>
      )}
    </div>
  );
}

/**
 * Approximate pixel position for the vertical insertion indicator.
 * Returns a CSS left value string.
 */
function getTabInsertX(tabIndex, totalTabs) {
  if (totalTabs === 0 || tabIndex === 0) return '4px';
  if (tabIndex >= totalTabs) return 'calc(100% - 4px)';
  // Rough estimate: tabs are roughly equally spaced
  return `${Math.round((tabIndex / totalTabs) * 100)}%`;
}
