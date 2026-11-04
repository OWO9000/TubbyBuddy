import { useState } from "react";
import { useCoach, useMe } from "../App";
import { api, type Me } from "../api";
import { CompanionView } from "./CompanionView";
import { Modal } from "./Modal";
import { Button } from "./aqua/button";
import { reactCompanion } from "./companionEvents";
import { AppTile } from "./icons";
import { slipCost } from "../lib/points";

export function InterceptPreview({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, setMe, toast } = useMe();
  const { settings } = useCoach();
  const [app, setApp] = useState<string | null>(null);
  const [nudge, setNudge] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const atRisk = slipCost(me?.balance ?? 0, me?.difficulty === "hard");

  function reset() {
    setApp(null);
    setNudge("");
    setError("");
    setLoading(false);
  }

  async function preview(name: string) {
    setApp(name);
    setLoading(true);
    setError("");
    try {
      const r = await api<{ nudge: string; tone: string; mode?: string }>("/nudge", {
        body: {
          goals: settings.goals.length ? settings.goals : ["spend less time scrolling"],
          appName: name,
          pointsAtRisk: atRisk,
          streak: me?.streak ?? 0,
        },
      });
      setNudge(r.nudge);
      if (r.mode === "demo") setError("Offline line: Muse Spark didn't answer in time.");
    } catch (e) {
      setNudge(`Opening ${name}${atRisk > 0 ? ` burns ${atRisk} points` : ""}. Still want to?`);
      setError(e instanceof Error ? e.message : "Coach offline");
    } finally {
      setLoading(false);
    }
  }

  async function decide(putDown: boolean) {
    if (!app) return;
    try {
      if (putDown) {
        const r = await api<Me & { counted: boolean }>("/points/earn", { body: { deviceId: me?.deviceId, event: "resisted_temptation", appName: app } });
        setMe(r);
        toast(`Put down ${app}. Points come when a focus timer finishes.`);
        reactCompanion("wave");
      } else {
        const r = await api<Me & { burned: number }>("/points/burn", {
          body: { deviceId: me?.deviceId, reason: "Opened a limited app", amount: Math.max(1, atRisk), appName: app, breaksStreak: true, difficultyApplied: true },
        });
        setMe(r);
        toast(`Burned ${r.burned} pts on ${app}`, "err");
        reactCompanion("burn");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not record that", "err");
    }
    reset();
    onClose();
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Preview: Tubby steps in">
      {!app ? (
        <div className="intercept-preview">
          <p className="muted">
            Pick an app to see what Tubby shows when you open it on your phone or PC. This uses your real points.
          </p>
          <div className="phone-apps">
            {settings.apps.map((a) => (
              <button key={a} type="button" className="app-icon" onClick={() => preview(a)}>
                <AppTile name={a} size={40} />
                {a}
              </button>
            ))}
          </div>
          <p className="muted small">The apps here are the ones you guard in Settings.</p>
        </div>
      ) : (
        <div className="intercept">
          <CompanionView mood={loading ? "surprised" : "worried"} size={150} />
          <div className="intercept-app">Opening {app}…</div>
          <h2 className="intercept-title">Hold up.</h2>
          {loading ? (
            <div className="thinking">Tubby is writing something just for you<span className="dots" /></div>
          ) : (
            <>
              <blockquote className="nudge">{nudge}</blockquote>
              {error && <div className="err small">{error}</div>}
              <div className="row gap center wrap">
                <Button size="lg" type="button" className="throb" onClick={() => decide(true)}>Put it down</Button>
                <Button size="lg" variant="destructive" type="button" onClick={() => decide(false)}>
                  {atRisk > 0 ? `Continue anyway (burn ${atRisk})` : "Continue anyway"}
                </Button>
              </div>
              <p className="muted small">Putting it down keeps your points and streak. Continuing burns points and resets the streak.</p>
              <button type="button" className="link" onClick={reset}>Pick another app</button>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
