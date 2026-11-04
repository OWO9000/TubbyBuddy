import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, useCoach, useMe } from "../App";
import { desktopBridge, signOut } from "../lib/auth";
import { DOWNLOADS_URL, api, deviceId as localDeviceId, type CoachSettings, type Difficulty, type Me } from "../api";
import { Button } from "../components/aqua/button";
import { InterceptPreview } from "../components/InterceptPreview";
import { Window } from "../components/Window";
import { SUGGESTED_APPS, VOICE_ENABLED } from "../constants";
import { FOCUS_MODES, type FocusMode } from "../lib/modes";
import { loadDemoProfile, replayOnboarding, startFresh } from "../lib/profile";
import { androidBridge, shellKind, type PhoneGuardStatus } from "../lib/native";
import { listVoices, onVoicesReady, speak, speechSupported, ttsSupported } from "../voice";

type BatchNudge = { id: number; template: string; tone: string; preview: string };
type BatchResult = { app: string; nudges: BatchNudge[]; model: string; latencyMs: number };
type NextNudge = { nudge: string; tone: string; remaining: number };

const COACH_TONES: { id: CoachSettings["tone"]; label: string; blurb: string }[] = [
  { id: "warm", label: "Warm", blurb: "Kind, familiar, quietly encouraging." },
  { id: "direct", label: "Direct", blurb: "Straight talk. No cushioning." },
  { id: "playful", label: "Playful", blurb: "A little funny, never at your expense." },
  { id: "calm", label: "Calm", blurb: "Slow and grounding. Breath-sized sentences." },
];

const DIFFICULTIES: { id: Difficulty; label: string; rules: string[] }[] = [
  {
    id: "normal",
    label: "Normal",
    rules: ["A slip on a guarded app burns points and resets your streak", "Stop a focus session any time, no cost", "6 chat unlocks a day, 30-minute slow-earn penalty"],
  },
  {
    id: "hard",
    label: "Hard",
    rules: [
      "Every slip burns double",
      "Stopping a focus session early needs your weekly emergency pass, or burns points",
      "3 chat unlocks a day, 60-minute slow-earn penalty",
      "Finished focus sessions pay 30 instead of 20",
    ],
  },
];

export default function Settings() {
  const { account, config: authCfg, openSignIn } = useAuth();
  const { me, setMe, toast } = useMe();
  const [difficultyBusy, setDifficultyBusy] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  async function setDifficulty(level: Difficulty) {
    if (difficultyBusy || level === (me?.difficulty ?? "normal")) return;
    setDifficultyBusy(true);
    try {
      setMe(await api<Me>("/difficulty", { body: { deviceId: me?.deviceId, level } }));
      toast(level === "hard" ? "Hard mode on. Slips cost double." : "Back to normal mode.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not change the difficulty", "err");
    } finally {
      setDifficultyBusy(false);
    }
  }
  const navigate = useNavigate();
  const { settings, save, loading, voice, saveVoice, assistantMode, model, metaConfigured } = useCoach();
  const [toneBusy, setToneBusy] = useState(false);
  const desktop = (globalThis as { tubbyDesktop?: { openSettings?: () => void; demoOff?: () => Promise<boolean>; state?: () => Promise<{ guardActive: boolean; focusUntil: number; focusMinutes: number }> } }).tubbyDesktop;
  const [desktopState, setDesktopState] = useState<{ guardActive: boolean; focusUntil: number; focusMinutes: number } | null>(null);
  useEffect(() => {
    if (!desktop?.state) return;
    let live = true;
    const poll = () => desktop.state?.().then((s) => live && setDesktopState(s)).catch(() => undefined);
    poll();
    const t = setInterval(poll, 5000);
    return () => { live = false; clearInterval(t); };
  }, [desktop]);
  const phone = shellKind() === "android" ? androidBridge() : undefined;
  const [phoneGuard, setPhoneGuard] = useState<PhoneGuardStatus | null>(null);
  useEffect(() => {
    if (!phone) return;
    let live = true;
    const poll = () => phone.guardStatus().then((s) => live && setPhoneGuard(s)).catch(() => undefined);
    poll();
    const onVisible = () => document.visibilityState === "visible" && poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => { live = false; document.removeEventListener("visibilitychange", onVisible); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [goalsText, setGoalsText] = useState(settings.goals.join("\n"));
  const [apps, setApps] = useState<string[]>(settings.apps);
  const [custom, setCustom] = useState("");
  const [savingFocus, setSavingFocus] = useState(false);
  const init = useRef(false);

  useEffect(() => {
    if (loading || init.current) return;
    init.current = true;
    setGoalsText(settings.goals.join("\n"));
    setApps(settings.apps);
  }, [loading, settings]);

  const goals = useMemo(() => goalsText.split("\n").map((g) => g.trim()).filter((g) => g.length > 1).slice(0, 6), [goalsText]);
  const goalsDirty = goals.join("\n") !== settings.goals.join("\n");
  const appsDirty = apps.join("\n") !== settings.apps.join("\n");

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(listVoices);
  useEffect(() => onVoicesReady(setVoices), []);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [batching, setBatching] = useState(false);
  const [batch, setBatch] = useState<BatchResult[]>([]);
  const [testApp, setTestApp] = useState(apps[0] ?? "TikTok");
  const [testing, setTesting] = useState(false);
  const [cached, setCached] = useState<NextNudge | null>(null);
  const [cacheError, setCacheError] = useState<string | null>(null);

  async function patch(p: Partial<CoachSettings>) {
    try {
      await save(p);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "err");
    }
  }

  async function setTone(tone: CoachSettings["tone"]) {
    if (tone === settings.tone) return;
    setToneBusy(true);
    await patch({ tone });
    setToneBusy(false);
  }

  async function saveFocus() {
    setSavingFocus(true);
    try {
      await save({ goals, apps });
      await phone?.applySetup({ apps }).catch(() => false);
      toast("Focus settings saved");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "err");
    } finally {
      setSavingFocus(false);
    }
  }

  /** One tap: swap the guarded-apps list for a moment of the day. Goals stay as they are. */
  async function applyMode(m: FocusMode) {
    setApps(m.apps);
    setSavingFocus(true);
    try {
      await save({ goals, apps: m.apps });
      await phone?.applySetup({ apps: m.apps }).catch(() => false);
      toast(`${m.name} mode on: ${m.apps.length} apps guarded, ${m.minutes}-minute sessions`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not apply mode", "err");
    } finally {
      setSavingFocus(false);
    }
  }

  function toggleApp(name: string) {
    setApps((prev) => (prev.some((a) => a.toLowerCase() === name.toLowerCase()) ? prev.filter((a) => a.toLowerCase() !== name.toLowerCase()) : [...prev, name].slice(0, 12)));
  }

  function addCustom() {
    const name = custom.trim().slice(0, 60);
    if (!name) return;
    if (apps.some((a) => a.toLowerCase() === name.toLowerCase())) {
      toast("Already in the list");
      return;
    }
    setApps((prev) => [...prev, name].slice(0, 12));
    setCustom("");
  }

  async function pregenerate() {
    if (!apps.length || !goals.length) {
      toast("Pick at least one app and one goal first", "err");
      return;
    }
    setBatching(true);
    setBatch([]);
    const out: BatchResult[] = [];
    try {
      for (const app of apps.slice(0, 4)) {
        const r = await api<Omit<BatchResult, "app">>("/nudges/batch", {
          body: { deviceId: me?.deviceId ?? localDeviceId(), goals, appName: app, pointsAtRisk: 40, streak: me?.streak ?? 0, count: 4 },
        });
        out.push({ app, ...r });
        setBatch([...out]);
      }
      toast(`Cached ${out.reduce((n, r) => n + r.nudges.length, 0)} nudges for ${out.length} apps`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not cache nudges", "err");
    } finally {
      setBatching(false);
    }
  }

  async function testCache() {
    setTesting(true);
    setCached(null);
    setCacheError(null);
    try {
      const q = new URLSearchParams({
        deviceId: me?.deviceId ?? localDeviceId(),
        appName: testApp,
        points: "40",
        streak: String(me?.streak ?? 0),
      });
      setCached(await api<NextNudge>(`/nudges/next?${q.toString()}`));
    } catch (e) {
      setCacheError(e instanceof Error ? e.message : "Cache miss");
    } finally {
      setTesting(false);
    }
  }

  function previewVoice() {
    if (!ttsSupported()) {
      toast("This browser has no speech output", "err");
      return;
    }
    speak("I'm here. What are we protecting today?", { rate: voice.rate, voiceURI: voice.uri });
  }

  const canPregenerate = apps.length > 0 && goals.length > 0 && !batching;

  return (
    <div className="page settings-page">
      <Window title="Settings">

      {desktop && (
        <section className="card setting-section">
          <div className="section-head">
            <div>
              <h2>Desktop guard</h2>
              <p className="muted small">
                {desktopState?.focusUntil && desktopState.focusUntil > Date.now()
                  ? `Focus running · ${Math.ceil((desktopState.focusUntil - Date.now()) / 60000)} min left. Closing this window keeps it running.`
                  : desktopState?.guardActive
                    ? "Guard is active. Closing this window keeps it running."
                    : "Guard is paused. Open desktop settings to turn it on."}
              </p>
            </div>
            <Button variant="secondary" type="button" onClick={() => desktop.openSettings?.()}>
              Open desktop settings
            </Button>
            <button
              type="button"
              className="link"
              onClick={() => {
                desktop.demoOff?.();
                toast("Demo guard off for 30 minutes");
              }}
            >
              Demo: turn guard off 30 min
            </button>
          </div>
        </section>
      )}

      {phone && (
        <section className="card setting-section">
          <div className="section-head">
            <div>
              <h2>Phone guard</h2>
              <p className="muted small">
                {!phoneGuard
                  ? "Checking the phone guard…"
                  : !phoneGuard.permissionsOk
                    ? "Android still needs a couple of permissions before Tubby can step in."
                    : phoneGuard.enabled
                      ? `On. Watching ${phoneGuard.blocked.length} app${phoneGuard.blocked.length === 1 ? "" : "s"} on this phone.`
                      : "Paused. Turn it on to have Tubby step in."}
              </p>
            </div>
            <Button variant={phoneGuard && !phoneGuard.permissionsOk ? "default" : "secondary"} type="button" onClick={() => phone.openGuardSetup().catch(() => undefined)}>
              {phoneGuard && !phoneGuard.permissionsOk ? "Finish setup" : "Open phone guard"}
            </Button>
          </div>
        </section>
      )}

      <section className="card setting-section">
        <div className="section-head">
          <div>
            <h2>Difficulty</h2>
            <p className="muted small">How much a slip costs. The guard can always be dismissed; this changes the points, not the exits.</p>
          </div>
          {difficultyBusy && <span className="muted small">Saving…</span>}
        </div>
        <div className="difficulty-grid" role="radiogroup" aria-label="Difficulty">
          {DIFFICULTIES.map((d) => {
            const on = (me?.difficulty ?? "normal") === d.id;
            return (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={on}
                className={`difficulty-card ${d.id} ${on ? "on" : ""}`}
                onClick={() => setDifficulty(d.id)}
                disabled={difficultyBusy || !me}
              >
                <b>{d.label}{d.id === "hard" && on && me?.emergencyPassesLeft !== undefined ? ` · ${me.emergencyPassesLeft} emergency pass left` : ""}</b>
                <ul>{d.rules.map((r) => <li key={r}>{r}</li>)}</ul>
              </button>
            );
          })}
        </div>
      </section>

      <section className="card setting-section">
        <div className="section-head">
          <div>
            <h2>How Tubby talks</h2>
            <p className="muted small">The same short answers, in a different voice. Applies to chat and home-screen nudges.</p>
          </div>
          {toneBusy && <span className="muted small">Saving…</span>}
        </div>

        <div className="tone-grid" role="radiogroup" aria-label="Coach tone">
          {COACH_TONES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={settings.tone === t.id}
              className={`tone-card ${settings.tone === t.id ? "on" : ""}`}
              onClick={() => setTone(t.id)}
              disabled={toneBusy}
            >
              <b>{t.label}</b>
              <span>{t.blurb}</span>
            </button>
          ))}
        </div>

        <div className="setting-row">
          <div className="setting-label">
            <b>Answer length</b>
            <span>Short is 1–2 sentences. Balanced allows a little more when you ask for a plan.</span>
          </div>
          <div className="seg" role="radiogroup" aria-label="Answer length">
            {(["short", "balanced"] as const).map((b) => (
              <button key={b} type="button" role="radio" aria-checked={settings.brevity === b} className={settings.brevity === b ? "on" : ""} onClick={() => patch({ brevity: b })}>
                {b === "short" ? "Short" : "Balanced"}
              </button>
            ))}
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-label">
            <b>Home-screen nudges</b>
            <span>When Tubby speaks up without being asked.</span>
          </div>
          <div className="seg" role="radiogroup" aria-label="Nudges">
            {(["off", "sometimes", "often"] as const).map((n) => (
              <button key={n} type="button" role="radio" aria-checked={settings.nudges === n} className={settings.nudges === n ? "on" : ""} onClick={() => patch({ nudges: n })}>
                {n === "off" ? "Off" : n === "sometimes" ? "Sometimes" : "Often"}
              </button>
            ))}
          </div>
        </div>

        {VOICE_ENABLED && (<>
        <div className="setting-row">
          <div className="setting-label">
            <b>Voice</b>
            <span>{speechSupported() ? "Speak to Tubby with the microphone, and let Tubby read replies aloud." : "Voice input needs Chrome or Edge. Voice replies still work."}</span>
          </div>
          <label className="switch">
            <input type="checkbox" checked={voice.enabled} onChange={(e) => saveVoice({ enabled: e.target.checked })} />
            <span>{voice.enabled ? "On" : "Off"}</span>
          </label>
        </div>

        {voice.enabled && (
          <div className="voice-controls">
            <label className="field">
              <span>Voice</span>
              <select value={voice.uri} onChange={(e) => saveVoice({ uri: e.target.value })}>
                <option value="">System default</option>
                {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Speed · {voice.rate.toFixed(2)}×</span>
              <input type="range" min={0.7} max={1.3} step={0.05} value={voice.rate} onChange={(e) => saveVoice({ rate: Number(e.target.value) })} />
            </label>
            <Button size="sm" variant="secondary" type="button" onClick={previewVoice}>Preview voice</Button>
          </div>
        )}
        </>)}
      </section>

      {!desktop && (
        <section className="card setting-section">
          <div className="section-head">
            <div>
              <h2>Focus modes</h2>
              <p className="muted small">One tap sets the guarded apps for a moment of your day. Goals stay as they are.</p>
            </div>
          </div>
          <div className="mode-grid" role="group" aria-label="Focus modes">
            {FOCUS_MODES.map((m) => (
              <button key={m.id} type="button" className="mode-card" onClick={() => applyMode(m)} disabled={savingFocus}>
                                <b>{m.name}</b>
                <span className="muted small">{m.blurb}</span>
                <span className="mode-meta">{m.apps.length} apps · {m.minutes} min</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="card setting-section">
        <div className="section-head">
          <div>
            <h2>What Tubby knows</h2>
            <p className="muted small">
              {desktop
                ? "Goals shape every reply and nudge. Desktop app blocking is handled by Desktop guard above, not by a phone list."
                : "Goals shape every reply and nudge. Guarded apps are what Tubby watches on your phone and PC."}
            </p>
          </div>
        </div>

        <label className="field">
          <span>Your goals, one per line ({goals.length} of 6)</span>
          <textarea rows={4} value={goalsText} onChange={(e) => setGoalsText(e.target.value)} maxLength={1200} placeholder="Play guitar 30 minutes a day" />
        </label>
        {goals.length === 0 && <p className="err small">Add at least one goal so Tubby has something to coach toward.</p>}

        {!desktop && (
          <>
            <div className="setting-label apps-label">
              <b>Guarded apps</b>
              <span>Opening one of these on your phone or PC brings up the block screen.</span>
            </div>
            <div className="pick-chips" role="group" aria-label="Suggested apps">
              {SUGGESTED_APPS.map((a) => {
                const on = apps.some((x) => x.toLowerCase() === a.toLowerCase());
                return (
                  <button key={a} type="button" className={`pick-chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => toggleApp(a)}>
                    {a}
                  </button>
                );
              })}
            </div>
            <div className="pick-chips" role="group" aria-label="Custom apps">
              {apps.filter((a) => !SUGGESTED_APPS.some((s) => s.toLowerCase() === a.toLowerCase())).map((a) => (
                <span key={a} className="pick-chip on">
                  {a}
                  <button type="button" className="chip-x" aria-label={`Remove ${a}`} onClick={() => toggleApp(a)}>×</button>
                </span>
              ))}
            </div>
            <form className="row gap wrap" onSubmit={(e) => { e.preventDefault(); addCustom(); }}>
              <input className="grow" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Add an app, e.g. Discord" maxLength={60} aria-label="Add an app" />
              <Button size="sm" variant="secondary" type="submit" disabled={!custom.trim()}>Add</Button>
            </form>
          </>
        )}

        <div className="row gap wrap save-row">
          <Button type="button" onClick={saveFocus} disabled={savingFocus || (!goalsDirty && !appsDirty)}>
            {savingFocus ? "Saving…" : "Save focus settings"}
          </Button>
          {(goalsDirty || appsDirty) && <span className="muted small">Unsaved changes</span>}
        </div>
      </section>

      {!desktop && (
        <details className="card setting-section phone-cache">
        <summary>
          <div>
            <h2>Phone nudge cache</h2>
            <p className="muted small">Optional. Pre-generate block-screen lines so the phone opens instantly, even offline.</p>
          </div>
        </summary>
        <div className="phone-cache-body">
          <div className="row gap wrap">
            <Button type="button" onClick={pregenerate} disabled={!canPregenerate}>
              {batching ? "Generating…" : `Pre-generate for ${Math.min(apps.length, 4)} app${Math.min(apps.length, 4) === 1 ? "" : "s"}`}
            </Button>
            <span className="muted small">
              {metaConfigured ? "Written by Muse Spark." : "Muse Spark is not configured, so these are local demo lines."}
            </span>
          </div>
          {batch.length > 0 && (
            <div className="batch-list">
              {batch.map((b) => (
                <div key={b.app} className="batch-group">
                  <h3>{b.app} <small className="muted">{(b.latencyMs / 1000).toFixed(1)}s · {b.model}</small></h3>
                  <ul className="prev-list">
                    {b.nudges.map((n) => (
                      <li key={n.id} className="prev"><span className="chip">{n.tone}</span><span>{n.preview}</span></li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          <hr />
          <div className="row gap wrap">
            <select value={testApp} onChange={(e) => setTestApp(e.target.value)} aria-label="App to test">
              {(apps.length ? apps : ["TikTok"]).map((a) => <option key={a}>{a}</option>)}
            </select>
            <Button size="sm" variant="secondary" type="button" onClick={testCache} disabled={testing}>
              {testing ? "Checking…" : "Pull next cached nudge"}
            </Button>
          </div>
          {cached && (
            <div className="cache-result">
              <blockquote className="nudge">{cached.nudge}</blockquote>
              <span className="chip">{cached.remaining} left in cache</span>
            </div>
          )}
          {cacheError && <p className="err small">Cache miss: {cacheError}</p>}
        </div>
      </details>
      )}

      <section className="card setting-section">
        <div className="section-head">
          <div>
            <h2>Tubby's look</h2>
            <p className="muted small">Fur colors and little props are cosmetic. Unlock them with points and wear them right away.</p>
          </div>
          <Button variant="secondary" type="button" onClick={() => navigate("/cosmetics")}>Open cosmetics</Button>
        </div>
      </section>

      {!desktop && (
        <section className="card setting-section">
          <div className="section-head">
            <div>
              <h2>Preview the block screen</h2>
              <p className="muted small">See what your phone and PC show over a guarded app. This uses your real points.</p>
            </div>
            <Button variant="secondary" type="button" onClick={() => setPreviewOpen(true)}>Open preview</Button>
          </div>
        </section>
      )}

      {(
        <section className="card setting-section">
          <div className="section-head">
            <div>
              <h2>Account</h2>
              <p className="muted small">
                {account
                  ? "Your points, streak and codes are saved to your Google account and follow you to the phone and Windows apps."
                  : authCfg?.google
                    ? "You're using a guest or demo profile here. Sign in with Google to keep your progress everywhere."
                    : "This device keeps a profile on the server. Replay the setup chat, start over, or try a demo profile with two weeks of history."}
              </p>
            </div>
          </div>
          {account && (
            <div className="account-row">
              {account.picture ? <img src={account.picture} alt="" referrerPolicy="no-referrer" /> : <span className="avatar-fallback">{(account.name ?? "?")[0]}</span>}
              <div>
                <b>{account.name ?? "Signed in"}</b>
                <span className="muted small">{account.email}</span>
              </div>
            </div>
          )}
          <div className="row gap wrap">
            {account ? (
              <Button variant="secondary" type="button" onClick={() => signOut()}>Sign out</Button>
            ) : authCfg?.google ? (
              <>
                <Button type="button" onClick={openSignIn}>Sign in with Google</Button>
                {localDeviceId().startsWith("demo-") && <Button variant="secondary" type="button" onClick={() => signOut()}>Exit demo</Button>}
              </>
            ) : null}
            <Button variant="secondary" type="button" onClick={replayOnboarding}>Replay onboarding</Button>
            {shellKind() === "web" && DOWNLOADS_URL && (
              <a className="link" href={DOWNLOADS_URL} target="_blank" rel="noreferrer">Get the Windows and Android apps</a>
            )}
            {!account && !localDeviceId().startsWith("demo-") && (
              <Button
                variant="secondary"
                type="button"
                disabled={profileBusy}
                onClick={async () => {
                  setProfileBusy(true);
                  try {
                    const shell = desktopBridge();
                    if (shell?.useDemo) await shell.useDemo();
                    else await loadDemoProfile();
                  } catch (e) {
                    toast(e instanceof Error ? e.message : "Could not load the demo profile", "err");
                    setProfileBusy(false);
                  }
                }}
              >
                {profileBusy ? "Loading…" : "Load demo profile"}
              </Button>
            )}
            {!account && shellKind() === "web" && (
              <button
                type="button"
                className="link"
                onClick={() => {
                  if (window.confirm("Start a new empty profile on this browser? Your current points stay on the old profile.")) startFresh();
                }}
              >
                Start fresh
              </button>
            )}
          </div>
        </section>
      )}

      <section className="card setting-section">
        <div className="section-head">
          <div>
            <h2>About</h2>
            <p className="muted small">{account ? "Signed in. Your points and settings are saved to your account." : "Guest profile on this browser. Your points and settings live on the server."}</p>
          </div>
        </div>
        <dl className="about-list">
          <div><dt>Device</dt><dd><code>{me?.deviceId ?? localDeviceId()}</code> <button type="button" className="link" onClick={() => { navigator.clipboard.writeText(me?.deviceId ?? localDeviceId()); toast("Device id copied"); }}>copy</button></dd></div>
          <div><dt>Coach</dt><dd>{assistantMode === "live" ? `Live · ${model}` : "Offline replies (no Meta key)"}</dd></div>
          <div><dt>Block-screen AI</dt><dd>{metaConfigured ? "Muse Spark" : "Local demo nudge"}</dd></div>
          {VOICE_ENABLED && <div><dt>Voice input</dt><dd>{speechSupported() ? "Available in this browser" : "Needs Chrome or Edge"}</dd></div>}
        </dl>
        <div className="row gap wrap">
          <Button size="sm" variant="secondary" type="button" onClick={() => { localStorage.removeItem("tubbybuddy.chat.v1"); toast("Chat cleared. Tubby starts fresh next time."); }}>Clear chat</Button>
          {VOICE_ENABLED && <Button size="sm" variant="secondary" type="button" onClick={() => { saveVoice({ enabled: false, rate: 1, uri: "" }); toast("Voice reset"); }}>Reset voice</Button>}
        </div>
        <p className="muted small about-foot">
          Four coach tones · points never expire · demo offers are fictional local businesses.
        </p>
      </section>

      <InterceptPreview open={previewOpen} onClose={() => setPreviewOpen(false)} />
      </Window>
    </div>
  );
}
