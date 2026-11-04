import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMe } from "../App";
import { api, fileToDataUrl, timeAgo, type Offer } from "../api";
import { Button } from "../components/aqua/button";
import { celebrate } from "../components/Celebration";
import { Modal } from "../components/Modal";
import { Segmented, Window } from "../components/Window";
import { CheckIcon } from "../components/icons";


export default function Rewards() {
  const { me, refresh, toast } = useMe();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [redeemOffer, setRedeemOffer] = useState<Offer | null>(null);
  const [affordableOnly, setAffordableOnly] = useState(false);
  const [tab, setTab] = useState<"offers" | "codes">("offers");
  const [params] = useSearchParams();
  const highlight = params.get("offer");

  const load = () => {
    setError(null);
    return api<{ offers: Offer[] }>("/offers")
      .then((r) => setOffers(r.offers))
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Could not load rewards");
        throw e;
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load().catch((e) => toast(e instanceof Error ? e.message : "Could not load rewards", "err"));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (highlight && offers.length) document.getElementById(`offer-${highlight}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlight, offers]);

  const shown = useMemo(
    () => (affordableOnly && me ? offers.filter((o) => o.pointsPrice <= me.balance) : offers),
    [offers, affordableOnly, me],
  );

  const next = useMemo(() => {
    if (!me) return undefined;
    return [...offers].filter((o) => o.pointsPrice > me.balance).sort((a, b) => a.pointsPrice - b.pointsPrice)[0];
  }, [offers, me]);

  return (
    <div className="page rewards-page">
      <Window
        title="Rewards"
        toolbar={
          <>
            <div className="toolbar-figure">
              <b>{me?.balance.toLocaleString() ?? "…"}<small>pts</small></b>
              {next && me && (
                <div className="progress-wrap">
                  <div className="progress-label">{(next.pointsPrice - me.balance).toLocaleString()} more for {next.title}</div>
                  <div className="progress"><div style={{ width: `${Math.min(100, (me.balance / next.pointsPrice) * 100)}%` }} /></div>
                </div>
              )}
            </div>
            <Segmented
              className="rewards-tabs"
              label="Rewards"
              value={tab}
              onChange={setTab}
              options={[
                { value: "offers", label: <>Offers <span className="count">{offers.length}</span></> },
                { value: "codes", label: <>My codes <span className="count">{me?.redemptions.length ?? 0}</span></> },
              ]}
            />
          </>
        }
      >
      {tab === "offers" ? (
        <>
          <div className="section-head">
            <h2>{offers.some((o) => o.forGoal) ? "Picked for your goals" : "Near you"}</h2>
            <label className="check inline">
              <input type="checkbox" checked={affordableOnly} onChange={(e) => setAffordableOnly(e.target.checked)} />
              <span>Only what I can afford</span>
            </label>
          </div>

          {loading ? (
            <div className="offers" aria-hidden="true">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="offer card">
                  <div className="skel skel-img" />
                  <div className="offer-body stack">
                    <div className="skel skel-line w40" />
                    <div className="skel skel-line" />
                    <div className="skel skel-btn" />
                  </div>
                </div>
              ))}
            </div>
          ) : error && offers.length === 0 ? (
            <div className="card empty">
              <p><b>Couldn&apos;t load rewards.</b></p>
              <p className="muted small">{error}</p>
              <Button type="button" onClick={() => load().catch(() => undefined)}>Try again</Button>
            </div>
          ) : shown.length === 0 ? (
            <div className="card empty">
              <p><b>{affordableOnly ? "Nothing in reach yet." : "No rewards near you yet."}</b></p>
              <p className="muted small">{affordableOnly ? "Finish a focus session or check in to close the gap." : "New local spots join all the time."}</p>
            </div>
          ) : (
            <div className="offers">
              {shown.map((o) => {
                const can = !!me && me.balance >= o.pointsPrice;
                return (
                  <article key={o.id} id={`offer-${o.id}`} className={`offer card ${highlight === o.id ? "hl" : ""}`}>
                    {o.imageUrl ? <img src={o.imageUrl} alt="" className="offer-img" /> : <div className={`offer-img ph cat-${o.category}`} />}
                    <div className="offer-body">
                      {o.forGoal && <div className="for-goal">For “{o.forGoal}”</div>}
                      <div className="offer-biz">{o.business}</div>
                      <h3>{o.title}</h3>
                      <p className="muted small">{o.description}</p>
                      <div className="offer-meta">
                        <span className="chip">{o.discountPercent}% off</span>
                        <span className="chip">{o.category}</span>
                        <span className="chip">{Math.max(0, o.monthlyCap - (o.redeemedThisMonth ?? 0))} left</span>
                      </div>
                    </div>
                    <div className="offer-foot">
                      <b>{o.pointsPrice.toLocaleString()} pts</b>
                      <Button size="sm" type="button" disabled={!can} onClick={() => setRedeemOffer(o)}>
                        {can ? "Redeem" : `${o.pointsPrice - (me?.balance ?? 0)} more`}
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          <p className="fine-print">Demo listings from fictional local businesses. The codes are real one-time codes inside this app.</p>
        </>
      ) : (
        <MyCodes />
      )}
      </Window>

      <RedeemModal
        offer={redeemOffer}
        onClose={() => {
          setRedeemOffer(null);
          refresh().catch(() => undefined);
          load().catch(() => undefined);
        }}
      />
    </div>
  );
}

function MyCodes() {
  const { me } = useMe();
  const reds = me?.redemptions ?? [];
  if (!reds.length) {
    return (
      <div className="card empty">
        <p><b>No codes yet.</b></p>
        <p className="muted small">Redeem an offer and the one-time code appears here, ready to show at the counter.</p>
      </div>
    );
  }
  return (
    <section className="my-codes">
      <div className="code-list">
        {reds.map((r) => (
          <article key={r.id} className="code-card card">
            <div>
              <div className="offer-biz">{r.business}</div>
              <h3>{r.title}</h3>
              <span className="muted small">{timeAgo(r.at)}</span>
            </div>
            <code className="bigcode">{r.code}</code>
            <span className={`status ${r.status}`}>{r.status}</span>
          </article>
        ))}
      </div>
      <p className="fine-print">Each code works once. Staff check it at the counter.</p>
    </section>
  );
}

function RedeemModal({ offer, onClose }: { offer: Offer | null; onClose: () => void }) {
  const { refresh, toast } = useMe();
  const [state, setState] = useState<{ step: "confirm" | "issued"; red?: any; proof?: any; verifying?: boolean; busy?: boolean }>({ step: "confirm" });
  useEffect(() => setState({ step: "confirm" }), [offer?.id]);
  if (!offer) return null;

  async function redeem() {
    if (state.busy) return;
    setState((s) => ({ ...s, busy: true }));
    try {
      const r = await api(`/offers/${offer!.id}/redeem`, { method: "POST" });
      setState({ step: "issued", red: r });
      celebrate();
      refresh();
    } catch (e) {
      setState((s) => ({ ...s, busy: false }));
      toast(e instanceof Error ? e.message : "Could not redeem", "err");
    }
  }

  async function verify(file: Blob) {
    setState((s) => ({ ...s, verifying: true }));
    try {
      const imageBase64 = await fileToDataUrl(file);
      const r = await api(`/redemptions/${state.red.redemption.id}/verify-proof`, { body: { imageBase64 } });
      setState((s) => ({ ...s, proof: r, verifying: false }));
      if (r.bonusPoints) toast(`Visit verified · +${r.bonusPoints} pts`);
      refresh();
    } catch (e) {
      setState((s) => ({ ...s, verifying: false }));
      toast(e instanceof Error ? e.message : "Could not check that photo", "err");
    }
  }

  async function useSample() {
    const b = await fetch("/samples/proof-latte.jpg").then((r) => r.blob());
    verify(b);
  }

  return (
    <Modal open onClose={onClose} title="Redeem">
      {state.step === "confirm" ? (
        <div className="stack">
          <h2>{offer.title}</h2>
          <p className="muted">{offer.business}</p>
          <p>{offer.description}</p>
          <p className="small muted">{offer.terms}</p>
          <Button size="lg" type="button" className="throb" onClick={redeem} disabled={state.busy}>
            {state.busy ? "Issuing…" : `Spend ${offer.pointsPrice.toLocaleString()} pts`}
          </Button>
        </div>
      ) : (
        <div className="stack center">
          <h2>Show this at {offer.business}</h2>
          <img className="qr" src={state.red.qrDataUrl} alt="Redemption QR code" />
          <code className="bigcode">{state.red.redemption.code}</code>
          <p className="muted small">One-time code. Balance now {state.red.balance.toLocaleString()} pts.</p>
          <hr />
          <h3>Snap a photo of your visit for +25 pts</h3>
          <div className="row gap center wrap">
            <label className="btn ghost">
              Upload photo
              <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && verify(e.target.files[0])} />
            </label>
            <Button size="sm" variant="secondary" type="button" onClick={useSample}>Use sample photo</Button>
          </div>
          {state.verifying && <div className="thinking">Checking the photo<span className="dots" /></div>}
          {state.proof && (
            <div className={`proof ${state.proof.verified ? "ok" : "no"}`}>
              <img src={state.proof.imageUrl} alt="" />
              <div>
                <b className="proof-title">{state.proof.verified ? <><CheckIcon size={16} /> Visit verified</> : "Couldn't verify"}</b>
                <p className="small">{state.proof.result.reason}</p>
                <small className="muted">confidence {(state.proof.result.confidence * 100).toFixed(0)}%</small>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
