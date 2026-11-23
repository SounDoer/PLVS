import { useEffect, useState } from "react";
import { useMcpUsage } from "@/agentControl/mcpUsage.js";

const TICK_MS = 30_000;

/**
 * @param {number} elapsedMs
 * @returns {string}
 */
function formatElapsed(elapsedMs) {
  const minutes = Math.floor(Math.max(0, elapsedMs) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** The one-line status under MCP Setup: which chat app last used PLVS through MCP, and when. */
export function McpUsageStatus() {
  const usage = useMcpUsage();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!usage) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [usage]);
  if (!usage) return null;
  return (
    <div role="status" className="px-2 text-[length:var(--ui-fs-axis)] text-muted-foreground">
      {`Last used by ${usage.client} ${formatElapsed(now - usage.at)}`}
    </div>
  );
}
