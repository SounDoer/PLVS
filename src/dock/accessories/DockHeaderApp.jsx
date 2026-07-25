import { DockHeader } from "./DockHeader.jsx";
import { useAccessoryClient } from "./useAccessoryClient.js";
import { useSuppressNativeContextMenu } from "../../hooks/useSuppressNativeContextMenu.js";

export function DockHeaderApp() {
  const { payload, action, pointer } = useAccessoryClient("dock-header");
  useSuppressNativeContextMenu();
  return <DockHeader state={payload} onAction={action} onPointer={pointer} />;
}
