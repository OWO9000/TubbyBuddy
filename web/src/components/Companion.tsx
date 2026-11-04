import { useEffect, useState } from "react";
import type { Cosmetic, Slot } from "../api";
import { COMPANION_NAME } from "../api";
import { AccessoryOverlay } from "./Accessories";
import { onCompanionReact } from "./companionEvents";

/** The 2D fallback (no WebGL) uses the same pre-rendered frames as the Android app. */
export type Mood = "sleepy" | "happy" | "proud" | "singed" | "neutral" | "worried" | "angry" | "surprised";

/** Only a burn should sting; spending points in the wardrobe or on rewards is a good thing. */
export function lastBurnDelta(recent?: { delta: number; kind: string }[]): number | undefined {
  const last = recent?.[0];
  return last && last.kind === "burn" ? last.delta : undefined;
}

export function moodFor(streak: number, lastDelta?: number): Mood {
  if (lastDelta !== undefined && lastDelta < 0) return "singed";
  if (streak >= 3) return "proud";
  if (streak >= 1) return "happy";
  return "sleepy";
}

const FRAME_MOOD: Record<Mood, string> = {
  sleepy: "neutral",
  neutral: "neutral",
  happy: "happy",
  proud: "proud",
  worried: "worried",
  angry: "angry",
  surprised: "surprised",
  singed: "angry",
};

const COLOR_PREFIX: Record<string, string> = {
  "color-classic": "",
  "color-mint": "mint_",
  "color-ocean": "ocean_",
  "color-grape": "grape_",
  "color-sunset": "sunset_",
  "color-midnight": "midnight_",
  "color-gold": "gold_",
};

/** Resolve the PNG for a mood + equipped fur color (the same files ship in the Android APK). */
export function tubbyFrame(mood: Mood, equipped: Partial<Record<Slot, Cosmetic>> = {}): string {
  const color = equipped.color?.id ?? "color-classic";
  return `/tubby/tubby_${COLOR_PREFIX[color] ?? ""}${FRAME_MOOD[mood]}.png`;
}

export function Companion({ mood, equipped = {}, size = 220 }: { mood: Mood; equipped?: Partial<Record<Slot, Cosmetic>>; size?: number }) {
  const [wave, setWave] = useState(false);
  useEffect(
    () =>
      onCompanionReact((r) => {
        if (r !== "wave") return;
        setWave(true);
        window.setTimeout(() => setWave(false), 1900);
      }),
    [],
  );
  return (
    <div className={`companion-2d ${wave ? "wave" : ""}`} style={{ width: size, height: size }}>
      <div className="companion-pose">
        <img
          className="companion-img"
          src={tubbyFrame(mood, equipped)}
          width={size}
          height={size}
          alt={`${COMPANION_NAME} feeling ${mood}`}
          draggable={false}
        />
        <AccessoryOverlay id={equipped.accessory?.id} />
      </div>
    </div>
  );
}
