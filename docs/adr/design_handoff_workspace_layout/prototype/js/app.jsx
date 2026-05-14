// ====================================================================
// AudioMeter — Main App Shell
// Top bar: layout switcher · device · saved presets · module visibility
// ====================================================================

const ALL_MODULE_IDS = ["peak", "loudness", "loudnessStats", "vectorscope", "spectrum", "spectrogram"];

const LAYOUT_KINDS = [
  { id: "bento",  label: "Bento Grid",   hint: "Modules snap to a 12-col grid" },
  { id: "dock",   label: "Dock + Tabs",  hint: "Region-based stacking (IDE-style)" },
  { id: "float",  label: "Free Float",   hint: "Free-floating windows" },
];

const PRESETS = {
  bento: [
    { id: "default", label: "Default" },
    { id: "loudness-focus", label: "Loudness Focus", visible: ["loudness", "loudnessStats", "peak"], pos: {
      loudness:      { col: 0, row: 0, w: 9, h: 8 },
      loudnessStats: { col: 9, row: 0, w: 3, h: 8 },
      peak:          { col: 0, row: 8, w: 12, h: 4 },
    }},
    { id: "spectrum-focus", label: "Spectrum Focus", visible: ["spectrum", "spectrogram", "peak"], pos: {
      spectrum:    { col: 0, row: 0, w: 9, h: 5 },
      peak:        { col: 9, row: 0, w: 3, h: 5 },
      spectrogram: { col: 0, row: 5, w: 12, h: 7 },
    }},
  ],
  dock: [
    { id: "default", label: "Default" },
    { id: "broadcast", label: "Broadcast", visible: ["loudness", "loudnessStats", "peak"], dock: {
      regions: {
        left:   { size: 200, slots: [{ tabs: ["peak"], activeTab: "peak", collapsed: false }] },
        center: { slots: [{ tabs: ["loudness"], activeTab: "loudness", collapsed: false }] },
        right:  { size: 260, slots: [{ tabs: ["loudnessStats"], activeTab: "loudnessStats", collapsed: false }] },
        bottom: { size: 0, slots: [] },
      },
    }},
    { id: "tabs-demo", label: "Compact (tabs)", visible: ["loudness", "spectrum", "spectrogram", "loudnessStats", "peak"], dock: {
      regions: {
        left:   { size: 180, slots: [{ tabs: ["peak"], activeTab: "peak", collapsed: false }] },
        center: { slots: [
          { tabs: ["loudness", "spectrum", "spectrogram"], activeTab: "loudness", collapsed: false },
        ] },
        right:  { size: 240, slots: [{ tabs: ["loudnessStats"], activeTab: "loudnessStats", collapsed: false }] },
        bottom: { size: 0, slots: [] },
      },
    }},
    { id: "spectrum-focus", label: "Spectrum Focus", visible: ["spectrum", "spectrogram", "peak"], dock: {
      regions: {
        left:   { size: 200, slots: [{ tabs: ["peak"], activeTab: "peak", collapsed: false }] },
        center: { slots: [{ tabs: ["spectrum"], activeTab: "spectrum", collapsed: false }] },
        right:  { size: 0, slots: [] },
        bottom: { size: 320, slots: [{ tabs: ["spectrogram"], activeTab: "spectrogram", collapsed: false }] },
      },
    }},
  ],
  float: [
    { id: "default", label: "Default" },
    { id: "tiled", label: "Tiled" },
  ],
};

function TopBar({
  layoutKind, setLayoutKind,
  device, recording, toggleRecording,
  onAddModule, addPopoverOpen, setAddPopoverOpen,
  visibleSet, collapsedIds, toggleVisible,
  preset, setPreset, presets,
  onArrange, layoutSupportsArrange,
  onClear,
}) {
  return (
    <div className="topbar">
      <div className="brand">
        <span className="brand-dot"></span>
        AudioMeter
      </div>

      <div className="seg">
        {LAYOUT_KINDS.map((l) => (
          <button
            key={l.id}
            className={layoutKind === l.id ? "active" : ""}
            onClick={() => setLayoutKind(l.id)}
            title={l.hint}
          >
            {l.label}
          </button>
        ))}
      </div>

      <div className="pill" style={{ position: "relative" }}>
        <span className="label">Preset</span>
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--text)",
            font: "inherit",
            outline: "none",
            cursor: "pointer",
            padding: 0,
            appearance: "none",
            paddingRight: 14,
          }}
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id} style={{ background: "var(--bg-3)" }}>{p.label}</option>
          ))}
        </select>
        <svg width="8" height="8" viewBox="0 0 8 8" style={{ position: "absolute", right: 8, pointerEvents: "none" }}>
          <path d="M1 2.5L4 5.5L7 2.5" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
        </svg>
      </div>

      <div className="spacer"></div>

      <div className="pill" style={{ maxWidth: 240 }}>
        <span className="label">Device</span>
        <span style={{ color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {device}
        </span>
      </div>

      <button
        className="icon-btn"
        title="Module visibility"
        data-popover-trigger
        onClick={() => setAddPopoverOpen((o) => !o)}
        style={{ position: "relative" }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="1.5" y="1.5" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
          <rect x="8.5" y="1.5" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
          <rect x="1.5" y="8.5" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
          <rect x="8.5" y="8.5" width="4" height="4" rx="0.8" stroke="currentColor" strokeWidth="1.2"/>
        </svg>
        <Popover open={addPopoverOpen} onClose={() => setAddPopoverOpen(false)} style={{ top: 36, right: 0 }}>
          <div className="popover-section">Modules</div>
          {ALL_MODULE_IDS.map((id) => {
            const r = MODULE_REGISTRY[id];
            const visible = visibleSet.has(id);
            return (
              <button
                key={id}
                className="popover-item"
                onClick={(e) => { e.stopPropagation(); toggleVisible(id); }}
              >
                <span className="check">
                  {visible ? (
                    <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6l3 3 5-6" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  ) : null}
                </span>
                {r.title}
                <span style={{ marginLeft: "auto", color: "var(--text-mute)", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.04 }}>
                  {visible ? (collapsedIds.has(id) ? "Collapsed" : "Shown") : "Hidden"}
                </span>
              </button>
            );
          })}
          {layoutSupportsArrange && (
            <>
              <hr />
              <button className="popover-item" onClick={(e) => { e.stopPropagation(); onArrange(); setAddPopoverOpen(false); }}>
                <span className="check">
                  <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2h4v4H2zM7 2h3v3H7zM7 6h3v4H7zM2 7h4v3H2z" stroke="currentColor" strokeWidth="1" fill="none"/></svg>
                </span>
                Auto-tile windows
              </button>
            </>
          )}
        </Popover>
      </button>

      <button className="icon-btn" title="Clear" onClick={onClear}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 4h8M5 4V2.5h4V4M4 4l.5 7.5h5L10 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      <button className="stop-btn" onClick={toggleRecording}>
        {recording ? (
          <><svg width="10" height="10" viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7" fill="currentColor"/></svg> STOP</>
        ) : (
          <><svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 1.5l7 3.5-7 3.5z" fill="currentColor"/></svg> START</>
        )}
      </button>

      <button className="icon-btn" title="Settings">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M7 1v1.5M7 11.5V13M13 7h-1.5M2.5 7H1M11.2 2.8l-1.1 1.1M3.9 10.1l-1.1 1.1M11.2 11.2l-1.1-1.1M3.9 3.9L2.8 2.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}

// ---------- Activity Bar ----------

const MODULE_ICONS = {
  peak: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="3" y="3" width="3.5" height="10" rx="0.5" fill="currentColor" />
      <rect x="9.5" y="6" width="3.5" height="7" rx="0.5" fill="currentColor" />
    </svg>
  ),
  loudness: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 11l2-3 2 1 2-4 2 2 2-3 2 2 2-1" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="2" y1="13" x2="14" y2="13" stroke="currentColor" strokeWidth="0.8" strokeDasharray="2 2" opacity="0.5" />
    </svg>
  ),
  loudnessStats: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2.5" y="3" width="11" height="2.5" rx="0.5" stroke="currentColor" strokeWidth="1" />
      <rect x="2.5" y="6.5" width="11" height="2.5" rx="0.5" stroke="currentColor" strokeWidth="1" fill="currentColor" fillOpacity="0.18" />
      <rect x="2.5" y="10" width="11" height="2.5" rx="0.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  ),
  vectorscope: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1" fill="none" />
      <line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" strokeWidth="0.7" opacity="0.4" />
      <line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" strokeWidth="0.7" opacity="0.4" />
      <ellipse cx="8" cy="8" rx="3" ry="1" fill="currentColor" transform="rotate(-30 8 8)" />
    </svg>
  ),
  spectrum: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 13L3 9L4 10L5 6L6 7L7 4L8 5L9 7L10 9L11 8L12 10L13 12L14 13" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  spectrogram: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="3" width="2" height="10" fill="currentColor" opacity="0.9" />
      <rect x="4.5" y="3" width="2" height="10" fill="currentColor" opacity="0.6" />
      <rect x="7" y="3" width="2" height="10" fill="currentColor" opacity="0.8" />
      <rect x="9.5" y="3" width="2" height="10" fill="currentColor" opacity="0.4" />
      <rect x="12" y="3" width="2" height="10" fill="currentColor" opacity="0.7" />
    </svg>
  ),
};

function ActivityBar({ visibleSet, focusId, setFocusId, toggleVisible }) {
  return (
    <div className="activity-bar">
      {ALL_MODULE_IDS.map((id) => {
        const reg = MODULE_REGISTRY[id];
        const visible = visibleSet.has(id);
        const isFocus = focusId === id && visible;
        const cls = ["activity-btn", visible && "visible", isFocus && "focused"].filter(Boolean).join(" ");
        return (
          <button
            key={id}
            className={cls}
            onClick={() => {
              if (visible && !isFocus) {
                setFocusId(id);
              } else {
                toggleVisible(id);
                if (!visible) setFocusId(id);
              }
            }}
            title={reg.title}
          >
            {MODULE_ICONS[id]}
            <span className="activity-tooltip">
              {reg.title}
              <small>
                {visible
                  ? (isFocus ? "Focused" : "Click to focus · Cmd+click to hide")
                  : "Click to show"}
              </small>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function StatusBar({ layoutKind, visibleCount, hiddenCount, focusId, recording }) {
  return (
    <div className="statusbar">
      <span>Monitoring system playback (loopback)</span>
      <div className="sep"></div>
      <span>Device: <span style={{ color: "var(--text)" }}>扬声器 (4- Apogee Symphony Desktop)</span></span>
      <div className="sep"></div>
      <span className="status-ok">{recording ? "METER: OK" : "METER: IDLE"}</span>
      <div className="sep"></div>
      <span>Layout: <span style={{ color: "var(--text)" }}>{LAYOUT_KINDS.find((l) => l.id === layoutKind).label}</span></span>
      <div className="sep"></div>
      <span>{visibleCount} visible · {hiddenCount} hidden</span>
      {focusId && (<>
        <div className="sep"></div>
        <span>Focus: <span style={{ color: "var(--text)" }}>{MODULE_REGISTRY[focusId].title}</span></span>
      </>)}
      <div style={{ flex: 1 }}></div>
      <span>Build: dev</span>
    </div>
  );
}

function App() {
  const [layoutKind, setLayoutKind] = React.useState("bento");
  const [recording, setRecording] = React.useState(true);
  const [focusId, setFocusId] = React.useState("loudness");
  const [fullscreenId, setFullscreenId] = React.useState(null);
  const [collapsedIds, setCollapsedIds] = React.useState(() => new Set());
  const [addPopoverOpen, setAddPopoverOpen] = React.useState(false);

  // Visibility per-layout. Independent so each layout has its own state.
  const [visibleByLayout, setVisibleByLayout] = React.useState({
    bento: new Set(ALL_MODULE_IDS),
    dock: new Set(ALL_MODULE_IDS),
    float: new Set(ALL_MODULE_IDS),
  });

  // Bento state
  const [bentoPositions, setBentoPositions] = React.useState(() => ({ ...BENTO_DEFAULT }));
  // Dock state
  const [dockState, setDockState] = React.useState(() => structuredClone(DOCK_DEFAULT));
  // Float state
  const [floatState, setFloatState] = React.useState(() => structuredClone(FLOAT_DEFAULT));

  // Preset selection per layout
  const [presetByLayout, setPresetByLayout] = React.useState({ bento: "default", dock: "default", float: "default" });

  const visibleSet = visibleByLayout[layoutKind];
  const visibleIds = ALL_MODULE_IDS.filter((id) => visibleSet.has(id));
  const hiddenIds = ALL_MODULE_IDS.filter((id) => !visibleSet.has(id));

  const setVisibleSet = (updater) => {
    setVisibleByLayout((prev) => {
      const cur = prev[layoutKind];
      const next = typeof updater === "function" ? updater(cur) : updater;
      return { ...prev, [layoutKind]: next };
    });
  };

  const toggleVisible = (id) => {
    setVisibleSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onClose = (id) => setVisibleSet((prev) => {
    const next = new Set(prev); next.delete(id); return next;
  });
  const onShow = (id) => setVisibleSet((prev) => {
    const next = new Set(prev); next.add(id); return next;
  });

  const toggleCollapse = (id) => setCollapsedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Apply preset
  const applyPreset = (presetId) => {
    setPresetByLayout((prev) => ({ ...prev, [layoutKind]: presetId }));
    if (presetId === "default") {
      setVisibleSet(new Set(ALL_MODULE_IDS));
      if (layoutKind === "bento") setBentoPositions({ ...BENTO_DEFAULT });
      if (layoutKind === "dock") setDockState(structuredClone(DOCK_DEFAULT));
      if (layoutKind === "float") setFloatState(structuredClone(FLOAT_DEFAULT));
      return;
    }
    const p = PRESETS[layoutKind].find((x) => x.id === presetId);
    if (!p) return;
    if (p.visible) setVisibleSet(new Set(p.visible));
    if (layoutKind === "bento" && p.pos) {
      setBentoPositions((prev) => ({ ...prev, ...p.pos }));
    }
    if (layoutKind === "dock" && p.dock) {
      setDockState(structuredClone(p.dock));
    }
    if (layoutKind === "float" && p.id === "tiled") {
      // Apply tiled layout after a tick when sizes are known
      requestAnimationFrame(() => {
        const ws = document.querySelector(".float");
        if (ws) {
          const tiled = tileFloat(p.visible || ALL_MODULE_IDS,
            ws.clientWidth, ws.clientHeight);
          setFloatState((prev) => {
            const next = { ...prev };
            for (const k of Object.keys(tiled)) next[k] = { ...next[k], ...tiled[k] };
            return next;
          });
        }
      });
    }
  };

  const handleArrange = () => {
    const ws = document.querySelector(".float");
    if (ws) {
      const tiled = tileFloat(visibleIds, ws.clientWidth, ws.clientHeight);
      setFloatState((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(tiled)) next[k] = { ...next[k], ...tiled[k] };
        return next;
      });
    }
  };

  const layoutProps = {
    visibleIds, hiddenIds,
    focusId, setFocusId,
    fullscreenId, setFullscreenId,
    collapsedIds, toggleCollapse,
    onClose, onShow,
  };

  return (
    <>
      <TopBar
        layoutKind={layoutKind}
        setLayoutKind={setLayoutKind}
        device="Automatic (default system output)"
        recording={recording}
        toggleRecording={() => setRecording((r) => !r)}
        addPopoverOpen={addPopoverOpen}
        setAddPopoverOpen={setAddPopoverOpen}
        visibleSet={visibleSet}
        collapsedIds={collapsedIds}
        toggleVisible={toggleVisible}
        preset={presetByLayout[layoutKind]}
        setPreset={applyPreset}
        presets={PRESETS[layoutKind]}
        onArrange={handleArrange}
        layoutSupportsArrange={layoutKind === "float"}
        onClear={() => {}}
      />

      <div className="app-row">
        <ActivityBar
          visibleSet={visibleSet}
          focusId={focusId}
          setFocusId={setFocusId}
          toggleVisible={toggleVisible}
        />
        <div className="workspace">
          <div className="workspace-inner">
          {layoutKind === "bento" && (
            <BentoLayout
              {...layoutProps}
              positions={bentoPositions}
              setPositions={setBentoPositions}
            />
          )}
          {layoutKind === "dock" && (
            <DockLayout
              {...layoutProps}
              dockState={dockState}
              setDockState={setDockState}
            />
          )}
          {layoutKind === "float" && (
            <FloatLayout
              {...layoutProps}
              floatState={floatState}
              setFloatState={setFloatState}
              onTile={handleArrange}
            />
          )}
        </div>

        {fullscreenId && (
          <div className="fullscreen-overlay">
            <Module
              title={MODULE_REGISTRY[fullscreenId].title}
              fullscreen
              onFullscreen={() => setFullscreenId(null)}
              onClose={() => setFullscreenId(null)}
              focus
              style={{ flex: 1 }}
            >
              {MODULE_REGISTRY[fullscreenId].render(false)}
            </Module>
          </div>
        )}
        </div>
      </div>

      <StatusBar
        layoutKind={layoutKind}
        visibleCount={visibleIds.length}
        hiddenCount={hiddenIds.length}
        focusId={focusId}
        recording={recording}
      />
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
