import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import LiquidGlass from "liquid-glass-react";
import { APP_NAME, COACH_DEFAULTS, DOWNLOADS_URL, api, type CoachSettings, type Health, type Me } from "./api";
import Tubby from "./pages/Tubby";
import Rewards from "./pages/Rewards";
import Achievements from "./pages/Achievements";
import Cosmetics from "./pages/Cosmetics";
import Settings from "./pages/Settings";
import LinkPage from "./pages/Link";
import { Welcome } from "./components/Welcome";
import { isDemoProfile, loadAuth, signOut, type Account, type AuthConfig } from "./lib/auth";
import { isGuest } from "./lib/flags";
import { Celebration } from "./components/Celebration";
import { Onboarding, hasOnboarded } from "./components/Onboarding";
import { DockItem } from "./components/aqua/dock";
import { VOICE_ENABLED } from "./constants";
import { PaperScene } from "./components/PaperScene";
import { FlameIcon, GearIcon, GiftIcon, TrophyIcon, PaletteIcon } from "./components/icons";

interface MeCtx {
  me: Me | null;
  refresh: () => Promise<void>;
  setMe: (m: Me) => void;
  toast: (msg: string, kind?: "ok" | "err") => void;
}
const MeContext = createContext<MeCtx>(null!);
export const useMe = () => useContext(MeContext);

export interface VoicePrefs {
  enabled: boolean;
  rate: number;
  uri: string;
}

interface CoachCtx {
  settings: CoachSettings;
  save: (patch: Partial<CoachSettings>) => Promise<CoachSettings>;
  loading: boolean;
  voice: VoicePrefs;
  saveVoice: (patch: Partial<VoicePrefs>) => void;
  assistantMode: "live" | "demo";
  model: string;
  metaConfigured: boolean;
}
const CoachContext = createContext<CoachCtx>(null!);
export const useCoach = () => useContext(CoachContext);

interface AuthCtx {
  account: Account | null;
  config: AuthConfig | null;
  openSignIn: () => void;
}
const AuthContext = createContext<AuthCtx>({ account: null, config: null, openSignIn: () => undefined });
export const useAuth = () => useContext(AuthContext);

function AccountMenu({ account }: { account: Account }) {
  const [open, setOpen] = useState(false);
  const first = (account.name ?? account.email ?? "You").split(" ")[0];
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);
  return (
    <div className="account-menu">
      <button type="button" className={`account-btn ${open ? "on" : ""}`} aria-haspopup="menu" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
        {account.picture ? <img src={account.picture} alt="" referrerPolicy="no-referrer" /> : <span className="avatar-fallback">{first[0]}</span>}
        <span>{first}</span>
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          <div className="menu-who">
            <b>{account.name ?? "Signed in"}</b>
            {account.email && <span>{account.email}</span>}
          </div>
          <NavLink to="/settings" role="menuitem">Settings…</NavLink>
          <button type="button" role="menuitem" onClick={() => signOut()}>Sign out</button>
        </div>
      )}
    </div>
  );
}

const NAV = [
  { to: "/", label: "Tubby", tile: <span className="dock-tile tubby" />, end: true },
  { to: "/rewards", label: "Rewards", tile: <span className="dock-tile" style={{ ["--h" as string]: 18 }}><GiftIcon size={28} /></span> },
  { to: "/achievements", label: "Achievements", tile: <span className="dock-tile" style={{ ["--h" as string]: 42 }}><TrophyIcon size={28} /></span> },
  { to: "/cosmetics", label: "Cosmetics", tile: <span className="dock-tile" style={{ ["--h" as string]: 326 }}><PaletteIcon size={28} /></span> },
  { to: "/settings", label: "Settings", tile: <span className="dock-tile graphite"><GearIcon size={28} /></span> },
];

function MenuClock() {
  const fmt = () => new Date().toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
  const [now, setNow] = useState(fmt);
  useEffect(() => {
    const t = setInterval(() => setNow(fmt()), 15000);
    return () => clearInterval(t);
  }, []);
  return <span className="menu-clock">{now}</span>;
}

function GlassDock() {
  const [tip, setTip] = useState<number | null>(null);
  return (
    <nav className="dock" aria-label="Primary">
      {tip !== null && (
        <span className="dock-tip" style={{ left: `calc(50% + ${(tip - 2) * 64}px)` }}>{NAV[tip].label}</span>
      )}
      <LiquidGlass
        className="dock-glass"
        cornerRadius={24}
        padding="9px 14px 5px"
        displacementScale={64}
        blurAmount={0.06}
        saturation={150}
        aberrationIntensity={1.6}
        elasticity={0.1}
        style={{ position: "absolute", top: "50%", left: "50%" }}
      >
        <div className="dock-row" onMouseLeave={() => setTip(null)}>
          {NAV.map((item, i) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className="dock-link"
              aria-label={item.label}
              onMouseEnter={() => setTip(i)}
              onFocus={() => setTip(i)}
              onBlur={() => setTip(null)}
            >
              {({ isActive }) => (
                <DockItem label={item.label} active={isActive}>
                  {item.tile}
                </DockItem>
              )}
            </NavLink>
          ))}
        </div>
      </LiquidGlass>
    </nav>
  );
}

const VOICE_KEY = "tubbybuddy.voice";
const loadVoice = (): VoicePrefs => {
  try {
    const raw = JSON.parse(localStorage.getItem(VOICE_KEY) || "{}") as Partial<VoicePrefs>;
    return { enabled: VOICE_ENABLED && raw.enabled === true, rate: Number(raw.rate) || 1, uri: String(raw.uri || "") };
  } catch {
    return { enabled: false, rate: 1, uri: "" };
  }
};

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [settings, setSettings] = useState<CoachSettings>(COACH_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [voice, setVoice] = useState<VoicePrefs>(loadVoice);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [auth, setAuth] = useState<{ config: AuthConfig; account: Account | null } | null>(null);
  const [forceWelcome, setForceWelcome] = useState(false);
  const [guest, setGuestState] = useState(isGuest);
  const location = useLocation();
  useEffect(() => {
    loadAuth().then(setAuth).catch(() => undefined);
  }, []);
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const timerRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const toastsRef = useRef(toasts);
  toastsRef.current = toasts;
  const isDesktop = typeof window !== "undefined" && !!(window as { tubbyDesktop?: unknown }).tubbyDesktop;

  const refresh = useCallback(async () => setMe(await api<Me>("/me")), []);
  useEffect(() => {
    const desktop = (globalThis as { tubbyDesktop?: { onPoints?: (cb: () => void) => () => void } }).tubbyDesktop;
    if (!desktop?.onPoints) return;
    return desktop.onPoints(() => {
      refresh().catch(() => undefined);
    });
  }, [refresh]);
  const toast = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    // Same message again? Refresh the visible bubble instead of stacking duplicates.
    const existing = toastsRef.current.find((x) => x.msg === msg);
    if (existing) {
      clearTimeout(timerRef.current.get(existing.id));
      const timer = setTimeout(() => {
        timerRef.current.delete(existing.id);
        setToasts((cur) => cur.filter((x) => x.id !== existing.id));
      }, 3800);
      timerRef.current.set(existing.id, timer);
      return;
    }
    const id = Date.now() + Math.random();
    const timer = setTimeout(() => {
      timerRef.current.delete(id);
      setToasts((cur) => cur.filter((x) => x.id !== id));
    }, 3800);
    timerRef.current.set(id, timer);
    setToasts((t) => [...t.slice(-2), { id, msg, kind }]);
  }, []);

  useEffect(() => {
    refresh().catch((e) => toast(`API unreachable: ${e.message}`, "err"));
    api<Health>("/health")
      .then(setHealth)
      .catch(() => undefined);
    api<{ settings: CoachSettings }>("/assistant/settings")
      .then((r) => setSettings({ ...COACH_DEFAULTS, ...r.settings }))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [refresh, toast]);

  const save = useCallback(async (patch: Partial<CoachSettings>) => {
    const r = await api<{ settings: CoachSettings }>("/assistant/settings", { method: "PUT", body: patch });
    setSettings({ ...COACH_DEFAULTS, ...r.settings });
    return r.settings;
  }, []);

  const saveVoice = useCallback((patch: Partial<VoicePrefs>) => {
    setVoice((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(VOICE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  useEffect(() => {
    if (!loading && auth && !hasOnboarded() && !auth.account?.onboarded) setShowOnboarding(true);
  }, [loading, auth]);

  // Until /health answers, assume live so the demo banner never flashes on a configured server.
  const assistantMode = health?.assistantMode ?? "live";
  const metaConfigured = health?.metaConfigured ?? false;
  const model = health?.assistantModel ?? "muse-spark-1.3";
  const onLinkPage = location.pathname === "/link";
  const demoProfile = isDemoProfile();
  // Everyone without an account meets the welcome screen first; demo and guest profiles only when they ask to sign in.
  const needsSignIn = !!auth && !auth.account && !onLinkPage && (forceWelcome || (!demoProfile && !guest));

  return (
    <AuthContext.Provider value={{ account: auth?.account ?? null, config: auth?.config ?? null, openSignIn: () => setForceWelcome(true) }}>
    <MeContext.Provider value={{ me, refresh, setMe, toast }}>
      <CoachContext.Provider value={{ settings, save, loading, voice, saveVoice, assistantMode, model, metaConfigured }}>
        <PaperScene />
        <header className="menubar">
          <NavLink to="/" className="brand" aria-label={`${APP_NAME} home`}>
            <img src="/icon-192.png" alt="" width={18} height={18} />
            <span>{APP_NAME}</span>
          </NavLink>
          {isDesktop && (
            <nav className="menu-items" aria-label="Primary">
              {NAV.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? "on" : "")}>
                  {item.label}
                </NavLink>
              ))}
            </nav>
          )}
          {!isDesktop && DOWNLOADS_URL && (
            <a className="menu-get" href={DOWNLOADS_URL} target="_blank" rel="noreferrer" title="Blocking runs in the Windows and Android apps">Get the apps</a>
          )}
          <div className="menu-spacer" />
          <div className="menu-status">
            {assistantMode === "demo" && (
              <span className="demo-chip" title="No Meta key on the server, so Tubby uses offline replies.">demo coach</span>
            )}
            {me?.difficulty === "hard" && (
              <NavLink to="/settings" className="hard-chip" title="Hard mode: slips cost double. Change it in Settings.">Hard mode</NavLink>
            )}
            {!needsSignIn && !onLinkPage && <span className="menu-points balance-pill" aria-label={`${me?.balance ?? 0} points`}>
              <b>{me ? me.balance.toLocaleString() : "…"}</b> pts
            </span>}
            {!needsSignIn && !onLinkPage && <span className="menu-streak" aria-label={`${me?.streak ?? 0} day streak`} title="Streak">
              <FlameIcon size={15} />{me?.streak ?? 0}
            </span>}
            {auth?.account ? (
              <AccountMenu account={auth.account} />
            ) : auth && !needsSignIn ? (
              <span className="menu-demo">
                {demoProfile ? "Demo account" : "Not signed in"}
                {auth.config.google && <button type="button" className="menu-signin" onClick={() => setForceWelcome(true)}>Sign in</button>}
                {demoProfile && <button type="button" className="menu-signin" onClick={() => signOut()}>Exit demo</button>}
              </span>
            ) : null}
            <MenuClock />
          </div>
        </header>
        {health?.stale && (
          <div className="demo-banner" role="status">
            <span><b>Restart the server.</b> TubbyBuddy was updated, but the server window is still running the old version.</span>
          </div>
        )}
        {assistantMode === "demo" && (
          <div className="demo-banner" role="status">
            <span className="demo-banner-full">
              <b>Demo coach.</b> Tubby is using offline replies because the server has no Meta key. Set
              {" "}<code>META_MODEL_API_KEY</code> in <code>.env</code> and restart.
            </span>
            <span className="demo-banner-short"><b>Demo coach</b> · offline replies, no Meta key</span>
          </div>
        )}
        <main className={`app-main ${isDesktop ? "desktop-main" : ""}`}>
          {(onLinkPage || (auth && !needsSignIn)) && (
          <Routes>
            <Route path="/" element={<Tubby />} />
            <Route path="/rewards" element={<Rewards />} />
            <Route path="/achievements" element={<Achievements />} />
            <Route path="/cosmetics" element={<Cosmetics />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/link" element={<LinkPage config={auth?.config ?? null} account={auth?.account ?? null} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          )}
        </main>
        {!onLinkPage && auth && !needsSignIn && <GlassDock />}
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>
          ))}
        </div>
        <Celebration />
        {needsSignIn && auth && (
          <Welcome
            config={auth.config}
            onClose={forceWelcome && (demoProfile || guest) ? () => setForceWelcome(false) : undefined}
            onGuest={() => { setGuestState(true); setForceWelcome(false); }}
          />
        )}
        {showOnboarding && auth && !needsSignIn && !onLinkPage && <Onboarding onDone={() => setShowOnboarding(false)} />}
      </CoachContext.Provider>
    </MeContext.Provider>
    </AuthContext.Provider>
  );
}
