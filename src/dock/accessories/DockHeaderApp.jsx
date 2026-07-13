import { DockHeader } from "./DockHeader.jsx";
import { useAccessoryClient } from "./useAccessoryClient.js";

export function DockHeaderApp() {
  const { payload, action, pointer } = useAccessoryClient("dock-header");
  return <DockHeader state={payload} onAction={action} onPointer={pointer} />;
}
