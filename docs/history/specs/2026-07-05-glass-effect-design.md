# Glass Effect (System-Level Frosted Glass) — Design

## Goal

Add a "Glass" toggle to the Views popover that turns the transparent area created by the existing `panelOpacity` slider from a sharp see-through window into a true frosted-glass window, using OS-level compositor blur (Windows Acrylic, macOS `NSVisualEffectView` vibrancy).

## Why not a slider

CSS `backdrop-filter: blur()` (already used on panel surfaces) only blurs content rendered *inside* the page/document. It cannot blur what's behind the OS window itself (desktop, other apps) — that requires native window-compositor APIs. Both Windows (Acrylic/Mica) and macOS (`NSVisualEffectView` vibrancy) expose blur as a fixed *material preset*, not a continuous numeric strength. There is no underlying value for a slider to bind to, so the control is a boolean toggle, matching the existing `FocusSwitch` toggles in the Views popover ("Always on Top", "Compact Panels", "Hide Chrome", "Auto-hide Controls").

## Relationship to `panelOpacity`

`glassEnabled` is an independent, orthogonal setting layered on top of the existing opacity slider:

- `panelOpacity` continues to control overall window alpha (0–100%), unchanged.
- `glassEnabled` controls *what* fills the transparent area: sharp desktop passthrough (off, current behavior) vs. OS-blurred passthrough (on).
- At `panelOpacity = 100%` there is no transparent area, so the glass toggle has no visible effect — this is expected and requires no special-casing in the UI.

## Rust (`src-tauri`)

1. Add the `window-vibrancy` crate as a dependency (Tauri-maintained, supports Windows and macOS).
2. Add a Tauri command `set_glass_effect(enabled: bool, dark: bool)`:
   - **Windows**: `window_vibrancy::apply_acrylic(&window, Some(tint_color))` when `enabled`, `clear_acrylic(&window)` when not. Acrylic is chosen over Mica because Acrylic covers Windows 10 1809+ through Windows 11, matching the project's existing Windows 10+ minimum (Mica requires Windows 11 22H2+). `tint_color` alpha/RGB is derived from `dark` (a neutral dark or light tint, no user-facing color picker).
   - **macOS**: `window_vibrancy::apply_vibrancy(&window, material, state, radius)` when `enabled`, and the crate's corresponding clear call when not. Material is a single fixed preset appropriate for an overlay window (e.g. `NSVisualEffectMaterial::HudWindow` or `Sidebar`); `dark`/`state` selects between dark/light appearance, no other user-facing material choice.
   - Both platforms: if the underlying call fails (unsupported OS version, feature unavailable), the command returns an error that the frontend swallows silently — consistent with how `setDecorations`/autostart failures are already handled. No error surfaced to the user.
3. Turning the toggle off must call the explicit clear/remove function, not simply skip calling apply — otherwise the blur state persists on the window.

## Frontend

1. **Settings**: add `glassEnabled` to `src/settings/defaults.js` (default `false`) with a `normalizeGlassEnabled` following the existing boolean-normalization pattern used for other Views flags.
2. **`useSettings.js`**: wire `glassEnabled`/`setGlassEnabled` the same way `panelOpacity` is wired today (state initialized from `settingsStore.read()`, setter patches the store and clears the active preset, subscriber effect syncs state, persistence effect includes it, returned from the hook).
3. **New hook `useGlassEffect(enabled, dark)`** (in `src/hooks/`, modeled on `useFocusViewWindow.js` / `useAutostart.js`): on change, `invoke("set_glass_effect", { enabled, dark })` from `@tauri-apps/api/core`, wrapped in a silent `.catch(() => {})`. This is a window-chrome effect, so it calls `invoke` directly from the hook rather than going through `src/ipc/` (consistent with how other shell/window APIs — always-on-top, decorations, autostart — are already handled outside the audio-engine IPC boundary).
   - `dark` is derived from the app's current resolved theme (light/dark), so the glass material stays visually consistent with the active theme without adding a separate user-facing option.
   - Re-invoke whenever `enabled` or the resolved theme's dark/light value changes, so switching themes while glass is on re-applies the matching material.
4. **`FocusViewPopover.jsx`**: add one more `FocusSwitch` labeled "Glass", alongside the existing switches, wired to `glassEnabled`/`setGlassEnabled` props threaded through `AppHeader.jsx`/`App.jsx` the same way `panelOpacity` is today.
5. **Presets**: include `glassEnabled` in `usePresets.js` capture/apply, the same way `panelOpacity` is included, so saved presets restore the glass state.

## Platform / Edge Cases

- Linux is out of scope (the project does not currently ship a Linux build).
- Older/unsupported OS versions: the command fails silently; the toggle has no visible effect but does not error or crash. No version-detection UI is added — this is left as a graceful no-op, consistent with existing platform-capability handling elsewhere in the app (e.g. autostart availability).
- No new IPC surface in `src/ipc/`: this feature does not touch the audio engine.
- No continuous intensity control is added now or planned; if finer control becomes necessary later, it would be a separate follow-up design (out of scope here).

## Testing

- `defaults.test.js`: unit tests for `normalizeGlassEnabled` mirroring the existing default-normalization tests.
- `useSettings` tests: extend existing coverage to include `glassEnabled` round-tripping through the store, following the pattern already used for `panelOpacity`.
- `usePresets` tests: extend existing preset capture/apply tests to cover `glassEnabled`, following the pattern already used for `panelOpacity`.
- `FocusViewPopover` tests: assert the new "Glass" switch renders and calls `setGlassEnabled` on toggle.
- Rust: `cargo check`/`cargo clippy` must pass with the new dependency and command; no automated test for the native visual effect itself (manual verification only, since it requires visually inspecting window compositing on real Windows/macOS builds).
- Manual verification (both platforms): with `panelOpacity` < 100%, toggle Glass on/off and confirm the transparent area switches between sharp desktop passthrough and blurred passthrough; toggle theme while Glass is on and confirm the material follows.
