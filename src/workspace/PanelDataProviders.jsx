import { AudioDataContext, PanelChromeProvider } from "./AudioDataContext.jsx";

export function PanelDataProviders({ sharedPanelData, panelChromeData, children }) {
  return (
    <AudioDataContext.Provider value={sharedPanelData}>
      <PanelChromeProvider value={panelChromeData}>{children}</PanelChromeProvider>
    </AudioDataContext.Provider>
  );
}
