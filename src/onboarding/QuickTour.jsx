import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "../components/ui/button.jsx";
import { IconAction } from "../components/ui/icon-action.jsx";
import { POPOVER_SURFACE_CLASS, POPOVER_TITLE_CLASS } from "../components/ui/surfaceStyles.js";
import { LAYER_FLOATING } from "../components/ui/layers.js";
import { settingsStore, flushPersistence } from "../persistence/index.js";
import { useCoordinatorRole } from "../lib/runtimeRole.js";
import { useBlockingEditors } from "../hooks/BlockingEditorsContext.jsx";
import { QUICK_TOUR_STEPS, positionTourCard, tourStepContent } from "./quickTourModel.js";

const SURFACES =
  '[data-slot="popover-content"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

function visible(element, includeTransparent = false) {
  if (
    !element ||
    !element.isConnected ||
    element.closest('[hidden], [aria-hidden="true"], [inert]')
  )
    return false;
  const rect = element.getBoundingClientRect();
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.bottom <= 0 ||
    rect.right <= 0 ||
    rect.top >= window.innerHeight ||
    rect.left >= window.innerWidth
  )
    return false;
  for (let node = element; node instanceof HTMLElement; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (
      style.visibility === "hidden" ||
      style.display === "none" ||
      (!includeTransparent && style.opacity === "0")
    )
      return false;
  }
  return true;
}

function hasOpenSurface() {
  // Opening/closing animations still occupy the UI even at their transparent endpoints.
  return [...document.querySelectorAll(SURFACES)].some((element) => visible(element, true));
}

function readTarget(name, previous) {
  if (previous?.dataset.tourTarget === name && visible(previous)) return previous;
  return (
    [...document.querySelectorAll(`[data-tour-target="${name}"]`)].find((element) =>
      visible(element)
    ) ?? null
  );
}

/**
 * An optional non-modal guide. It observes the app; all actions remain on the real controls.
 * Deliberately internal UI: no capture/store shortcuts or authoring-editor semantics.
 * @param {{ requestId?: number, running: boolean, snapshot: boolean, hasHistory: boolean,
 * sourceMode: string, docked: boolean, dockSupported: boolean, applicationsSupported: boolean,
 * settingsOpen: boolean, updateSetupPending: boolean }} props
 */
export function QuickTour({
  requestId = 0,
  running,
  snapshot,
  hasHistory,
  sourceMode,
  docked,
  dockSupported,
  applicationsSupported,
  settingsOpen,
  updateSetupPending,
}) {
  const coordinator = useCoordinatorRole();
  const initialCoordinator = useRef(coordinator);
  const { activeBlockingEditors } = useBlockingEditors();
  const [disposition, setDisposition] = useState(() => settingsStore.read().quickTour);
  const [phase, setPhase] = useState("inactive");
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [environment, setEnvironment] = useState({
    obstructed: false,
    rects: [],
    position: { left: 8, top: 8 },
  });
  const cardRef = useRef(null);
  const previousTargetRef = useRef(null);
  const lastRequestRef = useRef(0);
  const focusRequested = useRef(false);
  const settlingRef = useRef({ interrupted: false, clearSince: null });
  const titleId = useId();
  const bodyId = useId();
  const content = tourStepContent(step, {
    running,
    snapshot,
    hasHistory,
    dockSupported,
    applicationsSupported,
  });
  const supported = !docked && sourceMode === "live";
  const blocked = settingsOpen || activeBlockingEditors.length > 0;
  const refs = useRef(null);
  refs.current = { phase, supported, blocked, target: content.target, step };

  useEffect(
    () => settingsStore.subscribe(() => setDisposition(settingsStore.read().quickTour)),
    []
  );

  // Sample bounds only while a guide is present. A stable element survives panel reordering;
  // replacing/removing it re-resolves the semantic target. Canvas updates do not trigger React.
  useLayoutEffect(() => {
    if (phase === "inactive") return undefined;
    let frame;
    let lastSample = -Infinity;
    const measure = (time) => {
      const current = refs.current;
      const interrupted = !current.supported || current.blocked || hasOpenSurface();
      const settling = settlingRef.current;
      if (interrupted) {
        settling.interrupted = true;
        settling.clearSince = null;
        // Automatic return never reclaims focus from the user's controls or editor.
        if (current.phase === "active") focusRequested.current = false;
      } else if (settling.interrupted) {
        settling.clearSince ??= time;
        if (time - settling.clearSince >= 180) {
          settling.interrupted = false;
          settling.clearSince = null;
        }
      }
      const obstructed = interrupted || settling.interrupted;
      const target =
        current.phase === "active" ? readTarget(current.target, previousTargetRef.current) : null;
      previousTargetRef.current = target;
      const targets = [target];
      const rects = targets.filter(Boolean).map((element) => {
        const r = element.getBoundingClientRect();
        return {
          left: Math.max(0, r.left),
          top: Math.max(0, r.top),
          right: Math.min(window.innerWidth, r.right),
          bottom: Math.min(window.innerHeight, r.bottom),
          borderRadius: getComputedStyle(element).borderRadius,
        };
      });
      const size = cardRef.current?.getBoundingClientRect() ?? { width: 320, height: 180 };
      const position = positionTourCard(rects[0], size, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      const next = { obstructed, rects, position };
      setEnvironment((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next
      );
      if (current.phase === "waiting" && !obstructed) setPhase("active");
    };
    const sample = (time) => {
      frame = requestAnimationFrame(sample);
      if (time - lastSample < 100) return;
      lastSample = time;
      measure(time);
    };
    // Portaled menus may open without changing the tour's React props. Observe their lifetime
    // immediately; the quiet interval prevents flashes between a menu and its nested editor.
    const observer = new MutationObserver(() => measure(performance.now()));
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state", "aria-hidden", "hidden"],
    });
    sample(performance.now());
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [phase, content.target, step, blocked, supported]);

  useEffect(() => {
    if (
      phase !== "inactive" ||
      disposition !== "pending" ||
      !initialCoordinator.current ||
      !coordinator ||
      !supported ||
      blocked ||
      updateSetupPending
    )
      return;
    setPhase("invitation");
  }, [blocked, coordinator, disposition, phase, supported, updateSetupPending]);

  useEffect(() => {
    if (!requestId || lastRequestRef.current === requestId) return;
    lastRequestRef.current = requestId;
    setStep(0);
    setError("");
    focusRequested.current = true;
    setPhase("waiting");
    void record("started");
    // Settings closes through its normal path. Wait for that surface to unmount.
  }, [requestId]);

  useEffect(() => {
    if (!focusRequested.current || phase !== "active" || environment.obstructed || blocked) return;
    cardRef.current?.focus({ preventScroll: true });
    focusRequested.current = false;
  }, [phase, step, blocked, environment.obstructed]);

  async function record(value) {
    const previous = settingsStore.read().quickTour;
    setBusy(true);
    setError("");
    try {
      settingsStore.patch({ quickTour: value });
      await flushPersistence();
      setDisposition(value);
      settingsStore.notifyLocal();
      return true;
    } catch (failure) {
      settingsStore.patch({ quickTour: previous });
      setError(`Unable to save tour preference: ${String(failure)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function close(value = "dismissed") {
    if (busy) return;
    const hadFocus = cardRef.current?.contains(document.activeElement);
    if (!(await record(value))) return;
    setPhase("inactive");
    if (hadFocus) readTarget("transport", null)?.focus({ preventScroll: true });
  }

  async function begin() {
    if (busy || !(await record("started"))) return;
    setStep(0);
    focusRequested.current = true;
    setPhase("active");
  }

  if (phase === "inactive" || phase === "waiting" || !supported) return null;
  const obstructed = blocked || environment.obstructed || hasOpenSurface();
  // Return automatically to this same step once the user's menu/editor interaction has settled.
  if (obstructed || (phase === "invitation" && (!supported || updateSetupPending))) return null;

  const invitation = phase === "invitation";
  const missing = !invitation && !environment.rects.length;
  let fallback = "";
  if (missing && step === 6)
    fallback =
      "No panel settings control is visible. Show panel headers in Views, or add a panel from Panels. You can continue now.";
  else if (missing && step === 7 && !snapshot)
    fallback =
      "Add a Loudness or Waveform panel from Panels to try history selection. You can continue now.";
  else if (missing)
    fallback =
      "This control is currently hidden. Reveal the toolbar to find it, or continue the tour.";

  return createPortal(
    <>
      {!invitation
        ? environment.rects.map((rect, index) => (
            <div
              key={index}
              aria-hidden="true"
              data-tour-highlight
              className={`pointer-events-none fixed ${LAYER_FLOATING}`}
              style={{
                left: rect.left - 2,
                top: rect.top - 2,
                width: rect.right - rect.left + 4,
                height: rect.bottom - rect.top + 4,
                borderRadius: rect.borderRadius,
                boxShadow:
                  content.target === "history"
                    ? "0 0 10px 2px color-mix(in srgb, var(--primary) 24%, transparent), 0 0 18px 4px color-mix(in srgb, var(--primary) 10%, transparent)"
                    : "0 0 6px 3px color-mix(in srgb, var(--primary) 38%, transparent), 0 0 14px 6px color-mix(in srgb, var(--primary) 16%, transparent)",
              }}
            />
          ))
        : null}
      <section
        ref={cardRef}
        tabIndex={-1}
        role="region"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-quick-tour
        className={`fixed ${LAYER_FLOATING} ${POPOVER_SURFACE_CLASS} w-[25em] max-w-[calc(100vw-1rem)] max-h-[calc(100vh-1rem)] overflow-auto p-3 text-[length:var(--ui-fs-control)]`}
        style={environment.position}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            void close();
          }
        }}
      >
        <div className="flex items-center gap-2">
          <h2 id={titleId} className={`${POPOVER_TITLE_CLASS} min-w-0 flex-1`}>
            {invitation ? "Quick Tour" : content.title}
          </h2>
          {!invitation ? (
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {step + 1} / {QUICK_TOUR_STEPS.length}
            </span>
          ) : null}
          <IconAction
            aria-label="close quick tour"
            disabled={busy}
            onClick={() => void close()}
            className="p-1"
          >
            <X className="size-[1em]" />
          </IconAction>
        </div>
        <p id={bodyId} className="mt-2 text-muted-foreground">
          {invitation ? "Start metering and discover the main controls in PLVS." : content.body}
        </p>
        {fallback ? <p className="mt-2 text-muted-foreground">{fallback}</p> : null}
        {error ? (
          <p role="alert" className="mt-2 text-destructive">
            {error}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          {invitation ? (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => void close()}>
                Not Now
              </Button>
              <Button disabled={busy} onClick={() => void begin()}>
                Start Tour
              </Button>
            </>
          ) : (
            <>
              {step > 0 ? (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    focusRequested.current = true;
                    setStep(step - 1);
                  }}
                >
                  Back
                </Button>
              ) : null}
              <Button
                disabled={busy}
                onClick={() => {
                  if (step === QUICK_TOUR_STEPS.length - 1) void close("completed");
                  else {
                    focusRequested.current = true;
                    setStep(step + 1);
                  }
                }}
              >
                {step === QUICK_TOUR_STEPS.length - 1 ? "Finish" : "Next"}
              </Button>
            </>
          )}
        </div>
      </section>
    </>,
    document.body
  );
}
