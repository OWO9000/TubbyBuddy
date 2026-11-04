import { useEffect, useState } from "react";
import { useMe } from "../App";
import { COMPANION_NAME, api, type Cosmetic, type Me, type Slot } from "../api";
import { CompanionView } from "../components/CompanionView";
import { Button } from "../components/aqua/button";
import { celebrate } from "../components/Celebration";
import { FUR, recolor } from "../components/furColors";
import { reactCompanion } from "../components/companionEvents";
import { equippedMap } from "../lib/equipped";
import { Segmented, Window } from "../components/Window";
import { LockIcon } from "../components/icons";
import { AccessoryIcon } from "../components/Accessories";

const DEFAULT_COLOR = "color-classic";

/** Companion roster: Tubby ships today; new characters slot in here as their VRMs arrive. */
const CHARACTERS: { id: string; name: string; locked: boolean }[] = [
  { id: "tubby", name: "Tubby", locked: false },
  { id: "soon-1", name: "Locked", locked: true },
  { id: "soon-2", name: "Locked", locked: true },
  { id: "soon-3", name: "Locked", locked: true },
];

function swatch(id: string): string {
  const f = FUR[id] ?? FUR[DEFAULT_COLOR];
  const hex = (rgb: [number, number, number]) => `rgb(${rgb.map((v) => Math.round(v * 255)).join(",")})`;
  return `linear-gradient(135deg, ${hex(recolor(1, 176 / 255, 231 / 255, f))}, ${hex(recolor(1, 94 / 255, 196 / 255, f))})`;
}

export default function Cosmetics() {
  const { me, setMe, toast } = useMe();
  const [items, setItems] = useState<Cosmetic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"color" | "accessory">("color");
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    setError(null);
    return api<{ items: Cosmetic[] }>("/store")
      .then((r) => setItems(r.items))
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Store unavailable");
        throw e;
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load().catch((e) => toast(e instanceof Error ? e.message : "Store unavailable", "err"));
  }, [me?.ownedCosmetics.length]);

  async function equip(slot: Slot, id: string | null) {
    try {
      const r = await api<Me>("/store/equip", { body: { deviceId: me?.deviceId, slot, cosmeticId: id } });
      setMe(r);
      reactCompanion("earn");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not wear that", "err");
    }
  }

  async function buy(c: Cosmetic) {
    if (busy) return;
    setBusy(c.id);
    try {
      const r = await api<Me>("/store/buy", { body: { deviceId: me?.deviceId, cosmeticId: c.id } });
      setMe(r);
      toast(`Unlocked ${c.name}`);
      celebrate();
      await equip(c.slot, c.slot === "color" && c.id === DEFAULT_COLOR ? null : c.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not unlock that", "err");
    } finally {
      setBusy(null);
    }
  }

  const eq = equippedMap(me);
  const shown = items.filter((c) => c.slot === tab);
  const ownedCount = items.filter((c) => c.owned || me?.ownedCosmetics.some((o) => o.id === c.id)).length;

  return (
    <div className="page cosmetics-page">
      <Window
        title="Cosmetics"
        toolbar={
          <>
            <Segmented
              className="rewards-tabs"
              label="Cosmetics"
              value={tab}
              onChange={setTab}
              options={[
                { value: "color", label: <>Fur <span className="count">{items.filter((c) => c.slot === "color").length || 7}</span></> },
                { value: "accessory", label: <>Accessories <span className="count">{items.filter((c) => c.slot === "accessory").length || 6}</span></> },
              ]}
            />
            <span className="muted small">{me?.balance.toLocaleString() ?? "…"} pts to spend · {ownedCount} of {items.length || 13} owned</span>
          </>
        }
      >
      <section className="cosmetics-hero card">
        <div className="cosmetics-stage">
          <CompanionView mood="happy" equipped={eq} size={250} />
        </div>
        <div className="cosmetics-copy">
          <h1>{COMPANION_NAME}&apos;s wardrobe</h1>
          <p className="muted">Fur colors are yours to keep once unlocked. Props arrive with the next companions.</p>
          <div className="character-row" role="list" aria-label="Companions">
            {CHARACTERS.map((ch) => (
              <div key={ch.id} role="listitem" className={`character-slot card ${ch.locked ? "soon" : "on"}`} title={ch.locked ? "Coming soon" : "Your companion"}>
                {ch.locked ? <span className="lock"><LockIcon size={20} /></span> : <img src="/tubby/tubby_happy.png" alt="" />}
                <b>{ch.name}</b>
                <small className="muted">{ch.locked ? "Soon" : "With you"}</small>
              </div>
            ))}
          </div>
          <div className="cosmetics-current">
            <span className="fur-swatch" style={{ background: swatch(eq.color?.id ?? DEFAULT_COLOR) }} />
            <span><b>{eq.color?.name ?? "Classic Pink"}</b>{eq.accessory ? ` · ${eq.accessory.name}` : ""}</span>
          </div>
        </div>
      </section>

      {eq.accessory && (
        <div className="wear-row">
          <span>Wearing <b>{eq.accessory.name}</b></span>
          <button type="button" className="link" onClick={() => equip("accessory", null)}>Take it off</button>
        </div>
      )}

      {loading ? (
        <div className="store" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="store-item card">
              <div className="skel skel-art" />
              <div className="skel skel-line w70" />
              <div className="skel skel-btn" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="card empty">
          <p><b>Couldn&apos;t load cosmetics.</b></p>
          <p className="muted small">{error}</p>
          <Button type="button" onClick={() => load().catch(() => undefined)}>Try again</Button>
        </div>
      ) : (
        <div className="store cosmetics-store">
          {shown.map((c) => {
            const comingSoon = c.slot === "accessory"; // props return with the new companions
            const owned = c.owned || !!me?.ownedCosmetics.some((o) => o.id === c.id);
            const isOn = c.slot === "color" ? (me?.equipped.color ?? DEFAULT_COLOR) === c.id : me?.equipped.accessory === c.id;
            return (
              <div key={c.id} className={`store-item card ${isOn ? "on" : ""} ${comingSoon ? "soon" : ""}`}>
                <div className="store-art">
                  {c.slot === "color" ? (
                    <span className="fur-swatch big" style={{ background: swatch(c.id) }} />
                  ) : (
                    <span className="acc-preview" aria-hidden="true">
                      <AccessoryIcon id={c.id} size={60} />
                    </span>
                  )}
                </div>
                <b>{c.name}</b>
                <small className="muted">{comingSoon ? "coming soon" : c.price === 0 ? "free" : `${c.price} pts`}</small>
                {comingSoon ? (
                  <Button size="sm" variant="secondary" type="button" disabled title="Props arrive with the new companions">
                    Soon
                  </Button>
                ) : owned ? (
                  <Button size="sm" variant="secondary" type="button" disabled={isOn || busy === c.id} onClick={() => equip(c.slot, c.slot === "color" && c.id === DEFAULT_COLOR ? null : c.id)}>
                    {isOn ? "Wearing" : "Wear"}
                  </Button>
                ) : (
                  <Button size="sm" type="button" disabled={!me || me.balance < c.price || busy === c.id} onClick={() => buy(c)}>
                    {busy === c.id ? "…" : "Unlock"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      </Window>
    </div>
  );
}
