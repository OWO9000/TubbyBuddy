import { deviceId } from "../api";

/**
 * Per-profile flags kept in this browser. "Onboarded" is stored as the profile id it belongs to, so signing out or
 * switching accounts never carries one person's finished setup over to another.
 */
const ONBOARDED = "tubbybuddy.onboarded.v2";
const GUEST = "tubbybuddy.guest.v1";

const get = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const set = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage blocked: lasts for this page only */
  }
};

export const isDemoId = (id: string) => id.startsWith("demo-");

export function hasOnboarded(): boolean {
  const id = deviceId();
  return isDemoId(id) || get(ONBOARDED) === id;
}
export const markOnboarded = (id = deviceId()) => set(ONBOARDED, id);
export const clearOnboarded = () => set(ONBOARDED, null);

/** Chose to use the app without an account (only offered when the server has no Google sign-in). */
export const isGuest = () => get(GUEST) === "1";
export const setGuest = (on: boolean) => set(GUEST, on ? "1" : null);

export const FLAG_KEYS = [ONBOARDED, GUEST, "tubbybuddy.onboarded.v1"];
