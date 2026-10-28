import { cn } from "@/lib/utils";

/** Shared inline speech-activity indicator for workspace and Dock Stats. */
export function DialogueActivityDot({ active, testId = "dialogue-active-dot" }) {
  return (
    <span
      data-testid={testId}
      data-active={active ? "true" : "false"}
      className={cn(
        "inline-block h-1.5 w-1.5 shrink-0 self-center rounded-full border",
        active ? "border-foreground bg-foreground" : "border-muted-foreground bg-transparent"
      )}
    />
  );
}
