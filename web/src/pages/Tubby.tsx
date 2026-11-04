import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMe } from "../App";
import { COMPANION_NAME, api, type Me, type WeeklyReport } from "../api";
import { CompanionView } from "../components/CompanionView";
import { Chat } from "../components/Chat";
import { FocusSessionModal, readFocusSession } from "../components/FocusSession";
import { Button } from "../components/aqua/button";
import { Window } from "../components/Window";
import { FlameIcon } from "../components/icons";
import { celebrate } from "../components/Celebration";
import { reactCompanion, type Mood3D } from "../components/companionEvents";
import { equippedMap } from "../lib/equipped";
import { moodFor, type Mood } from "../components/Companion";

const MOOD_LABEL: Record<string, string> = {
  neutral: "keeping an eye on you",
  happy: "happy to see you",
  proud: "proud of you",
  worried: "a little worried",
  surprised: "surprised",
  angry: "not impressed",
  sleepy: "sleepy",
  singed: "a little singed",
};

export default function Tubby() {
  const { me, setMe, toast } = useMe();
  const navigate = useNavigate();
  const [line, setLine] = useState("…");
  const [mood, setMood] = useState<Mood3D>("neutral");
  const [thinking, setThinking] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);
  const [focusLeft, setFocusLeft] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [score, setScore] = useState<number | null>(null);

  useEffect(() => {
    api<WeeklyReport>("/report/weekly?note=false").then((r) => setScore(r.score)).catch(() => undefined);
  }, [me?.balance]);

  const onLine = useCallback((text: string, m: Mood3D) => {
    setLine(text);
    setMood(m);
  }, []);

  useEffect(() => {
    const s = readFocusSession();
    setFocusLeft(s && !s.claimed ? Math.max(0, s.endsAt - Date.now()) : null);
  }, [focusOpen]);

  useEffect(() => {
    if (focusLeft === null) return;
    const t = setInterval(() => setFocusLeft((v) => (v === null ? null : Math.max(0, v - 1000))), 1000);
    return () => clearInterval(t);
  }, [focusLeft]);

  async function checkIn() {
    if (checking) return;
    setChecking(true);
    try {
      const r = await api<Me & { earned: number; reason: string; streak: number }>("/points/earn", {
        body: { deviceId: me?.deviceId, event: "streak_day", tzOffset: new Date().getTimezoneOffset() },
      });
      setMe(r);
      setMood("proud");
      setLine(`Day ${r.streak} banked. +${r.earned} points.`);
      reactCompanion("earn");
      celebrate();
      toast(`Checked in · +${r.earned} pts`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not check in", "err");
    } finally {
      setChecking(false);
    }
  }

  // Same calendar day the server uses for the streak (the browser's local date).
  const localToday = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  const checkedInToday = me?.lastStreakDay === localToday;
  const equipped = equippedMap(me);
  const baseMood: Mood = moodFor(me?.streak ?? 0);
  const shownMood = thinking ? "surprised" : (mood === "neutral" && me ? baseMood : mood);
  const unlocked = me?.achievements.filter((a) => a.unlocked).length ?? 0;
  const focusMinutesLeft = focusLeft && focusLeft > 0 ? Math.ceil(focusLeft / 60000) : 0;

  // The cat (and the little hearts by its ear) always fits inside the window, down to small phones.
  const [catSize, setCatSize] = useState(() => Math.min(330, Math.max(180, window.innerWidth - 110)));
  useEffect(() => {
    const onResize = () => setCatSize(Math.min(330, Math.max(180, window.innerWidth - 110)));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div className="tubby-page">
      <Window title="Tubby" className="tubby-stage">
        <div className="stage-top">
          <div className={`speech ${thinking ? "thinking" : ""}`} aria-live="polite">
            {thinking ? <span>Tubby is thinking<span className="dots" /></span> : <span className="speech-text">{line}</span>}
          </div>
        </div>

        <div className="cat-wrap">
          <CompanionView mood={shownMood} equipped={equipped} size={catSize} label={`${COMPANION_NAME} the cat`} />
        </div>

        <div className="stage-name">
          <h1>{COMPANION_NAME}</h1>
          <span>{MOOD_LABEL[shownMood] ?? "here with you"}</span>
        </div>

        <div className="stage-stats">
          <div><b>{me?.balance.toLocaleString() ?? "…"}</b><span>points</span></div>
          <div><b>{me?.streak ?? 0}<FlameIcon size={16} /></b><span>day streak</span></div>
          <Link to="/achievements" title="This week's Focus Score"><b>{score ?? "…"}</b><span>focus score</span></Link>
          <div><b>{unlocked}/{me?.achievements.length ?? 0}</b><span>badges</span></div>
        </div>

        <div className="stage-actions">
          <Button size="lg" type="button" className="throb" onClick={() => setFocusOpen(true)}>
            {focusMinutesLeft > 0 ? `Resume focus · ${focusMinutesLeft}m` : "Start a focus session"}
          </Button>
          <Button size="lg" variant="secondary" type="button" onClick={checkIn} disabled={checking || !me || checkedInToday}>
            {checking ? "Checking in…" : checkedInToday ? "Checked in today" : "Check in today"}
          </Button>
        </div>

        <div className="stage-links">
          <button type="button" className="link" onClick={() => navigate("/cosmetics")}>Change Tubby's fur</button>
        </div>
      </Window>

      <Chat onLine={onLine} onThinking={setThinking} />

      <FocusSessionModal open={focusOpen} onClose={() => setFocusOpen(false)} />
    </div>
  );
}
