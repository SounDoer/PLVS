/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { useRef } from "react";

const register = vi.fn();
const unregister = vi.fn();

vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));
vi.mock("../lib/globalClearPrefs.js", () => ({
  DEFAULT_GLOBAL_CLEAR_SHORTCUT: "CmdOrCtrl+Alt+K",
  loadGlobalClearPrefs: () => Promise.resolve({ enabled: true, shortcut: "CmdOrCtrl+Alt+K" }),
  saveGlobalClearPrefs: () => Promise.resolve(),
}));
vi.mock("@tauri-apps/plugin-global-shortcut", () => ({ register, unregister }));

import { useGlobalClearShortcut } from "./useGlobalClearShortcut.js";

function Harness({ onClear }) {
  const ref = useRef(onClear);
  ref.current = onClear;
  useGlobalClearShortcut(ref);
  return null;
}

beforeEach(() => {
  register.mockReset();
  unregister.mockReset();
});

describe("useGlobalClearShortcut", () => {
  it("registers the stored accelerator and routes the handler to onClear", async () => {
    const onClear = vi.fn();
    render(<Harness onClear={onClear} />);

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register.mock.calls[0][0]).toBe("CmdOrCtrl+Alt+K");

    const handler = register.mock.calls[0][1];
    handler({ state: "Pressed" });
    expect(onClear).toHaveBeenCalledTimes(1);

    handler({ state: "Released" });
    expect(onClear).toHaveBeenCalledTimes(1); // ignores non-press
  });
});
