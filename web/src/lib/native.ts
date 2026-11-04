/**
 * The app runs in three shells: a browser tab, the Windows app (Electron, `window.tubbyDesktop`) and the Android app
 * (a WebView with `window.TubbyAndroid`). The Android bridge is synchronous for ids and asynchronous for everything
 * else: the page passes a callback id and native code answers through `window.__tubbyNative(id, json)`.
 */

interface RawAndroid {
  deviceId(): string;
  session(): string;
  call(method: string, argJson: string, callbackId: string): void;
}

export type ShellKind = "web" | "desktop" | "android";

const raw = (): RawAndroid | undefined => (globalThis as { TubbyAndroid?: RawAndroid }).TubbyAndroid;

export function shellKind(): ShellKind {
  if ((globalThis as { tubbyDesktop?: unknown }).tubbyDesktop) return "desktop";
  if (raw()) return "android";
  return "web";
}
export const isAndroid = () => shellKind() === "android";

const waiting = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let seq = 0;

(globalThis as { __tubbyNative?: (id: string, json: string) => void }).__tubbyNative = (id, json) => {
  const w = waiting.get(id);
  if (!w) return;
  waiting.delete(id);
  try {
    const v = JSON.parse(json) as { ok: boolean; value?: unknown; error?: string };
    if (v.ok) w.resolve(v.value);
    else w.reject(new Error(v.error || "Something went wrong on the phone"));
  } catch {
    w.reject(new Error("Bad reply from the phone"));
  }
};

export function androidCall<T>(method: string, arg: unknown = {}): Promise<T> {
  const a = raw();
  if (!a) return Promise.reject(new Error("Not running in the Android app"));
  const id = `c${++seq}`;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
    try {
      a.call(method, JSON.stringify(arg ?? {}), id);
    } catch (e) {
      waiting.delete(id);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

export const androidDeviceId = (): string | null => {
  try {
    return raw()?.deviceId() || null;
  } catch {
    return null;
  }
};
export const androidSession = (): string | null => {
  try {
    return raw()?.session() || null;
  } catch {
    return null;
  }
};

export interface PhoneGuardStatus {
  enabled: boolean;
  permissionsOk: boolean;
  blocked: string[];
}

/** What the Android app exposes to the shared screens, shaped like the desktop bridge where they overlap. */
export const androidBridge = () =>
  raw()
    ? {
        account: () => androidCall<{ name: string | null; email: string | null; picture: string | null; profileId: string; onboarded: boolean } | null>("account"),
        signIn: () => androidCall<{ ok: boolean; error?: string }>("signIn"),
        signOut: () => androidCall<boolean>("signOut"),
        useDemo: () => androidCall<boolean>("useDemo"),
        applySetup: (s: { apps: string[]; sites?: string[] }) => androidCall<boolean>("applySetup", { apps: [...s.apps, ...(s.sites ?? [])] }),
        guardStatus: () => androidCall<PhoneGuardStatus>("guardStatus"),
        openGuardSetup: () => androidCall<boolean>("openGuardSetup"),
      }
    : undefined;
