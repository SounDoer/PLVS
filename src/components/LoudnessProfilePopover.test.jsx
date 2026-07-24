/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LoudnessProfilePopoverContent } from "./LoudnessProfilePopover.jsx";
import { LOUDNESS_PROFILE_OFF, profileSelectionId } from "../lib/loudnessProfileCatalog.js";

const DEFAULT_VISIBLE = ["momentary", "shortTerm", "integrated"];

const STARTER = {
  id: "starter",
  name: "I −23 ±0.5 · TP ≤ −1",
  referenceLufs: -23,
  rules: [
    { metricId: "integrated", op: ">", value: -22.5, severity: "fail" },
    { metricId: "truePeak", op: ">", value: -1, severity: "fail" },
  ],
};

const SAVED = {
  id: "saved",
  name: "My Show",
  referenceLufs: -14,
  rules: [{ metricId: "dialogueIntegrated", op: "<", value: -16, severity: "warn" }],
};

function makeController(overrides = {}) {
  return {
    active: LOUDNESS_PROFILE_OFF,
    document: null,
    profiles: [STARTER, SAVED],
    draftBlocksLibraryActions: false,
    select: vi.fn(),
    selectOff: vi.fn(),
    beginEdit: vi.fn(),
    beginCreate: vi.fn(),
    removeProfile: vi.fn(),
    ...overrides,
  };
}

function renderPopover({ overrides, stats, showTitle = true } = {}) {
  const profile = makeController(overrides);
  const view = render(
    <LoudnessProfilePopoverContent profile={profile} stats={stats} showTitle={showTitle} />
  );
  return { profile, ...view };
}

describe("LoudnessProfilePopoverContent listing", () => {
  it("lists Off, profiles in controller order, and Add Profile", () => {
    renderPopover();

    const labels = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"))
      .filter((label) => label?.startsWith("Use ") || label === "Add Loudness Profile");
    expect(labels).toEqual([
      "Use no Loudness Profile",
      `Use ${STARTER.name}`,
      `Use ${SAVED.name}`,
      "Add Loudness Profile",
    ]);
  });

  it("shows no grouping labels, duplicate action, or right-side reference LUFS", () => {
    renderPopover();

    expect(screen.queryByText("Built-in")).toBeNull();
    expect(screen.queryByText("Yours")).toBeNull();
    expect(screen.queryByText("-23 LUFS")).toBeNull();
    expect(screen.queryByLabelText(/Duplicate/)).toBeNull();
  });

  it("optionally hides the title", () => {
    renderPopover({ showTitle: false });
    expect(screen.queryByText("Loudness Profile")).toBeNull();
  });

  it("marks the active profile and selects rows by profile selection id", () => {
    const { profile } = renderPopover({
      overrides: { active: profileSelectionId(SAVED.id), document: SAVED },
    });
    const row = screen.getByRole("button", { name: `Use ${SAVED.name}` });

    expect(row.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.getByRole("button", { name: `Use ${STARTER.name}` }).getAttribute("aria-pressed")
    ).toBe("false");
    expect(
      screen.getByRole("button", { name: "Use no Loudness Profile" }).getAttribute("aria-pressed")
    ).toBe("false");
    fireEvent.click(row);
    expect(profile.select).toHaveBeenCalledWith(profileSelectionId(SAVED.id));
  });

  it("selects Off and starts a new profile", () => {
    const { profile } = renderPopover();

    fireEvent.click(screen.getByLabelText("Use no Loudness Profile"));
    fireEvent.click(screen.getByLabelText("Add Loudness Profile"));

    expect(profile.selectOff).toHaveBeenCalledTimes(1);
    expect(profile.beginCreate).toHaveBeenCalledTimes(1);
  });
});

describe("LoudnessProfilePopoverContent editing", () => {
  it("offers the same edit and delete actions for starter and saved profiles", () => {
    renderPopover();

    for (const entry of [STARTER, SAVED]) {
      expect(screen.getByLabelText(`Edit ${entry.name} rules`)).toBeTruthy();
      expect(screen.getByLabelText(`Delete ${entry.name}`)).toBeTruthy();
    }
  });

  it("opens the selected profile in the editor", () => {
    const { profile } = renderPopover();

    fireEvent.click(screen.getByLabelText(`Edit ${STARTER.name} rules`));
    fireEvent.click(screen.getByLabelText(`Edit ${SAVED.name} rules`));

    expect(profile.beginEdit).toHaveBeenNthCalledWith(1, STARTER.id);
    expect(profile.beginEdit).toHaveBeenNthCalledWith(2, SAVED.id);
  });

  it("arms deletion first and cancellation does not delete", () => {
    const { profile } = renderPopover();

    fireEvent.click(screen.getByLabelText(`Delete ${SAVED.name}`));
    expect(profile.removeProfile).not.toHaveBeenCalled();
    expect(screen.getByLabelText(`Confirm delete ${SAVED.name}`)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(`Cancel delete ${SAVED.name}`));

    expect(profile.removeProfile).not.toHaveBeenCalled();
    expect(screen.getByLabelText(`Delete ${SAVED.name}`)).toBeTruthy();
  });

  it("deletes only after inline confirmation", () => {
    const { profile } = renderPopover();

    fireEvent.click(screen.getByLabelText(`Delete ${STARTER.name}`));
    fireEvent.click(screen.getByLabelText(`Confirm delete ${STARTER.name}`));

    expect(profile.removeProfile).toHaveBeenCalledWith(STARTER.id);
  });
});

describe("LoudnessProfilePopoverContent missing stats", () => {
  it("says nothing when the profile is Off", () => {
    renderPopover({ stats: { visibleIds: DEFAULT_VISIBLE, onShowMissing: vi.fn() } });
    expect(screen.queryByText(/Missing stats/)).toBeNull();
  });

  it("names the missing rows once a profile needs them", () => {
    renderPopover({
      overrides: { active: profileSelectionId(STARTER.id), document: STARTER },
      stats: { visibleIds: DEFAULT_VISIBLE, onShowMissing: vi.fn() },
    });

    expect(screen.getByText(/Missing stats: True Peak Max/)).toBeTruthy();
  });

  it("never mentions dialogue gating, only the rows themselves", () => {
    renderPopover({
      overrides: { active: profileSelectionId(SAVED.id), document: SAVED },
      stats: { visibleIds: DEFAULT_VISIBLE, onShowMissing: vi.fn() },
    });

    const copy = screen.getByText(/Missing stats/).textContent;
    expect(copy).toContain("Dialogue Integrated");
    expect(copy).not.toMatch(/gating|sidechain|VAD/i);
  });

  // The popover only asks; which ids each Stats surface ends up with is the caller's business,
  // because every surface keeps its own order and has to be appended to separately.
  it("hands the fulfill decision to the caller", () => {
    const onShowMissing = vi.fn();
    renderPopover({
      overrides: { active: profileSelectionId(STARTER.id), document: STARTER },
      stats: { visibleIds: DEFAULT_VISIBLE, onShowMissing },
    });
    fireEvent.click(screen.getByRole("button", { name: "Show missing" }));

    expect(onShowMissing).toHaveBeenCalledTimes(1);
  });

  it("drops the affordance when everything it needs is already shown", () => {
    renderPopover({
      overrides: { active: profileSelectionId(STARTER.id), document: STARTER },
      stats: { visibleIds: [...DEFAULT_VISIBLE, "truePeak"], onShowMissing: vi.fn() },
    });

    expect(screen.queryByText(/Missing stats/)).toBeNull();
  });

  it("stays silent when there is no Stats panel to fulfill into", () => {
    renderPopover({ overrides: { active: profileSelectionId(SAVED.id), document: SAVED } });

    expect(screen.queryByText(/Missing stats/)).toBeNull();
  });
});

describe("a dirty draft blocks the library", () => {
  const actions = () => [
    screen.getByLabelText("Use no Loudness Profile"),
    screen.getByLabelText(`Use ${STARTER.name}`),
    screen.getByLabelText(`Edit ${STARTER.name} rules`),
    screen.getByLabelText(`Delete ${STARTER.name}`),
    screen.getByLabelText(`Use ${SAVED.name}`),
    screen.getByLabelText(`Edit ${SAVED.name} rules`),
    screen.getByLabelText(`Delete ${SAVED.name}`),
    screen.getByLabelText("Add Loudness Profile"),
  ];

  it("disables the rows that would discard it", () => {
    renderPopover({ overrides: { draftBlocksLibraryActions: true } });

    for (const button of actions()) expect(button.disabled).toBe(true);
    expect(screen.getByText("Finish editing to switch profiles.")).toBeTruthy();
  });

  it("leaves every action enabled without a dirty draft", () => {
    renderPopover();

    for (const button of actions()) expect(button.disabled).toBe(false);
    expect(screen.queryByText("Finish editing to switch profiles.")).toBeNull();
  });
});

describe("current selection indicator", () => {
  it("does not repeat the active profile name above the list", () => {
    renderPopover();
    expect(document.querySelector("[data-loudness-profile-selection]")).toBeNull();
  });
});
