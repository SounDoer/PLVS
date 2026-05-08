export function SettingsPanel({
  settingsOpen,
  setSettingsOpen,
  uiMode,
  setUiMode,
  standard,
  setStandard,
  channelLayout,
  setChannelLayout,
  resetLayout,
}) {
  if (!settingsOpen) return null;
  return (
    <div
      className="ui-settings-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) setSettingsOpen(false);
      }}
    >
      <div className="ui-settings-dialog">
        <div className="ui-settings-header flex items-center justify-between">
          <h2 className="ui-settings-heading">Settings</h2>
          <button type="button" className="ui-settings-btn ui-settings-btn-pill" onClick={() => setSettingsOpen(false)}>
            Close
          </button>
        </div>
        <div className="ui-settings-content flex flex-col text-[length:var(--ui-fs-metric-meta)]">
          <div className="ui-settings-row">
            <span className="ui-settings-label">Loudness standard</span>
            <select value={standard} onChange={(e) => setStandard(e.target.value)} className="ui-select">
              <option value="ebu">EBU R128</option>
              <option value="stream">Streaming</option>
            </select>
          </div>
          <div className="ui-settings-row">
            <span className="ui-settings-label">Theme</span>
            <div className="ui-settings-inline-actions flex">
              <button
                type="button"
                onClick={() => setUiMode("dark")}
                className={uiMode === "dark" ? "ui-theme-btn-on" : "ui-theme-btn-off"}
              >
                Dark
              </button>
              <button
                type="button"
                onClick={() => setUiMode("light")}
                className={uiMode === "light" ? "ui-theme-btn-on" : "ui-theme-btn-off"}
              >
                Light
              </button>
            </div>
          </div>
          <div className="ui-settings-row">
            <span className="ui-settings-label">Layout</span>
            <button type="button" onClick={resetLayout} className="ui-settings-btn ui-settings-btn-pill">
              Reset Layout
            </button>
          </div>
          <div className="ui-settings-row">
            <span className="ui-settings-label">Channel layout (Advanced)</span>
            <select value={channelLayout} onChange={(e) => setChannelLayout(e.target.value)} className="ui-select">
              <option value="auto">Auto</option>
              <option value="stereo">Stereo</option>
              <option value="5.1">5.1</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
