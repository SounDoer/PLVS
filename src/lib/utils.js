import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class strings while resolving conflicting utilities.
 * Standard shadcn helper used by primitives under `src/components/ui/`.
 * @param  {...import("clsx").ClassValue} inputs
 * @returns {string}
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
