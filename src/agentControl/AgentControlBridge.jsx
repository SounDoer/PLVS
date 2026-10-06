import { useAgentControlBridge } from "./useAgentControlBridge.js";

/**
 * Agent Control as a component, so it can sit inside the domain providers and read them itself.
 * It still receives every area as a prop; each domain that gains an owner moves its wiring from
 * `App.jsx` into this file.
 *
 * @param {Parameters<typeof useAgentControlBridge>[0]} props
 */
export function AgentControlBridge(props) {
  useAgentControlBridge(props);
  return null;
}
