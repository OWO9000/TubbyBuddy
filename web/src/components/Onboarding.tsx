import { useEffect, useRef, useState } from "react";
import { useAuth, useCoach, useMe } from "../App";
import { api } from "../api";
import { Button } from "./aqua/button";
import { SendIcon } from "./icons";
import { reactCompanion, type Mood3D } from "./companionEvents";
import { DESKTOP_APPS, DESKTOP_SITES, SUGGESTED_APPS } from "../constants";
import { hasOnboarded, markOnboarded } from "../lib/flags";
import { loadDemoProfile } from "../lib/profile";
import { androidBridge, shellKind } from "../lib/native";
import { DialogueBox, Stage, useScript } from "./Stage";

export { hasOnboarded };

const GOAL_IDEAS = [
  "Read more books",
  "Sleep before midnight",
  "Go on walks every day",
  "Play guitar 30 minutes a day",
  "Be present with friends",
  "Ship my side project",
];

type Step = "greet" | "goals" | "apps" | "summary" | "done";

interface DesktopSetup {
  applySetup?: (s: { apps: string[]; sites: string[] }) => Promise<boolean>;
}
const desktop = () => (globalThis as { tubbyDesktop?: DesktopSetup }).tubbyDesktop;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function Onboarding({ onDone }: { onDone: () => void }) {
  const { save } = useCoach();
  const { toast } = useMe();
  const { account } = useAuth();
  const script = useScript();
  const shell = shellKind();
  const isDesktop = shell === "desktop";
  const isPhone = shell === "android";
  const appIdeas = isDesktop ? DESKTOP_APPS : SUGGESTED_APPS;
  const [step, setStep] = useState<Step>("greet");
  const [mood, setMood] = useState<Mood3D>("happy");
  const [input, setInput] = useState("");
  const [askedWhat, setAskedWhat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [goals, setGoals] = useState<string[]>([]);
  const [apps, setApps] = useState<string[]>([]);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const first = account?.name?.split(" ")[0];
    script.say([
      first ? `Hi ${first}! I'm Tubby.` : "Oh, hi! I'm Tubby.",
      "I'm a tiny cat who sits between you and the apps that eat your day. Very professional. Extremely pink.",
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (list: string[], value: string, cap: number) =>
    list.some((x) => same(x, value)) ? list.filter((x) => !same(x, value)) : [...list, value].slice(0, cap);

  function greetAnswer(what: boolean) {
    if (what) {
      setAskedWhat(true);
      setMood("proud");
      script.say([
        "When you're about to lose an hour to the feed, I pop up and ask nicely.",
        "Get through a focus timer and you earn points, and points become real life rewards. Give in, and points burn. I'm very serious about the real life part.",
        "Ready? It takes like a minute.",
      ]);
      return;
    }
    setMood("happy");
    script.say(["Okay! First: what do you want more time for? Pick a few, or just tell me."], () => setStep("goals"));
  }

  function finishGoals() {
    setStep("apps");
    setMood("proud");
    script.say(
      [
        goals.length > 1 ? "Ooh, ambitious. I like it." : "Good one.",
        isDesktop
          ? "Now, which apps and sites are the little time thieves? I'll keep my big eyes on them."
          : "Now, which apps are the little time thieves? I'll keep my big eyes on them.",
      ],
    );
  }

  function finishApps() {
    setStep("summary");
    setMood("happy");
    const list = `${apps.slice(0, 3).join(", ")}${apps.length > 3 ? ` and ${apps.length - 3} more` : ""}`;
    script.say([
      "Noted. They never see me coming.",
      `Here's the plan: I'll guard ${list}. When you slip, I'll remind you about “${goals[0]}”. Rewards will lean toward what you're after. Deal?`,
    ]);
  }

  async function finish() {
    setBusy(true);
    try {
      await save({ goals, apps });
      const d = desktop();
      if (d?.applySetup) {
        const sites = apps.filter((a) => DESKTOP_SITES.some((s) => same(s, a)));
        const programs = apps.filter((a) => !sites.includes(a));
        await d.applySetup({ apps: programs, sites }).catch(() => false);
      }
      await androidBridge()?.applySetup({ apps }).catch(() => false);
      setStep("done");
      setMood("happy");
      reactCompanion("earn");
      script.say([
        "Yay!! Okay. I'll be right here. Watching. Lovingly.",
        isDesktop
          ? "I'm watching those on this PC now. Change the list any time under Settings, Desktop guard."
          : isPhone
            ? "Last thing: Android needs your OK before I can step in. It's a few taps, and I'll show you each one."
            : "One honest thing: in a browser tab I can't block anything. I do that from the Windows and Android apps, and they share this account. The download links are under Get the apps in the menu bar, and in Settings.",
      ]);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save your setup", "err");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    markOnboarded();
    setLeaving(true);
    setTimeout(onDone, 420);
  }

  /** Free text: a custom goal on the goals step, a custom app on the apps step. */
  function sendText() {
    const t = input.trim().slice(0, step === "goals" ? 300 : 60);
    if (!t) return;
    setInput("");
    if (step === "goals") {
      if (goals.length >= 6) return;
      setThinking(true);
      setMood("neutral");
      script.say(["Hmm, let me read that…"]);
      // Muse splits "study more and go outside" into separate goals and says what each is about (offers follow them).
      api<{ goals: { goal: string }[]; reply: string }>("/assistant/goals", { body: { text: t } })
        .then((r) => {
          setGoals((prev) => {
            const next = [...prev];
            for (const g of r.goals.map((x) => x.goal)) if (next.length < 6 && !next.some((x) => same(x, g))) next.push(g);
            return next;
          });
          script.say([r.reply]);
        })
        .catch(() => {
          setGoals((prev) => (prev.some((x) => same(x, t)) ? prev : [...prev, t]));
          script.say([`“${t}”. Added.`]);
        })
        .finally(() => {
          setThinking(false);
          setMood("happy");
        });
    } else if (step === "apps") {
      if (apps.length >= 12) return;
      setApps((prev) => (prev.some((x) => same(x, t)) ? prev : [...prev, t]));
      script.say([`${t}? Say less. On the list.`]);
    }
  }

  const chips = (ideas: string[], picked: string[], onPick: (v: string) => void, label: string) => (
    <div className="pick-chips" role="group" aria-label={label}>
      {[...ideas, ...picked.filter((g) => !ideas.some((i) => same(i, g)))].map((g) => {
        const on = picked.some((x) => same(x, g));
        return (
          <button key={g} type="button" className={`pick-chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => onPick(g)}>{g}</button>
        );
      })}
    </div>
  );

  const composer = (
    <form className="intro-composer" onSubmit={(e) => { e.preventDefault(); sendText(); }}>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={step === "goals" ? "Or type your own goal…" : isDesktop ? "Or type another app or site…" : "Or type another app…"}
        maxLength={step === "goals" ? 300 : 60}
        aria-label={step === "goals" ? "Your own goal" : "Another app"}
        disabled={thinking}
      />
      <button type="submit" className="send-btn" disabled={!input.trim() || thinking} aria-label="Add"><SendIcon size={18} /></button>
    </form>
  );

  return (
    <Stage
      label="Set up TubbyBuddy"
      mood={mood}
      leaving={leaving}
      actions={
        step !== "done" && (
          <>
            <button type="button" className="intro-link" onClick={close}>Skip</button>
            <button
              type="button"
              className="intro-link"
              onClick={() => loadDemoProfile().catch((e) => toast(e instanceof Error ? e.message : "Could not load the demo profile", "err"))}
            >
              Try a demo profile
            </button>
          </>
        )
      }
    >
      <DialogueBox script={script}>
        {step === "greet" && (
          <div className="choices">
            <Button size="lg" type="button" className="throb" onClick={() => greetAnswer(false)}>Let's set me up</Button>
            {!askedWhat && <Button size="lg" variant="secondary" type="button" onClick={() => greetAnswer(true)}>What do you do?</Button>}
          </div>
        )}

        {step === "goals" && (
          <>
            {chips(GOAL_IDEAS, goals, (g) => setGoals((p) => toggle(p, g, 6)), "Goal ideas")}
            {composer}
            <div className="choices end">
              <Button type="button" onClick={finishGoals} disabled={!goals.length || thinking}>
                {goals.length ? "That's all" : "Pick at least one"}
              </Button>
            </div>
          </>
        )}

        {step === "apps" && (
          <>
            {chips(appIdeas, apps, (a) => setApps((p) => toggle(p, a, 12)), isDesktop ? "Apps and sites to guard" : "Apps to guard")}
            {composer}
            <div className="choices end">
              <Button type="button" onClick={finishApps} disabled={!apps.length}>
                {apps.length ? "That's all" : "Pick at least one"}
              </Button>
            </div>
          </>
        )}

        {step === "summary" && (
          <div className="choices">
            <Button size="lg" type="button" className="throb" onClick={finish} disabled={busy}>{busy ? "Saving…" : "Deal. Let's go!"}</Button>
          </div>
        )}

        {step === "done" && (
          <div className="choices">
            {isPhone ? (
              <>
                <Button size="lg" type="button" className="throb" onClick={() => { androidBridge()?.openGuardSetup().catch(() => undefined); close(); }}>
                  Set up the phone guard
                </Button>
                <Button size="lg" variant="secondary" type="button" onClick={close}>Later</Button>
              </>
            ) : (
              <Button size="lg" type="button" className="throb" onClick={close}>Let's go</Button>
            )}
          </div>
        )}
      </DialogueBox>
    </Stage>
  );
}

