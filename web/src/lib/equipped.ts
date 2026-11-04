import type { Cosmetic, Me, Slot } from "../api";

/** Map the server's equipped ids to cosmetic rows so the cat can pick the right frame. */
export function equippedMap(me: Me | null): Partial<Record<Slot, Cosmetic>> {
  const out: Partial<Record<Slot, Cosmetic>> = {};
  if (!me) return out;
  for (const [slot, id] of Object.entries(me.equipped)) {
    const c = me.ownedCosmetics.find((x) => x.id === id);
    if (c) out[slot as Slot] = c;
  }
  return out;
}
