import { useAppStore } from "../store/app";

/**
 * Whether motion should be reduced *right now*, honoring the user's override.
 *
 * "reduced" / "full" force the answer regardless of the OS; "system" (the
 * default) defers to the OS `prefers-reduced-motion` media query. This is the
 * JS counterpart to the `[data-motion]` CSS rules in index.css — used by code
 * that animates imperatively (e.g. the TitleBar window transitions) so it makes
 * the same decision the stylesheet does.
 */
export function prefersReducedMotion(): boolean {
  const pref = useAppStore.getState().motionPreference;
  if (pref === "reduced") return true;
  if (pref === "full") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
