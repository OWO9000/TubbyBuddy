import { useEffect, useRef, useState } from "react";
import { DOWNLOADS_URL, TAGLINE } from "../api";
import { completeGoogleSignIn, desktopBridge, loadGoogleIdentity, type Account, type AuthConfig } from "../lib/auth";
import { setGuest } from "../lib/flags";
import { loadDemoProfile } from "../lib/profile";
import { Button } from "./aqua/button";
import { DialogueBox, Stage, useScript } from "./Stage";

/** Google's own rendered button (web). On the Windows app, sign-in happens in the system browser instead. */
export function GoogleButton({ clientId, onSignedIn, onError }: { clientId: string; onSignedIn: (a: Account) => void; onError: (msg: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef({ onSignedIn, onError });
  cb.current = { onSignedIn, onError };
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadGoogleIdentity()
      .then((gid) => {
        if (cancelled || !ref.current) return;
        gid.initialize({
          client_id: clientId,
          ux_mode: "popup",
          itp_support: true,
          callback: ({ credential }) => {
            completeGoogleSignIn(credential)
              .then((a) => cb.current.onSignedIn(a))
              .catch((e) => cb.current.onError(e instanceof Error ? e.message : "Sign-in failed"));
          },
        });
        const width = Math.min(300, Math.max(220, ref.current.parentElement?.clientWidth ?? 300));
        gid.renderButton(ref.current, { theme: "outline", size: "large", shape: "pill", text: "continue_with", logo_alignment: "left", width });
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) cb.current.onError(e instanceof Error ? e.message : "Google sign-in is unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return (
    <div className="google-slot">
      <div ref={ref} />
      {loading && <div className="google-placeholder" aria-hidden="true" />}
    </div>
  );
}

/** First screen for anyone without an account: Tubby waves, introduces itself and asks you to sign in. */
export function Welcome({ config, onClose, onGuest }: { config: AuthConfig; onClose?: () => void; onGuest: () => void }) {
  const desktop = desktopBridge();
  const script = useScript();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"google" | "demo" | null>(null);
  const canGoogle = config.google && (desktop?.signIn ? true : !!config.googleClientId);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    script.say(
      onClose
        ? ["Want to keep your own points? Sign in and they follow you between your phone and your PC."]
        : [
            "Oh, hi! I'm Tubby.",
            "I guard the apps and sites that eat your day. Finish focus timers to earn points, spend them on real things nearby, or watch your points burn when you slip.",
            canGoogle
              ? "Sign in first, so your points, streak and codes follow you between your phone and your PC."
              : "Sign-in isn't switched on for this server yet, so your progress stays on this device for now.",
          ],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function desktopSignIn() {
    setError(null);
    setBusy("google");
    const r: { ok: boolean; error?: string; cancelled?: boolean } = await desktop!.signIn!().catch((e) => ({ ok: false, error: e instanceof Error ? e.message : "Sign-in failed" }));
    if (!r.ok) {
      if (!r.cancelled) setError(r.error ?? "Sign-in didn't finish. Try again.");
      setBusy(null);
    }
  }

  async function demo() {
    setError(null);
    setBusy("demo");
    try {
      setGuest(false);
      if (desktop?.useDemo) await desktop.useDemo();
      else await loadDemoProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the demo account");
      setBusy(null);
    }
  }

  function guest() {
    setGuest(true);
    onGuest();
  }

  return (
    <Stage
      label={TAGLINE}
      title={TAGLINE}
      actions={onClose && <button type="button" className="intro-link" onClick={onClose}>Back to the demo</button>}
    >
      <DialogueBox
        script={script}
        footer={
          <>
            {error && <p className="err small" role="alert">{error}</p>}
            {!desktop && (
              <p className="intro-note">
                Web preview. Blocking happens in the{" "}
                <a href={DOWNLOADS_URL} target="_blank" rel="noreferrer">Windows and Android apps</a>, and one sign-in keeps all three in sync.
              </p>
            )}
            {canGoogle && <p className="intro-note">We only use your name, email and photo.</p>}
          </>
        }
      >
        <div className="choices">
          {canGoogle && desktop?.signIn && (
            <Button size="lg" type="button" className="throb" onClick={desktopSignIn} disabled={busy !== null}>
              {busy === "google" ? "Finish signing in in your browser…" : "Sign in with Google"}
            </Button>
          )}
          {canGoogle && !desktop?.signIn && config.googleClientId && (
            <GoogleButton clientId={config.googleClientId} onSignedIn={() => location.assign("/")} onError={setError} />
          )}
          {!canGoogle && (
            <Button size="lg" type="button" className="throb" onClick={guest} disabled={busy !== null}>
              Start without an account
            </Button>
          )}
          {busy === "google" && desktop?.cancelSignIn ? (
            <Button size="lg" variant="secondary" type="button" onClick={() => void desktop.cancelSignIn!()}>
              Cancel
            </Button>
          ) : (
            <Button size="lg" variant="secondary" type="button" onClick={demo} disabled={busy !== null}>
              {busy === "demo" ? "Opening…" : "Look around with a demo account"}
            </Button>
          )}
        </div>
      </DialogueBox>
    </Stage>
  );
}
