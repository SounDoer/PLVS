/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const useAgentControlBridge = vi.hoisted(() => vi.fn());
vi.mock("./useAgentControlBridge.js", () => ({ useAgentControlBridge }));

import { AgentControlBridge } from "./AgentControlBridge.jsx";
import { standIn } from "../testing/standIn.js";

describe("AgentControlBridge", () => {
  it("renders nothing and hands its props to the bridge hook", () => {
    const props = standIn({ enabled: false, runtime: { available: false } });
    const { container } = render(<AgentControlBridge {...props} />);

    expect(container.innerHTML).toBe("");
    expect(useAgentControlBridge).toHaveBeenCalledWith(props);
  });
});
