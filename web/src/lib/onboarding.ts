/**
 * Which onboarding screen (if any) a launch should show.
 *
 * Kept pure and separate from the component because getting this wrong is not a
 * cosmetic bug: a returning user with an existing project seeing the new-user
 * welcome screen is exactly what we are trying to prevent.
 */

export type OnboardStep =
  | "loading"
  | "welcome"
  | "create"
  | "signin"
  | "ways"
  | "intro"
  | "done";

export interface AccountProbe {
  hasAccount?: boolean;
  account?: { onboarded?: boolean } | null;
}

/**
 * @param probe   the server's answer, or null if it could not be reached
 * @param cached  whether this browser has seen a completed onboarding before
 */
export function decideRestore(probe: AccountProbe | null, cached: boolean): OnboardStep {
  // Unreachable server: trust what we already know rather than punishing an
  // existing user with the welcome flow over a transient failure.
  if (!probe) return cached ? "done" : "welcome";
  if (!probe.hasAccount) return "welcome";
  return probe.account?.onboarded ? "done" : "welcome";
}
