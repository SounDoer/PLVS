import { useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import { Button } from "./ui/button";
import { MenuRow } from "./ui/row";
import { cn } from "../lib/utils.js";
import {
  formatCodec,
  formatLanguage,
  formatSampleRate,
  formatChannelLayout,
} from "../lib/fileAnalysisDisplay.js";
import { useUiSurface } from "../uiNavigation/UiNavigationContext.jsx";

export function FileAudioTrackDialog({ selection, onConfirm, onCancel }) {
  return selection ? (
    <TrackSelection
      key={selection.probe.path}
      selection={selection}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  ) : null;
}

function TrackSelection({ selection, onConfirm, onCancel }) {
  const { probe } = selection;
  const [index, setIndex] = useState(probe.selectedTrack.index);
  useUiSurface({
    active: true,
    kind: "fileAudioTrack",
    origin: "event",
    developmentFixture: {
      none: "The audio track picker follows probing a user-selected multitrack file.",
    },
    blocking: false,
    dismissible: true,
    supportedActions: ["cancel"],
    target: {},
    choices: [
      { id: "cancel", label: "Cancel", run: onCancel },
      ...probe.audioTracks.map((track) => ({
        id: `track:${track.index}`,
        label: [`Track ${track.index}`, formatLanguage(track.language), track.title]
          .filter(Boolean)
          .join(" · "),
        run: () => onConfirm(track.index),
      })),
    ],
    onCancel,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent
        aria-describedby="file-audio-track-description"
        overlayProps={{ onClick: onCancel }}
      >
        <DialogTitle>Select Audio Track</DialogTitle>
        <DialogDescription id="file-audio-track-description" className="break-words">
          {probe.fileName}
        </DialogDescription>
        <div
          role="radiogroup"
          aria-label="Audio Track"
          className="my-3 min-h-0 overflow-y-auto"
          onKeyDown={(event) => {
            if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
            event.preventDefault();
            const position = probe.audioTracks.findIndex((track) => track.index === index);
            const next =
              probe.audioTracks[
                (position + (event.key === "ArrowDown" ? 1 : -1) + probe.audioTracks.length) %
                  probe.audioTracks.length
              ].index;
            setIndex(next);
            /** @type {HTMLButtonElement | null} */ (
              event.currentTarget.querySelector(`[data-ui-target="file-track:${next}"]`)
            )?.focus();
          }}
        >
          {probe.audioTracks.map((track) => (
            <MenuRow
              key={track.index}
              role="radio"
              aria-checked={index === track.index}
              onClick={() => setIndex(track.index)}
              data-ui-target={`file-track:${track.index}`}
            >
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full border",
                  index === track.index ? "border-primary bg-primary" : "border-muted-foreground"
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-foreground">
                  {[`Track ${track.index}`, formatLanguage(track.language), track.title]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="block truncate text-muted-foreground">
                  {[
                    formatCodec(track.codec),
                    formatSampleRate(track.sampleRateHz),
                    formatChannelLayout(track.channels, track.channelLayout),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </MenuRow>
          ))}
        </div>
        <DialogFooter divided>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(index)}>Analyze</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
