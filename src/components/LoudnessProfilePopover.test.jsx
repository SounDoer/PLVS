/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { LoudnessProfilePopoverContent } from "./LoudnessProfilePopover.jsx";
import { useLoudnessProfile } from "../hooks/useLoudnessProfile.js";
import { settingsStore } from "../persistence/index.js";
import { LOUDNESS_PROFILE_CUSTOM, LOUDNESS_PROFILE_OFF } from "../lib/loudnessProfileCatalog.js";

const DEFAULT_VISIBLE = ["momentary", "shortTerm", "integrated"];

afterEach(() => settingsStore.reset());

/// Renders the popover against the real hook, so a click has to survive the whole
/// state -> persistence -> re-render path rather than just calling a spy.
function renderPopover({ stats } = {}) {
  const hook = renderHook(() => useLoudnessProfile());
  const view = render(
    <LoudnessProfilePopoverContent profile={hook.result.current} stats={stats} />
  );
  const rerender = () =>
    view.rerender(<LoudnessProfilePopoverContent profile={hook.result.current} stats={stats} />);
  return { hook, rerender };
}

describe("LoudnessProfilePopoverContent listing", () => {
  it("lists Off, Custom and every built-in", () => {
    renderPopover();

    expect(screen.getByLabelText("Use no Loudness Profile")).toBeTruthy();
    expect(screen.getByLabelText("Use custom Loudness Profile")).toBeTruthy();
    expect(screen.getByLabelText("Use EBU R128")).toBeTruthy();
    expect(screen.getByLabelText("Use EBU R128 Live")).toBeTruthy();
    expect(screen.getByLabelText("Use EBU R128 S1")).toBeTruthy();
    expect(screen.getByLabelText("Use ATSC A/85")).toBeTruthy();
    expect(screen.getByLabelText("Use Streaming −14")).toBeTruthy();
  });

  it("shows each built-in's reference so the list is readable without opening anything", () => {
    renderPopover();
    expect(screen.getByLabelText("Use ATSC A/85").textContent).toContain("-24 LUFS");
  });

  it("has no user group until something is saved", () => {
    renderPopover();
    expect(screen.queryByText("Yours")).toBeNull();
  });

  it("applies a built-in on row click", () => {
    const { hook } = renderPopover();
    fireEvent.click(screen.getByLabelText("Use EBU R128 S1"));
    expect(hook.result.current.referenceLufs).toBe(-23);
    expect(hook.result.current.document.name).toBe("EBU R128 S1");
  });

  it("returns to Off on row click", () => {
    const { hook, rerender } = renderPopover();
    fireEvent.click(screen.getByLabelText("Use EBU R128"));
    rerender();
    fireEvent.click(screen.getByLabelText("Use no Loudness Profile"));
    expect(hook.result.current.active).toBe(LOUDNESS_PROFILE_OFF);
    expect(hook.result.current.referenceLufs).toBe(null);
  });

  it("carries the honesty note whenever a profile is active", () => {
    const { rerender } = renderPopover();
    expect(screen.queryByText(/not a certification/i)).toBeNull();

    fireEvent.click(screen.getByLabelText("Use ATSC A/85"));
    rerender();
    expect(screen.getByText(/not a certification/i)).toBeTruthy();
  });
});

describe("LoudnessProfilePopoverContent editing", () => {
  it("duplicates a built-in into the custom scratch pad", () => {
    const { hook } = renderPopover();
    fireEvent.click(screen.getByLabelText("Duplicate EBU R128 S1"));

    expect(hook.result.current.active).toBe(LOUDNESS_PROFILE_CUSTOM);
    expect(hook.result.current.document.basedOn).toBe("ebu-r128-s1");
    expect(hook.result.current.userProfiles).toEqual([]);
  });

  it("offers Save as only while Custom is active", () => {
    const { rerender } = renderPopover();
    expect(screen.queryByLabelText("Save custom profile as")).toBeNull();

    fireEvent.click(screen.getByLabelText("Use custom Loudness Profile"));
    rerender();
    expect(screen.getByLabelText("Save custom profile as")).toBeTruthy();
  });

  it("saves the draft under a name and lists it under Yours", () => {
    const { hook, rerender } = renderPopover();
    fireEvent.click(screen.getByLabelText("Use custom Loudness Profile"));
    rerender();

    fireEvent.change(screen.getByLabelText("Save custom profile as"), {
      target: { value: "My Show" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    rerender();

    expect(hook.result.current.document.name).toBe("My Show");
    expect(screen.getByText("Yours")).toBeTruthy();
    expect(screen.getByLabelText("Use My Show")).toBeTruthy();
  });

  it("refuses to save a blank name", () => {
    const { hook, rerender } = renderPopover();
    fireEvent.click(screen.getByLabelText("Use custom Loudness Profile"));
    rerender();

    fireEvent.change(screen.getByLabelText("Save custom profile as"), {
      target: { value: "   " },
    });
    expect(screen.getByRole("button", { name: "Save" }).disabled).toBe(true);
    expect(hook.result.current.userProfiles).toEqual([]);
  });

  it("renames a saved profile inline", () => {
    const { hook, rerender } = renderPopover();
    act(() => hook.result.current.selectUnsavedCustom());
    act(() => hook.result.current.saveCustomAs("Before"));
    rerender();

    fireEvent.click(screen.getByLabelText("Rename Before"));
    rerender();
    fireEvent.change(screen.getByLabelText("Rename Before"), { target: { value: "After" } });
    fireEvent.click(screen.getByLabelText("Save rename"));
    rerender();

    expect(hook.result.current.document.name).toBe("After");
  });

  it("deletes a saved profile and falls back to Off", () => {
    const { hook, rerender } = renderPopover();
    act(() => hook.result.current.selectUnsavedCustom());
    act(() => hook.result.current.saveCustomAs("Doomed"));
    rerender();

    fireEvent.click(screen.getByLabelText("Delete Doomed"));
    expect(hook.result.current.userProfiles).toEqual([]);
    expect(hook.result.current.active).toBe(LOUDNESS_PROFILE_OFF);
  });

  it("edits the reference of the custom draft", () => {
    const { hook, rerender } = renderPopover();
    fireEvent.click(screen.getByLabelText("Use custom Loudness Profile"));
    rerender();

    fireEvent.change(screen.getByLabelText("Loudness Profile reference"), {
      target: { value: "-16" },
    });
    expect(hook.result.current.referenceLufs).toBe(-16);
  });

  it("shows a built-in's reference read-only", () => {
    const { rerender } = renderPopover();
    fireEvent.click(screen.getByLabelText("Use EBU R128"));
    rerender();

    expect(screen.getByLabelText("Loudness Profile reference").readOnly).toBe(true);
  });
});

describe("LoudnessProfilePopoverContent missing stats", () => {
  it("says nothing when the profile is Off", () => {
    renderPopover({ stats: { visibleIds: DEFAULT_VISIBLE, onShowMissing: vi.fn() } });
    expect(screen.queryByText(/Missing stats/)).toBeNull();
  });

  it("names the missing rows once a profile needs them", () => {
    const { rerender } = renderPopover({
      stats: { visibleIds: DEFAULT_VISIBLE, onShowMissing: vi.fn() },
    });
    fireEvent.click(screen.getByLabelText("Use EBU R128"));
    rerender();

    expect(screen.getByText(/Missing stats: True Peak Max/)).toBeTruthy();
  });

  it("never mentions dialogue gating, only the rows themselves", () => {
    const { rerender } = renderPopover({
      stats: { visibleIds: DEFAULT_VISIBLE, onShowMissing: vi.fn() },
    });
    fireEvent.click(screen.getByLabelText("Use ATSC A/85"));
    rerender();

    const copy = screen.getByText(/Missing stats/).textContent;
    expect(copy).toContain("Dialogue Integrated");
    expect(copy).not.toMatch(/gating|sidechain|VAD/i);
  });

  it("appends the missing ids without reordering the existing ones", () => {
    const onShowMissing = vi.fn();
    const { rerender } = renderPopover({
      stats: { visibleIds: DEFAULT_VISIBLE, onShowMissing },
    });
    fireEvent.click(screen.getByLabelText("Use EBU R128"));
    rerender();
    fireEvent.click(screen.getByRole("button", { name: "Show missing" }));

    expect(onShowMissing).toHaveBeenCalledWith([...DEFAULT_VISIBLE, "truePeak"]);
  });

  it("drops the affordance when everything it needs is already shown", () => {
    const { rerender } = renderPopover({
      stats: { visibleIds: [...DEFAULT_VISIBLE, "truePeak"], onShowMissing: vi.fn() },
    });
    fireEvent.click(screen.getByLabelText("Use EBU R128"));
    rerender();

    expect(screen.queryByText(/Missing stats/)).toBeNull();
  });

  it("stays silent when there is no Stats panel to fulfill into", () => {
    const { rerender } = renderPopover();
    fireEvent.click(screen.getByLabelText("Use ATSC A/85"));
    rerender();

    expect(screen.queryByText(/Missing stats/)).toBeNull();
  });
});
