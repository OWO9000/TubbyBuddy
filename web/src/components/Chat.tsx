import { useEffect, useRef, useState } from "react";
import { useCoach, useMe } from "../App";
import { api, type AssistantReply, type ChatMessage } from "../api";
import { FOCUS_MODES, type FocusMode } from "../lib/modes";
import { slipCost } from "../lib/points";
import type { Mood3D } from "./companionEvents";
import { listen, speak, speechSupported, stopSpeaking } from "../voice";
import { VOICE_ENABLED } from "../constants";
import { Window } from "./Window";
import { MicIcon, RestartIcon, SendIcon, SpeakerIcon, StopIcon } from "./icons";

const CHAT_KEY = "tubbybuddy.chat.v1";
const MAX_MESSAGES = 40;

const SUGGESTIONS = ["I want to scroll", "Plan my next hour", "Why does this matter?", "I need a pep talk"];

type GuardConfig = { blockedApps: string[]; blockedSites: string[]; allowlist?: string[]; demoMode: boolean; paused: boolean };
type UnlockResult = { allowed: boolean; burned: number; penaltyMinutes: number; penaltyUntil: number; unlockedUntil: number; offline?: boolean; reason: string };
type DesktopBridge = {
  guardConfig?: () => Promise<GuardConfig>;
  unlockApp?: (appName: string) => Promise<UnlockResult>;
  demoOff?: () => Promise<boolean>;
};
type PendingUnlock = { app: string; points: number; estimate: number };

function desktopBridge(): DesktopBridge | undefined {
  return (globalThis as { tubbyDesktop?: DesktopBridge }).tubbyDesktop;
}

function detectUnlockApp(text: string, config: GuardConfig): string | null {
  const t = text.toLowerCase();
  const wants = /\b(open|launch|use|unblock|let me (open|use))\b/i.test(t);
  if (!wants) return null;
  const apps = [...(config.blockedApps || []), ...(config.blockedSites || [])]
    .map((a) => String(a || "").trim())
    .filter((a) => a.length > 2)
    .filter((a) => !(config.allowlist || []).some((x) => String(x || "").toLowerCase() === a.toLowerCase()));
  return apps.find((a) => t.includes(a.toLowerCase())) ?? null;
}

function isNo(text: string): boolean {
  return /\b(no|nope|not|cancel|never mind|nevermind|nvm|stop|don'?t|wait)\b/i.test(text);
}

/** A yes that also contains a no ("not okay", "ok wait, don't") is not a yes: these answers can burn points. */
function isYes(text: string): boolean {
  return /\b(yes|yeah|yep|sure|okay|ok|do it|open it|go ahead|fine)\b/i.test(text) && !isNo(text);
}



/**
 * "night mode?", "turn on deep focus", "switch to study" → the matching preset.
 * A mode name alone isn't a request ("I keep opening TikTok at night" is a problem to talk about, not a command).
 */
function detectMode(text: string): FocusMode | null {
  const t = text.toLowerCase();
  for (const m of FOCUS_MODES) {
    const name = m.id === "deep-focus" ? "deep\\s*focus" : m.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const asksForMode = new RegExp(`\\b${name}\\s+mode\\b`).test(t);
    const commands = new RegExp(`\\b(turn on|switch to|start|enable|go into|use|do|try)\\s+(the\\s+)?${name}\\b`).test(t);
    if (asksForMode || commands) return m;
  }
  return null;
}

function loadChat(): ChatMessage[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CHAT_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-MAX_MESSAGES) as ChatMessage[];
  } catch {
    return [];
  }
}

export function Chat({ onLine, onThinking }: { onLine: (text: string, mood: Mood3D) => void; onThinking: (thinking: boolean) => void }) {
  const { toast, me, refresh } = useMe();
  const { voice, saveVoice, settings, save } = useCoach();
  const [messages, setMessages] = useState<ChatMessage[]>(loadChat);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [pendingUnlock, setPendingUnlock] = useState<PendingUnlock | null>(null);
  const [pendingMode, setPendingMode] = useState<FocusMode | null>(null);
  const [greetingLoading, setGreetingLoading] = useState(messages.length === 0);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const initRef = useRef(false);
  // Guards against a double click or a second Enter before React re-renders; an unlock can burn points.
  const busyRef = useRef(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // The greeting resolves after mount; read settings through a ref so the night-mode offer sees the saved apps.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    localStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-MAX_MESSAGES)));
  }, [messages]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinking, listening]);

  useEffect(() => () => stopRef.current?.(), []);

  // Greet once per mount. With history, put the last reply in the speech bubble instead.
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const last = messagesRef.current[messagesRef.current.length - 1];
    if (last?.role === "assistant") {
      onLine(last.content, "happy");
      setGreetingLoading(false);
      return;
    }
    onLine("Just a sec…", "neutral");
    api<{ message: string; mood: Mood3D }>("/assistant/hello", { method: "POST", body: {} })
      .then((r) => {
        const greeting: ChatMessage = { role: "assistant", content: r.message, at: Date.now() };
        setMessages((m) => (m.length ? m : [greeting]));
        onLine(r.message, r.mood);
        setGreetingLoading(false);
        maybeSuggestNightMode();
      })
      .catch(() => {
        const fallback = "Hey. What's pulling at you right now?";
        setMessages((m) => (m.length ? m : [{ role: "assistant", content: fallback, at: Date.now() }]));
        onLine(fallback, "happy");
        setGreetingLoading(false);
      });
  }, [onLine]);

  /** Late hours → Tubby proactively offers Night mode, with the app list up front. */
  function maybeSuggestNightMode() {
    const h = new Date().getHours();
    if (h < 21 && h >= 5) return;
    const night = FOCUS_MODES.find((m) => m.id === "night");
    if (!night) return;
    const current = settingsRef.current;
    const already = night.apps.every((a) => current.apps.some((x) => x.toLowerCase() === a.toLowerCase()));
    if (already) return;
    const goal = current.goals[0];
    appendAssistant(
      `It's getting late${goal ? `, and you said “${goal}”` : ""}. Want Night mode? I'd guard ${night.apps.join(", ")}.`,
      "happy",
    );
    setPendingMode(night);
  }

  async function appendAssistant(content: string, mood: Mood3D = "worried") {
    const reply: ChatMessage = { role: "assistant", content, at: Date.now() };
    setMessages((m) => [...m, reply].slice(-MAX_MESSAGES));
    onLine(content, mood);
    if (voice.enabled) speak(content, { rate: voice.rate, voiceURI: voice.uri });
  }

  async function askUnlock(app: string) {
    const points = me?.balance ?? 0;
    const hard = me?.difficulty === "hard";
    const estimate = points >= 10 ? slipCost(points, hard) : 0;
    if (me?.unlocksLeft === 0) {
      await appendAssistant(`No unlocks left today, so ${app} stays guarded. The count resets at midnight.`, "worried");
      return;
    }
    const left = typeof me?.unlocksLeft === "number" ? ` · ${me.unlocksLeft} unlock${me.unlocksLeft === 1 ? "" : "s"} left today` : "";
    const question = points >= 10
      ? `Opening ${app} will turn its guard off for 10 minutes and burn ${estimate} points${hard ? " (hard mode)" : ""}. Are you sure?${left}`
      : `You have ${points} point${points === 1 ? "" : "s"}. I can open ${app} for 10 minutes, but earning will be 50% slower for ${hard ? 60 : 30} minutes. Are you sure?${left}`;
    setPendingUnlock({ app, points, estimate });
    await appendAssistant(question, "worried");
  }

  async function performUnlock(pending: PendingUnlock) {
    const bridge = desktopBridge();
    if (!bridge?.unlockApp) {
      toast("Desktop guard is not connected", "err");
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setPendingUnlock(null);
    setThinking(true);
    onThinking(true);
    try {
      const r = await bridge.unlockApp(pending.app);
      let message: string;
      if (!r.allowed) message = r.reason || "No unlocks left today. The guard stays up.";
      else if (r.offline) message = `${pending.app} is open for 10 minutes. The backend was offline, so I couldn't log the cost.`;
      else if (r.burned > 0) message = `Done. ${pending.app} is open for 10 minutes. That cost ${r.burned} points.`;
      else if (r.penaltyMinutes > 0) message = `Fine. ${pending.app} is open for 10 minutes. No points to burn, so earning is 50% slower for ${r.penaltyMinutes} minutes. I'm not thrilled about it.`;
      else message = `Done. ${pending.app} is open for 10 minutes.`;
      await appendAssistant(message, "worried");
      await refresh().catch(() => undefined);
    } catch (e) {
      await appendAssistant(e instanceof Error ? e.message : "I couldn't unlock it. The guard is still up.");
    } finally {
      busyRef.current = false;
      setThinking(false);
      onThinking(false);
    }
  }

  async function cancelUnlock() {
    setPendingUnlock(null);
    await appendAssistant("Good. The guard stays up. What else is on your mind?", "happy");
  }

  /** Mode switches are deterministic: Tubby names the apps, the user confirms, the settings save. */
  async function askMode(mode: FocusMode) {
    setPendingMode(mode);
    await appendAssistant(
      `${mode.name} mode: I'd guard ${mode.apps.join(", ")}, with ${mode.minutes}-minute focus sessions. Turn it on?`,
      "happy",
    );
  }

  async function applyMode(mode: FocusMode) {
    setPendingMode(null);
    try {
      await save({ apps: mode.apps });
      await appendAssistant(`${mode.name} mode is on. ${mode.apps.length} apps guarded. Go do the thing!`, "proud");
    } catch {
      await appendAssistant("Hmm, I couldn't save that. Try the modes card in Settings?", "worried");
    }
  }

  async function cancelMode() {
    setPendingMode(null);
    await appendAssistant("Okay, staying as we are.", "happy");
  }

  async function send(text: string) {
    const content = text.trim().slice(0, 1000);
    if (!content || thinking || busyRef.current) return;
    stopSpeaking();
    stopRef.current?.();
    setListening(false);
    setInterim("");
    setInput("");
    const userMsg: ChatMessage = { role: "user", content, at: Date.now() };
    const next = [...messagesRef.current, userMsg].slice(-MAX_MESSAGES);
    setMessages(next);

    // A pending "open Telegram?" question must be answered before anything else.
    if (pendingUnlock) {
      if (isYes(content)) {
        await performUnlock(pendingUnlock);
        return;
      }
      if (isNo(content)) {
        await cancelUnlock();
        return;
      }
      await appendAssistant("I still need a yes or no before I touch the guard.", "worried");
      return;
    }

    // Same for a pending mode switch. Modes cost nothing, so a non-answer just moves on.
    if (pendingMode) {
      if (isYes(content)) {
        await applyMode(pendingMode);
        return;
      }
      if (isNo(content)) {
        await cancelMode();
        return;
      }
      setPendingMode(null);
    }

    // "night mode?" / "turn on deep focus" → deterministic mode confirmation, never left to the model.
    const mode = detectMode(content);
    if (mode) {
      await askMode(mode);
      return;
    }

    // Desktop-only action: "open Telegram" asks for confirmation before any burn.
    const bridge = desktopBridge();
    if (bridge?.guardConfig && bridge.unlockApp) {
      try {
        const cfg = await bridge.guardConfig();
        const app = detectUnlockApp(content, cfg);
        if (app) {
          await askUnlock(app);
          return;
        }
      } catch {
        /* fall back to the coach */
      }
    }

    busyRef.current = true;
    setThinking(true);
    onThinking(true);
    try {
      const history = next.slice(-12).map((m) => ({ role: m.role, content: m.content }));
      const r = await api<AssistantReply>("/assistant/chat", { method: "POST", body: { messages: history } });
      const reply: ChatMessage = { role: "assistant", content: r.reply, at: Date.now() };
      setMessages((m) => [...m, reply].slice(-MAX_MESSAGES));
      onLine(r.reply, r.mood);
      if (voice.enabled) speak(r.reply, { rate: voice.rate, voiceURI: voice.uri });
      if (r.fallback) toast("Tubby lost the connection for a moment. That was an offline reply.", "err");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      toast(msg, "err");
      const reply: ChatMessage = { role: "assistant", content: "I lost the thread for a second. Try me again?", at: Date.now() };
      setMessages((m) => [...m, reply].slice(-MAX_MESSAGES));
      onLine(reply.content, "worried");
    } finally {
      busyRef.current = false;
      setThinking(false);
      onThinking(false);
    }
  }

  function toggleMic() {
    if (listening) {
      stopRef.current?.();
      setListening(false);
      setInterim("");
      return;
    }
    if (!speechSupported()) {
      toast("Voice input needs Chrome or Edge", "err");
      return;
    }
    stopSpeaking();
    setListening(true);
    setInterim("");
    stopRef.current = listen({
      onInterim: setInterim,
      onFinal: (text) => {
        setListening(false);
        setInterim("");
        send(text);
      },
      onEnd: () => {
        setListening(false);
        setInterim("");
      },
      onError: (message) => {
        setListening(false);
        setInterim("");
        toast(message, "err");
      },
    });
  }

  function clearChat() {
    if (!window.confirm("Clear your chat with Tubby?")) return;
    localStorage.removeItem(CHAT_KEY);
    setMessages([]);
    setGreetingLoading(true);
    stopSpeaking();
    api<{ message: string; mood: Mood3D }>("/assistant/hello", { method: "POST", body: { fresh: true } })
      .then((r) => {
        setMessages([{ role: "assistant", content: r.message, at: Date.now() }]);
        onLine(r.message, r.mood);
      })
      .catch(() => undefined)
      .finally(() => setGreetingLoading(false));
  }

  return (
    <Window title="Chat" className="chat-card" aria-label="Chat with Tubby">
      <header className="chat-head">
        <div className="chat-id">
          <img src="/tubby/tubby_happy.png" alt="" width={38} height={38} />
          <div>
            <b>Tubby</b>
            <span>{settings.tone === "direct" ? "straight talk" : settings.tone === "playful" ? "in a good mood" : settings.tone === "calm" ? "calm and here" : "here with you"}</span>
          </div>
        </div>
        <div className="chat-tools">
          {VOICE_ENABLED && (
          <button
            type="button"
            className={`icon-btn ${voice.enabled ? "on" : ""}`}
            aria-pressed={voice.enabled}
            title={voice.enabled ? "Turn voice replies off" : "Turn voice replies on"}
            onClick={() => saveVoice({ enabled: !voice.enabled })}
          >
            <SpeakerIcon size={17} muted={!voice.enabled} />
            <span className="sr-only">Voice replies</span>
          </button>
          )}
          <button type="button" className="icon-btn" title="Clear chat" onClick={clearChat}>
            <RestartIcon size={16} /><span className="sr-only">Clear chat</span>
          </button>
        </div>
      </header>

      <div className="chat-body" ref={bodyRef} aria-live="polite">
        {messages.map((m, i) => (
          <div key={`${m.at}-${i}`} className={`msg ${m.role}`}>
            {m.role === "assistant" && <img className="msg-avatar" src="/tubby/tubby_happy.png" alt="" width={26} height={26} />}
            <div className="bubble">{m.content}</div>
          </div>
        ))}
        {greetingLoading && (
          <div className="msg assistant">
            <img className="msg-avatar" src="/tubby/tubby_neutral.png" alt="" width={26} height={26} />
            <div className="bubble typing" aria-label="Tubby is waking up">
              <span /><span /><span />
            </div>
          </div>
        )}
        {!greetingLoading && !messages.some((m) => m.role === "user") && (
          <div className="chat-starter">
            <p>I'm all ears. Ask for a plan, a nudge, or just say what's on your mind.</p>
            <div className="suggestions inline">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="suggestion" onClick={() => send(s)} disabled={thinking}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {thinking && (
          <div className="msg assistant">
            <img className="msg-avatar" src="/tubby/tubby_neutral.png" alt="" width={26} height={26} />
            <div className="bubble typing" aria-label="Tubby is typing">
              <span /><span /><span />
            </div>
          </div>
        )}
        {pendingUnlock && !thinking && (
          <div className="chat-unlock-confirm">
            <button type="button" className="suggestion on" onClick={() => performUnlock(pendingUnlock)}>
              Yes, open {pendingUnlock.app}
            </button>
            <button type="button" className="suggestion" onClick={cancelUnlock}>
              Never mind
            </button>
          </div>
        )}
        {pendingMode && !thinking && (
          <div className="chat-unlock-confirm">
            <button type="button" className="suggestion on" onClick={() => applyMode(pendingMode)}>
              Turn on {pendingMode.name} mode
            </button>
            <button type="button" className="suggestion" onClick={cancelMode}>
              Never mind
            </button>
          </div>
        )}
      </div>

      {!pendingUnlock && messages.some((m) => m.role === "user") && messages.length < 6 && (
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="suggestion" onClick={() => send(s)} disabled={thinking}>
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        className={`composer ${listening ? "listening" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        {VOICE_ENABLED && (
        <button
          type="button"
          className={`mic-btn ${listening ? "on" : ""}`}
          onClick={toggleMic}
          title={speechSupported() ? "Talk to Tubby" : "Voice input needs Chrome or Edge"}
          aria-label={listening ? "Stop listening" : "Talk to Tubby"}
          aria-pressed={listening}
        >
          {listening ? <StopIcon size={16} /> : <MicIcon size={18} />}
        </button>
        )}
        <input
          value={listening ? interim : input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={listening ? "Listening…" : "Talk to Tubby…"}
          maxLength={1000}
          aria-label="Message Tubby"
          readOnly={listening}
        />
        <button type="submit" className="send-btn" disabled={thinking || listening || !input.trim()} aria-label="Send">
          <SendIcon size={18} />
        </button>
      </form>
      <div className="composer-hint">
        <span>{listening ? "Listening" : voice.enabled ? "Tubby reads replies aloud" : ""}</span>
        <span className="muted">{settings.brevity === "short" ? "Short answers" : "A little more detail"}</span>
      </div>
    </Window>
  );
}
