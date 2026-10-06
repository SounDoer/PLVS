/**
 * Ambient declarations for values the app reads from the page rather than from a module. This file
 * holds declarations only; it has no runtime output and nothing imports it.
 */
export {};

declare global {
  interface Window {
    /**
     * Boot snapshot Rust injects before first paint (`src-tauri` initialization script). Absent in
     * the browser dev environment, where the stores fall back to `localStorage`. Its fields are
     * read defensively at each call site, so it stays loosely typed here.
     */
    __PLVS_INITIAL_STATE__?: Record<string, any> & { uiVisualFixture?: string };
    /** Render entry points the community preview page exposes to the site build that drives it. */
    /** Per-panel CPU counters for profiling sessions (`src/dev/panelCpuProfiler.js`). */
    __PLVS_PANEL_CPU__?: Record<string, any>;
    __PLVS_COMMUNITY_PREVIEW__?: Readonly<Record<string, (...args: any[]) => any>>;
  }
}

declare module "react" {
  /** CSS custom properties are valid in an inline `style`; React's own type lists none. */
  interface CSSProperties {
    [customProperty: `--${string}`]: string | number | undefined;
  }
}
