import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "../ui/sheet";
import { IconAction } from "../ui/icon-action";

const HEADER_CLASS =
  "flex shrink-0 items-center justify-between border-b border-border px-[var(--ui-drawer-pad)] py-2";
const SCROLL_CLASS = "min-h-0 flex-1 overflow-y-auto p-[var(--ui-drawer-pad)]";

/** Keeps the existing normal-window Sheet framing and exit animation. */
export function SettingsSheetFrame({
  open,
  bodyVisible,
  onOpenChange,
  onExitComplete,
  confirmation,
  children,
}) {
  const reduceMotion = useReducedMotion();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideClose
        aria-describedby={undefined}
        className="settings-sheet gap-0 overflow-hidden border-border bg-card p-0"
      >
        <div data-settings-header className={HEADER_CLASS}>
          <SheetTitle className="text-[length:var(--ui-fs-panel-title)]">Settings</SheetTitle>
          <SheetClose asChild>
            <IconAction aria-label="Close settings" className="p-1">
              <X className="size-[length:var(--ui-icon-shell-action)]" />
            </IconAction>
          </SheetClose>
        </div>
        <AnimatePresence onExitComplete={onExitComplete}>
          {bodyVisible ? (
            <motion.div
              key="settings-inner"
              data-settings-scroll
              className={SCROLL_CLASS}
              initial={reduceMotion ? false : { opacity: 0, x: 18 }}
              animate={{ opacity: 1, x: 0 }}
              exit={
                reduceMotion
                  ? { opacity: 1 }
                  : { opacity: 0, x: 14, transition: { duration: 0.12, ease: "easeIn" } }
              }
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { type: "spring", stiffness: 420, damping: 36, mass: 0.35 }
              }
            >
              {children}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </SheetContent>
      {confirmation}
    </Sheet>
  );
}

/** A stable viewport for the same content in a native Settings window. Blur is not dismissal. */
export function SettingsWindowFrame({
  open,
  bodyVisible,
  onOpenChange,
  onExitComplete,
  confirmation,
  children,
}) {
  useEffect(() => {
    if (open && !bodyVisible) onExitComplete();
  }, [bodyVisible, onExitComplete, open]);
  if (!open) return null;
  return (
    <>
      <section
        role="dialog"
        aria-label="Settings"
        className="flex h-screen min-h-0 flex-col overflow-hidden bg-card text-foreground [container-type:inline-size]"
      >
        <header data-settings-header className={HEADER_CLASS}>
          <h1 className="text-[length:var(--ui-fs-panel-title)]">Settings</h1>
          <IconAction
            aria-label="Close settings"
            className="p-1"
            onClick={() => onOpenChange(false)}
          >
            <X className="size-[length:var(--ui-icon-shell-action)]" />
          </IconAction>
        </header>
        {bodyVisible ? (
          <div data-settings-scroll className={SCROLL_CLASS}>
            {children}
          </div>
        ) : null}
      </section>
      {confirmation}
    </>
  );
}
