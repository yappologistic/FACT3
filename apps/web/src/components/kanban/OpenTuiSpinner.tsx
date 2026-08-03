import cliSpinners, { type SpinnerName } from "cli-spinners";
import { memo, useSyncExternalStore } from "react";

import { cn } from "~/lib/utils";

const FRAME_TICK_MS = 80;
const listeners = new Set<() => void>();
let frameTick = 0;
let timer: number | null = null;

function notifyFrame() {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  frameTick += 1;
  for (const listener of listeners) listener();
}

function startScheduler() {
  if (timer !== null || typeof window === "undefined") return;
  timer = window.setInterval(notifyFrame, FRAME_TICK_MS);
}

function stopScheduler() {
  if (timer === null || typeof window === "undefined") return;
  window.clearInterval(timer);
  timer = null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  startScheduler();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopScheduler();
  };
}

function snapshot() {
  return frameTick;
}

function serverSnapshot() {
  return 0;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/**
 * Browser bridge for the frame sets used by OpenTUI's spinner package.
 * A single low-frequency scheduler drives every visible instance, pauses in
 * background windows, and respects reduced motion.
 */
export const OpenTuiSpinner = memo(function OpenTuiSpinner(props: {
  readonly name?: SpinnerName;
  readonly className?: string;
  readonly label?: string;
}) {
  const tick = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const spinner = cliSpinners[props.name ?? "dots"];
  const frameIndex = prefersReducedMotion()
    ? 0
    : Math.floor((tick * FRAME_TICK_MS) / spinner.interval) % spinner.frames.length;

  return (
    <span
      aria-label={props.label}
      aria-hidden={props.label ? undefined : true}
      role={props.label ? "img" : undefined}
      className={cn(
        "inline-flex min-w-[1.2em] items-center justify-center font-mono text-current tabular-nums",
        props.className,
      )}
    >
      <span aria-hidden>{spinner.frames[frameIndex]}</span>
    </span>
  );
});
