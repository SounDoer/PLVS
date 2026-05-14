import { createContext, useContext } from 'react';

/**
 * Provides all audio-domain data and callbacks to module components,
 * eliminating prop-drilling through Dock / Region / Slot layers.
 *
 * Shape matches the values currently computed in App.jsx and passed
 * through PanelSet. Module components consume via useAudioData().
 */
export const AudioDataContext = createContext(null);

export function useAudioData() {
  return useContext(AudioDataContext);
}
