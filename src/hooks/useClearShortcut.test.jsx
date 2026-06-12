/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { useRef } from "react";

const register = vi.fn();
const unregister = vi.fn();

vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));
vi.mock("../lib/clearShortcutPrefs.js", () => ({
  DEFAULT_CLEAR_SHORTCUT: "CmdOrCtrl+K",
  loadClearShortcutPrefs: () => Promise.resolve({ shortcut: "CmdOrCtrl+K", global: true }),
  saveClearShortcutPrefs: () => Promise.resolve(),
}));
vi.mock("@tauri-apps/plugin-global-shortcut", () => ({ register, unregister }));

import { useClearShortcut } from "./useClearShortcut.js";

let latest;
function Harness({ onClear }) {
  const ref = useRef(onClear);
  ref.current = onClear;
  latest = useClearShortcut(ref);
  return null;
}

beforeEach(() => {
  register.mockReset();
  unregister.mockReset();
});

describe("useClearShortcut", () => {
  it("registers the combo globally when global is true and routes to onClear", async () => {
    const onClear = vi.fn();
    render(<Harness onClear={onClear} />);
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register.mock.calls[0][0]).toBe("CmdOrCtrl+K");
    const handler = register.mock.calls[0][1];
    handler({ state: "Pressed" });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("unregisters while capturing and re-registers afterwards", async () => {
    render(<Harness onClear={vi.fn()} />);
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));

    await act(async () => {
      latest.setClearCapturing(true);
    });
    await waitFor(() => expect(unregister).toHaveBeenCalled());

    register.mockClear();
    await act(async () => {
      latest.setClearCapturing(false);
    });
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
  });
});
