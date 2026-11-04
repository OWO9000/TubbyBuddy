import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCoach, useMe } from "../App";
import { api, type AssistantReply, type Me } from "../api";
import { CompanionView } from "./CompanionView";
import { Modal } from "./Modal";
import { Button } from "./aqua/button";
import { AppTile } from "./icons";
import { celebrate } from "./Celebration";
import { reactCompanion } from "./companionEvents";

const KEY = "tubbybuddy.focus.v1";
const DURATIONS = [15, 25, 45];

export interface FocusSession {
  minutes: number;
  startedAt: number;
  endsAt: number;
  claimed: boolean;
}

export function readFocusSession(): FocusSession | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null") as FocusSession | null;
    if (!raw || typeof raw.endsAt !== "number" || typeof raw.minutes !== "number") return null;
    return raw;
  } catch {
    return null;
  }
}

const save = (s: FocusSession | null) => {
  if (s) localStorage.setItem(KEY, JSON.stringify(s));
  else localStorage.removeItem(KEY);
};

const mmss = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

export function FocusSessionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, setMe, toast } = useMe();
  const { settings } = useCoach();
  const [session, setSession] = useState<FocusSession | null>(null);
  const [duration, setDuration] = useState(25);
  const [now, setNow] = useState(Date.now());
  const [phase, setPhase] = useState<"setup" | "running" | "done" | "early" | "confirm-quit">("setup");
  const [quitting, setQuitting] = useState(false);
  const [quitResult, setQuitResult] = useState<{ usedPass: boolean; burned: number } | null>(null);
  const hard = me?.difficulty === "hard";
  const [line, setLine] = useState("");
  const [lineLoading, setLineLoading] = useState(false);
  const [earned, setEarned] = useState(0);
  const completing = useRef(false);

  const complete = useCallback(
    async (s: FocusSession) => {
      if (s.claimed || completing.current) return;
      completing.current = true;
      const claimed = { ...s, claimed: true };
      setSession(claimed);
      save(claimed);
      try {
        const r = await api<Me & { earned: number; reason: string }>("/points/earn", {
          body: { deviceId: me?.deviceId, event: "focus_session", minutes: s.minutes },
        });
        setMe(r);
        setEarned(r.earned);
        setPhase("done");
        reactCompanion("earn");
        celebrate();
        toast(`+${r.earned} pts · ${r.reason}`);
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not bank the session", "err");
        setPhase("done");
      } finally {
        completing.current = false;
      }
    },
    [me?.deviceId, setMe, toast],
  );

  // Restore a session on open; complete it if it ended while the tab was closed.
  useEffect(() => {
    if (!open) return;
    const s = readFocusSession();
    if (!s) {
      setPhase("setup");
      setSession(null);
      return;
    }
    setSession(s);
    setDuration(s.minutes);
    setNow(Date.now());
    if (s.claimed) {
      // A finished session belongs to the previous visit; start clean next time.
      save(null);
      setSession(null);
      setPhase("setup");
      setEarned(0);
    } else if (Date.now() >= s.endsAt) {
      complete(s);
    } else {
      setPhase("running");
    }
  }, [open, complete]);

  useEffect(() => {
    if (!open || phase !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [open, phase]);

  useEffect(() => {
    if (phase !== "running" || !session) return;
    if (now >= session.endsAt) complete(session);
  }, [now, phase, session, complete]);

  const remaining = session ? session.endsAt - now : 0;
  const elapsedMinutes = session ? Math.max(1, Math.floor((now - session.startedAt) / 60_000)) : 1;
  const total = session ? session.minutes * 60_000 : 1;
  const progress = Math.max(0, Math.min(1, 1 - remaining / total));
  const ring = useMemo(() => {
    const r = 86;
    const c = 2 * Math.PI * r;
    return { r, c, dash: c * progress };
  }, [progress]);

  function start() {
    const s: FocusSession = { minutes: duration, startedAt: Date.now(), endsAt: Date.now() + duration * 60_000, claimed: false };
    save(s);
    setSession(s);
    setNow(Date.now());
    setEarned(0);
    setLine(`I'm guarding your next ${duration} minutes. Put your distractions away.`);
    setPhase("running");
  }

  function endEarly() {
    if (hard) {
      setPhase("confirm-quit");
      return;
    }
    save(null);
    setSession(null);
    setQuitResult(null);
    setPhase("early");
  }

  /** Hard mode: the server spends the weekly emergency pass, or burns a doubled slip and the streak. */
  async function confirmQuit() {
    if (quitting || !session) return;
    setQuitting(true);
    try {
      const r = await api<Me & { usedPass: boolean; burned: number }>("/focus/quit", {
        body: { deviceId: me?.deviceId, minutes: session.minutes },
      });
      setMe(r);
      setQuitResult({ usedPass: r.usedPass, burned: r.burned });
      if (r.burned > 0) reactCompanion("burn");
      save(null);
      setSession(null);
      setPhase("early");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not end the session", "err");
      setPhase("running");
    } finally {
      setQuitting(false);
    }
  }

  async function tempted() {
    if (lineLoading) return;
    setLineLoading(true);
    try {
      const r = await api<AssistantReply>("/assistant/chat", {
        method: "POST",
        body: {
          messages: [{
            role: "user",
            content: `I'm ${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"} into a ${session?.minutes ?? 25}-minute focus session and I want to quit. One sentence to keep me here.`,
          }],
        },
      });
      setLine(r.reply);
    } catch {
      setLine("Two more minutes. I'll sit with you.");
    } finally {
      setLineLoading(false);
    }
  }

  const active = phase === "running" && session && !session.claimed;

  return (
    <Modal open={open} onClose={onClose} title={active ? "Focus session" : "Focus with Tubby"}>
      {phase === "setup" && (
        <div className="focus-setup">
          <p className="muted">Pick a length, put distractions out of reach, and stay with one thing.</p>
          <div className="focus-durations" role="group" aria-label="Session length">
            {DURATIONS.map((d) => (
              <button key={d} type="button" className={`duration ${duration === d ? "on" : ""}`} aria-pressed={duration === d} onClick={() => setDuration(d)}>
                <b>{d}</b><span>min</span>
              </button>
            ))}
          </div>
          <div className="focus-guard">
            <span className="muted small">Guarding</span>
            <div className="chips guard-tiles">{settings.apps.map((a) => <span key={a} className="chip"><AppTile name={a} size={16} /> {a}</span>)}</div>
          </div>
          <Button size="lg" type="button" className="throb" onClick={start}>Start {duration} minutes</Button>
          <p className="muted small">
            {hard
              ? `Hard mode: ${me?.emergencyPassesLeft ? "one emergency pass left this week to stop early" : "no emergency pass left this week, so stopping early burns points"}. Finishing pays 30 points.`
              : "You earn 20 points when the timer finishes. No penalty for stopping early."}
          </p>
        </div>
      )}

      {active && (
        <div className="focus-running">
          <div className="focus-ring" style={{ ["--progress" as string]: `${progress * 360}deg` }}>
            <svg viewBox="0 0 200 200" aria-hidden="true">
              <circle cx="100" cy="100" r={ring.r} className="ring-bg" />
              <circle cx="100" cy="100" r={ring.r} className="ring-fg" strokeDasharray={`${ring.dash} ${ring.c}`} />
            </svg>
            <div className="focus-time">
              <b>{mmss(remaining)}</b>
              <span>{session.minutes} min</span>
            </div>
          </div>
          <div className="focus-cat"><CompanionView mood="neutral" size={150} /></div>
          <p className="focus-line" aria-live="polite">{lineLoading ? "Tubby is thinking…" : line || "One thing at a time. I'm here."}</p>
          <div className="row gap center wrap">
            <Button type="button" variant="secondary" onClick={tempted} disabled={lineLoading}>I'm tempted</Button>
            <button type="button" className="link" onClick={endEarly}>{hard ? "End early…" : "End session"}</button>
          </div>
          <p className="muted small">The timer keeps running if you close this window.</p>
        </div>
      )}

      {phase === "confirm-quit" && session && (
        <div className="focus-done">
          <CompanionView mood="worried" size={150} />
          <h2>Hard mode says stay.</h2>
          <p className="muted">
            {me?.emergencyPassesLeft
              ? "Ending now uses your one emergency pass for this week. No points lost."
              : "No emergency pass left this week. Ending now burns points and resets your streak."}
          </p>
          <div className="row gap center wrap">
            <Button size="lg" type="button" className="throb" onClick={() => setPhase("running")}>Keep going</Button>
            <button type="button" className="link" onClick={confirmQuit} disabled={quitting}>
              {quitting ? "Ending…" : me?.emergencyPassesLeft ? "Use my emergency pass" : "End anyway"}
            </button>
          </div>
        </div>
      )}

      {phase === "done" && (
        <div className="focus-done">
          <CompanionView mood="proud" size={180} />
          <h2>{earned > 0 ? `Session banked. +${earned} points.` : "Session complete."}</h2>
          <p className="muted">{session?.minutes} minutes of focus, banked.</p>
          <Button size="lg" type="button" onClick={onClose}>Back to Tubby</Button>
        </div>
      )}

      {phase === "early" && (
        <div className="focus-done">
          <CompanionView mood="worried" size={160} />
          <h2>Stopped early.</h2>
          <p className="muted">
            {quitResult?.usedPass
              ? "Emergency pass used. It comes back on Monday."
              : quitResult && quitResult.burned > 0
                ? `That cost ${quitResult.burned} points and the streak. Try 15 minutes next.`
                : "No points this time. A shorter session still counts, so try 15 minutes next."}
          </p>
          <Button size="lg" type="button" onClick={() => setPhase("setup")}>Try again</Button>
        </div>
      )}
    </Modal>
  );
}
