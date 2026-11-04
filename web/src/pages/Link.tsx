import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Button } from "../components/aqua/button";
import { CompanionView } from "../components/CompanionView";
import { GoogleButton } from "../components/Welcome";
import { Window } from "../components/Window";
import type { Account, AuthConfig } from "../lib/auth";

/** Opened from the phone or Windows app: sign in here, and that app picks up its own session. */
export default function Link({ config, account: initial }: { config: AuthConfig | null; account: Account | null }) {
  const [params] = useSearchParams();
  const code = (params.get("code") ?? "").toUpperCase();
  const [label, setLabel] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(initial);
  const [state, setState] = useState<"loading" | "ready" | "busy" | "done" | "error">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setAccount(initial), [initial]);
  useEffect(() => {
    if (!/^[A-Z2-9]{8}$/.test(code)) {
      setState("error");
      setError("This link is incomplete. Start again from the app.");
      return;
    }
    api<{ label: string }>(`/auth/link/${code}/info`)
      .then((r) => {
        setLabel(r.label);
        setState("ready");
      })
      .catch((e) => {
        setState("error");
        setError(e instanceof Error ? e.message : "This link has expired.");
      });
  }, [code]);

  async function approve() {
    setState("busy");
    try {
      await api(`/auth/link/${code}/approve`, { body: {} });
      setState("done");
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "Couldn't link the app.");
    }
  }

  return (
    <div className="page link-page">
      <Window title="Sign in your app" className="link-window">
        <div className="link-body">
          <CompanionView mood={state === "done" ? "proud" : "happy"} size={150} />
          {state === "done" ? (
            <>
              <h1>You're in.</h1>
              <p className="muted">Go back to {label ?? "the app"}. It signs in on its own in a moment. You can close this tab.</p>
            </>
          ) : state === "error" ? (
            <>
              <h1>That didn't work.</h1>
              <p className="err">{error}</p>
            </>
          ) : (
            <>
              <h1>Sign in {label ?? "your app"}</h1>
              <p className="muted">
                {account
                  ? `It will use the account ${account.email ?? account.name ?? ""}, with the same points and streak.`
                  : "Sign in with Google here, and the app picks up your account."}
              </p>
              {account ? (
                <Button size="lg" type="button" className="throb" onClick={approve} disabled={state !== "ready"}>
                  {state === "busy" ? "Signing in…" : `Sign in ${label ?? "the app"}`}
                </Button>
              ) : config?.googleClientId ? (
                <GoogleButton clientId={config.googleClientId} onSignedIn={(a) => setAccount(a)} onError={setError} />
              ) : (
                <p className="err">Google sign-in isn't set up on this server.</p>
              )}
              {error && <p className="err small">{error}</p>}
              <p className="fine-print">Code {code}</p>
            </>
          )}
        </div>
      </Window>
    </div>
  );
}
