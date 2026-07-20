/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { LoudnessProfilePopoverContent } from "./LoudnessProfilePopover.jsx";
import { LoudnessProfileProvider, useLoudnessProfile } from "../hooks/LoudnessProfileContext.jsx";
import { settingsStore } from "../persistence/index.js";
import { LOUDNESS_PROFILE_CUSTOM, LOUDNESS_PROFILE_OFF } from "../lib/loudnessProfileCatalog.js";

const DEFAULT_VISIBLE = ["momentary", "shortTerm", "integrated"];

afterEach(() => settingsStore.reset());

/// Renders the popover against the real hook, so a click has to survive the whole
/// state -> persistence -> re-render path rather than just calling a spy.
function renderPopover({ stats } = {}) {
  // The hook lives inside the popover's own tree, not beside it: one provider instance means the
  // profile the test drives and the profile the popover renders are the same state.
  const hook = { result: { current: null } };
  function Harness() {
    hook.result.current = useLoudnessProfile();
    return <LoudnessProfilePopoverContent profile={hook.result.current} stats={stats} />;
  }
  const tree = (
    <LoudnessProfileProvider>
      <Harness />
    </LoudnessProfileProvider>
  );
  const view = render(tree);
  return { hook, rerender: () => view.rerender(tree) };
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
  // Duplicating opens an editor draft and writes nothing: the selection is still whatever it was,
  // and the library is untouched until Save. Where the draft lands is covered under
  // "editor entry points".
  it("duplicates a built-in without touching the selection or the library", () => {
    const { hook } = renderPopover();
    fireEvent.click(screen.getByLabelText("Duplicate EBU R128 S1"));

    expect(hook.result.current.active).toBe(LOUDNESS_PROFILE_OFF);
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

  /// Commit is on blur, so every case here has to type *and* leave the field.
  function editReference(value) {
    const input = screen.getByLabelText("Loudness Profile reference");
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
    return input;
  }

  it("edits the reference of the custom draft", () => {
    const { hook, rerender } = renderPopover();
    fireEvent.click(screen.getByLabelText("Use custom Loudness Profile"));
    rerender();

    editReference("-16");
    expect(hook.result.current.referenceLufs).toBe(-16);
  });

  it("moves the anchor target with the reference", () => {
    const { hook, rerender } = renderPopover();
    fireEvent.click(screen.getByLabelText("Use custom Loudness Profile"));
    rerender();

    editReference("-16");
    // The line and the value Stats judges against are one number; -16 must not draw at -16 and
    // still fail everything that is not -23.
    expect(hook.result.current.document.metrics.integrated.target).toBe(-16);
  });

  it("does not read a cleared field as 0 LUFS", () => {
    const { hook, rerender } = renderPopover();
    fireEvent.click(screen.getByLabelText("Use custom Loudness Profile"));
    rerender();

    const input = editReference("");
    expect(hook.result.current.referenceLufs).toBe(-23);
    expect(input.value).toBe("-23");
  });

  it("does not commit the intermediate values of a typed negative number", () => {
    const { hook, rerender } = renderPopover();
    fireEvent.click(screen.getByLabelText("Use custom Loudness Profile"));
    rerender();

    const input = screen.getByLabelText("Loudness Profile reference");
    for (const step of ["", "-", "-1", "-14"]) {
      fireEvent.change(input, { target: { value: step } });
      expect(hook.result.current.referenceLufs).toBe(-23);
    }
    fireEvent.blur(input);
    expect(hook.result.current.referenceLufs).toBe(-14);
  });

  it("snaps back when the value is outside the accepted window", () => {
    const { hook, rerender } = renderPopover();
    fireEvent.click(screen.getByLabelText("Use custom Loudness Profile"));
    rerender();

    editReference("12");
    expect(hook.result.current.referenceLufs).toBe(-23);
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

  // The popover only asks; which ids each Stats surface ends up with is the caller's business,
  // because every surface keeps its own order and has to be appended to separately.
  it("hands the fulfill decision to the caller", () => {
    const onShowMissing = vi.fn();
    const { rerender } = renderPopover({
      stats: { visibleIds: DEFAULT_VISIBLE, onShowMissing },
    });
    fireEvent.click(screen.getByLabelText("Use EBU R128"));
    rerender();
    fireEvent.click(screen.getByRole("button", { name: "Show missing" }));

    expect(onShowMissing).toHaveBeenCalledTimes(1);
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

describe("editor entry points", () => {
  it("opens the editor on a user profile", () => {
    const { hook, rerender } = renderPopover();
    act(() => hook.result.current.beginCreate());
    act(() => hook.result.current.editDraft((d) => ({ ...d, name: "Mine" })));
    act(() => hook.result.current.saveDraft());
    rerender();

    // "Edit Mine" beside "Rename Mine" reads as two words for the same thing; the row says which
    // is which only in a title attribute, which a screen reader need not announce.
    fireEvent.click(screen.getByLabelText("Edit Mine rules"));
    expect(hook.result.current.draft.editingId).toBe(hook.result.current.userProfiles[0].id);
  });

  it("opens the editor on a duplicate of a built-in", () => {
    const { hook } = renderPopover();
    fireEvent.click(screen.getByLabelText("Duplicate EBU R128 S1"));

    expect(hook.result.current.draft.document.basedOn).toBe("ebu-r128-s1");
    expect(hook.result.current.draft.editingId).toBe(null);
  });

  it("opens the editor on a new profile", () => {
    const { hook } = renderPopover();
    fireEvent.click(screen.getByRole("button", { name: "New Loudness Profile" }));

    expect(hook.result.current.draft.editingId).toBe(null);
    expect(hook.result.current.draft.document.metrics.integrated).toBeTruthy();
  });
});

describe("a dirty draft blocks the library", () => {
  /// Saves one profile, then opens a dirty draft on top of it.
  function withDirtyDraft() {
    const view = renderPopover();
    act(() => view.hook.result.current.beginCreate());
    act(() => view.hook.result.current.editDraft((d) => ({ ...d, name: "Mine" })));
    act(() => view.hook.result.current.saveDraft());
    act(() => view.hook.result.current.beginCreate());
    act(() => view.hook.result.current.editDraft((d) => ({ ...d, name: "Half typed" })));
    view.rerender();
    return view;
  }

  const blocked = () => [
    screen.getByLabelText("Use no Loudness Profile"),
    screen.getByLabelText("Use EBU R128"),
    screen.getByLabelText("Duplicate EBU R128 S1"),
    screen.getByLabelText("Use Mine"),
    screen.getByLabelText("Edit Mine rules"),
    screen.getByLabelText("Delete Mine"),
    screen.getByLabelText("New Loudness Profile"),
  ];

  it("disables the rows that would discard it", () => {
    withDirtyDraft();
    for (const button of blocked()) expect(button.disabled).toBe(true);
    expect(screen.getByText("Finish editing to switch profiles.")).toBeTruthy();
  });

  it("leaves Rename alone, which destroys nothing", () => {
    withDirtyDraft();
    expect(screen.getByLabelText("Rename Mine").disabled).toBe(false);
  });

  it("re-enables everything once the draft is put away", () => {
    const { hook, rerender } = withDirtyDraft();
    act(() => hook.result.current.cancelDraft());
    rerender();

    for (const button of blocked()) expect(button.disabled).toBe(false);
    expect(screen.queryByText("Finish editing to switch profiles.")).toBeNull();
  });
});

describe("current selection label", () => {
  const label = () => document.querySelector("[data-loudness-profile-selection]").textContent;

  it("names Off at cold start", () => {
    renderPopover();
    expect(label()).toBe("Off");
  });

  it("names the active built-in", () => {
    const { rerender } = renderPopover();
    fireEvent.click(screen.getByLabelText("Use EBU R128 Live"));
    rerender();
    expect(label()).toBe("EBU R128 Live");
  });

  it("names the scratch pad rather than the draft inside it", () => {
    const { rerender } = renderPopover();
    fireEvent.click(screen.getByLabelText("Use custom Loudness Profile"));
    rerender();
    expect(label()).toBe("Custom · unsaved");
  });

  it("names a saved profile", () => {
    const { rerender } = renderPopover();
    fireEvent.click(screen.getByLabelText("Use custom Loudness Profile"));
    rerender();
    fireEvent.change(screen.getByLabelText("Save custom profile as"), {
      target: { value: "My Show" },
    });
    fireEvent.click(screen.getByText("Save"));
    rerender();
    expect(label()).toBe("My Show");
  });
});
