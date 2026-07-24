import { SlidersHorizontal, Trash2 } from "lucide-react";
import { InlineConfirm } from "@/components/InlineConfirm.jsx";
import { AddButton } from "@/components/AddButton";
import { TruncatingLabel } from "@/components/TruncatingLabel.jsx";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LOUDNESS_PROFILE_OFF, profileSelectionId } from "@/lib/loudnessProfileCatalog.js";
import { listMissingPreferredMetrics } from "@/lib/loudnessProfileMissing.js";
import { STATS_META } from "@/lib/statsCatalog.js";

const ROW_CLASS =
  "flex items-center gap-2 rounded text-[length:var(--ui-fs-control)] transition-colors hover:bg-muted/50 focus-within:bg-muted/50";

const ROW_BUTTON_CLASS =
  "flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const ICON_BUTTON_CLASS =
  "rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100";

const GROUP_LABEL_CLASS =
  "px-2 pt-2 pb-1 text-[length:var(--ui-fs-caption)] font-semibold tracking-wide text-muted-foreground";

function ActiveDot({ active }) {
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        active ? "bg-primary" : "bg-muted-foreground/20"
      )}
    />
  );
}

/**
 * Popover body for Loudness Profile switching and management.
 *
 * `profile` is the useLoudnessProfile() controller. `stats` is optional and carries the union of
 * ids currently visible across Stats panels plus a way to add to them; without it the missing
 * affordance simply does not appear, which is the correct behaviour when no Stats panel exists.
 */
export function LoudnessProfilePopoverContent({ profile, stats = null, showTitle = true }) {
  const { active, document, profiles, draftBlocksLibraryActions } = profile;

  // The editor panel is non-modal, so this list stays reachable while a draft is open. Everything
  // that would discard that draft is refused by the provider; showing it disabled is what makes
  // the refusal legible. Renaming now lives inside that editor, beside the name.
  const blocked = draftBlocksLibraryActions === true;
  const blockedClass = "disabled:opacity-40";

  const missingIds = stats ? listMissingPreferredMetrics(document, stats.visibleIds) : [];

  return (
    <>
      {showTitle ? <p className={GROUP_LABEL_CLASS}>Loudness Profile</p> : null}

      <div className={ROW_CLASS}>
        <button
          type="button"
          aria-label="Use no Loudness Profile"
          aria-pressed={active === LOUDNESS_PROFILE_OFF}
          onClick={profile.selectOff}
          disabled={blocked}
          className={cn(ROW_BUTTON_CLASS, blockedClass)}
        >
          <ActiveDot active={active === LOUDNESS_PROFILE_OFF} />
          <span className="min-w-0 flex-1 truncate">Off</span>
        </button>
      </div>

      {profiles.map((entry) => {
        const selection = profileSelectionId(entry.id);
        return (
          <div key={entry.id} className={cn(ROW_CLASS, "group")}>
            <button
              type="button"
              aria-label={`Use ${entry.name}`}
              aria-pressed={active === selection}
              onClick={() => profile.select(selection)}
              disabled={blocked}
              className={cn(ROW_BUTTON_CLASS, blockedClass)}
            >
              <ActiveDot active={active === selection} />
              <TruncatingLabel text={entry.name} className="min-w-0 flex-1" />
            </button>
            <button
              type="button"
              // "Edit" and "Rename" sit next to each other and read as synonyms in sequence; the
              // title that tells them apart is not reliably announced.
              aria-label={`Edit ${entry.name} rules`}
              title="Edit rules"
              onClick={() => profile.beginEdit(entry.id)}
              disabled={blocked}
              className={cn(ICON_BUTTON_CLASS, blockedClass)}
            >
              <SlidersHorizontal className="size-[length:var(--ui-icon-management-action)]" />
            </button>
            <InlineConfirm
              onConfirm={() => profile.removeProfile(entry.id)}
              confirmLabel={`Confirm delete ${entry.name}`}
              cancelLabel={`Cancel delete ${entry.name}`}
              className="mr-1.5"
              trigger={(arm) => (
                <button
                  type="button"
                  aria-label={`Delete ${entry.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    arm();
                  }}
                  disabled={blocked}
                  className={cn(ICON_BUTTON_CLASS, blockedClass, "mr-1.5")}
                >
                  <Trash2 className="size-[length:var(--ui-icon-management-action)]" />
                </button>
              )}
            />
          </div>
        );
      })}

      <div className="px-1.5 py-1">
        <AddButton
          label="Add Profile"
          aria-label="Add Loudness Profile"
          onClick={profile.beginCreate}
          disabled={blocked}
        />
      </div>

      {blocked ? (
        <p className="px-2 py-1.5 text-[length:var(--ui-fs-caption)] leading-snug text-muted-foreground">
          Finish editing to switch profiles.
        </p>
      ) : null}

      {missingIds.length > 0 ? (
        <div className="border-t border-border/40 px-2 py-1.5">
          {/* Deliberately says nothing about dialogue gating: showing those rows is what enables
              the sidechain, but that is an implementation detail, not a thing to ask the user
              to reason about. */}
          <p className="text-[length:var(--ui-fs-caption)] text-muted-foreground">
            {`Missing stats: ${missingIds.map((id) => STATS_META[id]?.label ?? id).join(", ")}`}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-1 h-7 px-2 text-[length:var(--ui-fs-control)]"
            onClick={stats.onShowMissing}
          >
            Show missing
          </Button>
        </div>
      ) : null}
    </>
  );
}
