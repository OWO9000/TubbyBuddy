import { api, deviceId } from "../api";
import { clearOnboarded, setGuest } from "./flags";

const KEYS = {
  device: "tubbybuddy.deviceId",
  onboarded: "tubbybuddy.onboarded.v1",
  chat: "tubbybuddy.chat.v1",
  focus: "tubbybuddy.focus.v1",
};

function clearLocal(keys: string[]) {
  for (const k of keys) {
    try {
      localStorage.removeItem(k);
    } catch {
      // Storage blocked (private mode): the reload below still starts clean in memory.
    }
  }
}

/** Show the chat onboarding again on this browser. Points and settings stay. */
export function replayOnboarding() {
  clearOnboarded();
  clearLocal([KEYS.onboarded, KEYS.chat]);
  location.assign("/");
}

/** A brand-new anonymous profile on this browser. The old one stays on the server under its old id. */
export function startFresh() {
  clearOnboarded();
  clearLocal([KEYS.device, KEYS.onboarded, KEYS.chat, KEYS.focus]);
  location.assign("/");
}

/** Switch this browser to a new demo profile with two weeks of history (server-generated). */
export async function loadDemoProfile() {
  const r = await api<{ deviceId: string }>("/demo/profile", { method: "POST", body: { from: deviceId() } });
  clearLocal([KEYS.chat, KEYS.focus]);
  localStorage.setItem(KEYS.device, r.deviceId);
  setGuest(false);
  location.assign("/");
}
