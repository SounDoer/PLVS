import { Copy, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  BUILTIN_LOUDNESS_PROFILES,
  LOUDNESS_PROFILE_OFF,
  builtinSelectionId,
  userSelectionId,
} from "@/lib/loudnessProfileCatalog.js";
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
  const { active, document, userProfiles, draftBlocksLibraryActions } = profile;

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
          onClick={profile.selectOff}
          disabled={blocked}
          className={cn(ROW_BUTTON_CLASS, blockedClass)}
        >
          <ActiveDot active={active === LOUDNESS_PROFILE_OFF} />
          <span className="min-w-0 flex-1 truncate">Off</span>
        </button>
      </div>

      <p className={GROUP_LABEL_CLASS}>Built-in</p>
      {BUILTIN_LOUDNESS_PROFILES.map((builtin) => {
        const selection = builtinSelectionId(builtin.id);
        return (
          <div key={builtin.id} className={cn(ROW_CLASS, "group")}>
            <button
              type="button"
              aria-label={`Use ${builtin.name}`}
              onClick={() => profile.select(selection)}
              disabled={blocked}
              className={cn(ROW_BUTTON_CLASS, blockedClass)}
            >
              <ActiveDot active={active === selection} />
              <span className="min-w-0 flex-1 truncate">{builtin.name}</span>
              <span className="shrink-0 text-muted-foreground">{builtin.referenceLufs} LUFS</span>
            </button>
            <button
              type="button"
              aria-label={`Duplicate ${builtin.name}`}
              title="Duplicate to edit"
              onClick={() => profile.beginDuplicate(builtin.id)}
              disabled={blocked}
              className={cn(ICON_BUTTON_CLASS, blockedClass, "mr-1.5")}
            >
              <Copy className="size-[length:var(--ui-icon-management-action)]" />
            </button>
          </div>
        );
      })}

      {userProfiles.length > 0 ? <p className={GROUP_LABEL_CLASS}>Yours</p> : null}
      {userProfiles.map((entry) => {
        const selection = userSelectionId(entry.id);
        return (
          <div key={entry.id} className={cn(ROW_CLASS, "group")}>
            <button
              type="button"
              aria-label={`Use ${entry.name}`}
              onClick={() => profile.select(selection)}
              disabled={blocked}
              className={cn(ROW_BUTTON_CLASS, blockedClass)}
            >
              <ActiveDot active={active === selection} />
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
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
            <button
              type="button"
              aria-label={`Delete ${entry.name}`}
              onClick={() => profile.removeUser(entry.id)}
              disabled={blocked}
              className={cn(ICON_BUTTON_CLASS, blockedClass, "mr-1.5")}
            >
              <Trash2 className="size-[length:var(--ui-icon-management-action)]" />
            </button>
          </div>
        );
      })}

      <div className={ROW_CLASS}>
        <button
          type="button"
          aria-label="New Loudness Profile"
          onClick={profile.beginCreate}
          disabled={blocked}
          className={cn(ROW_BUTTON_CLASS, blockedClass)}
        >
          <Plus className="size-[length:var(--ui-icon-management-action)] text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">New profile</span>
        </button>
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

      {document ? (
        <p className="border-t border-border/40 px-2 py-1.5 text-[length:var(--ui-fs-caption)] leading-snug text-muted-foreground">
          Delivery reference, not a certification. Dialogue metrics use on-device detection.
        </p>
      ) : null}
    </>
  );
}
