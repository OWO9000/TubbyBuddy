import { api, deviceId } from "../api";
import { FLAG_KEYS, markOnboarded } from "./flags";
import { androidBridge } from "./native";

/** Signed-in account as the server describes it. */
export interface Account {
  name: string | null;
  email: string | null;
  picture: string | null;
  profileId: string;
  onboarded: boolean;
}

export interface AuthConfig {
  google: boolean;
  googleClientId: string | null;
}

const KEYS = {
  session: "tubbybuddy.session.v1",
  device: "tubbybuddy.deviceId",
  chat: "tubbybuddy.chat.v1",
  focus: "tubbybuddy.focus.v1",
};

interface DesktopAuthBridge {
  account?: () => Promise<Account | null>;
  signIn?: () => Promise<{ ok: boolean; error?: string; cancelled?: boolean }>;
  cancelSignIn?: () => Promise<boolean>;
  signOut?: () => Promise<boolean>;
  useDemo?: () => Promise<boolean>;
}
/** The Windows or Android app's account bridge (both sign in through the system browser). Undefined in a browser tab. */
export const desktopBridge = (): DesktopAuthBridge | undefined =>
  (globalThis as { tubbyDesktop?: DesktopAuthBridge }).tubbyDesktop ?? androidBridge();

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage blocked: the session lasts for this page only */
  }
};

export const sessionToken = () => read(KEYS.session);
export const isDemoProfile = () => deviceId().startsWith("demo-");

export async function loadAuth(): Promise<{ config: AuthConfig; account: Account | null }> {
  const config = await api<AuthConfig>("/auth/config").catch(() => ({ google: false, googleClientId: null }));
  const desktop = desktopBridge();
  if (desktop?.account) return { config, account: await desktop.account().catch(() => null) };
  if (!sessionToken()) return { config, account: null };
  try {
    const r = await api<{ account: Account }>("/auth/session");
    return { config, account: r.account };
  } catch {
    write(KEYS.session, null);
    return { config, account: null };
  }
}

/** Exchange a Google credential for a session. The first sign-in keeps this browser's guest progress. */
export async function completeGoogleSignIn(credential: string): Promise<Account> {
  const r = await api<{ token: string; isNew: boolean; account: Account }>("/auth/google", {
    body: { credential, deviceId: deviceId(), label: "Web" },
  });
  const switching = r.account.profileId !== deviceId();
  write(KEYS.session, r.token);
  write(KEYS.device, r.account.profileId);
  if (switching) {
    write(KEYS.chat, null);
    write(KEYS.focus, null);
  }
  if (r.account.onboarded) markOnboarded(r.account.profileId);
  return r.account;
}

export async function signOut() {
  const desktop = desktopBridge();
  for (const k of FLAG_KEYS) write(k, null);
  if (desktop?.signOut) {
    for (const k of [KEYS.chat, KEYS.focus]) write(k, null);
    await desktop.signOut();
    return;
  }
  await api("/auth/logout", { body: {} }).catch(() => undefined);
  for (const k of [KEYS.session, KEYS.device, KEYS.chat, KEYS.focus]) write(k, null);
  location.assign("/");
}

// ---- Google Identity Services ----

interface GoogleId {
  initialize(o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string; auto_select?: boolean; itp_support?: boolean }): void;
  renderButton(el: HTMLElement, o: Record<string, unknown>): void;
  disableAutoSelect(): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

let gisPromise: Promise<GoogleId> | null = null;
export function loadGoogleIdentity(): Promise<GoogleId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  gisPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error("Google sign-in did not load")));
    s.onerror = () => {
      gisPromise = null;
      reject(new Error("Couldn't reach Google. Check your connection and try again."));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}
