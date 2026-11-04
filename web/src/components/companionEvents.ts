import type { Mood } from "./Companion";

export type CompanionReaction = "earn" | "burn" | "surprise" | "wave" | "hello";

export function reactCompanion(r: CompanionReaction): void {
  window.dispatchEvent(new CustomEvent("companion:react", { detail: r }));
}

export function onCompanionReact(cb: (r: CompanionReaction) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<CompanionReaction>).detail);
  window.addEventListener("companion:react", handler);
  return () => window.removeEventListener("companion:react", handler);
}

export type Mood3D = "neutral" | "happy" | "worried" | "angry" | "proud" | "surprised";

export function to3D(m: Mood | Mood3D): Mood3D {
  if (m === "sleepy" || m === "neutral") return "neutral";
  if (m === "singed" || m === "worried") return "worried";
  return m;
}

let webglCached: boolean | null = null;

export function hasWebGL(): boolean {
  if (webglCached !== null) return webglCached;
  try {
    const canvas = document.createElement("canvas");
    webglCached = !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    webglCached = false;
  }
  return webglCached;
}

type Rot = [number, number, number];
export type Pose = Partial<Record<string, Rot>>;

/**
 * The companion model has no facial blendshapes, so moods are body language (normalized-bone Euler rotations)
 * plus small effect glyphs. Shared by the live 3D viewer and the PNG export script.
 */
export const MOOD_POSES: Record<Mood3D, Pose> = {
  neutral: { leftUpperArm: [0, 0, 1.15], rightUpperArm: [0, 0, -1.15] },
  happy: { leftUpperArm: [0, 0, -0.55], rightUpperArm: [0, 0, 0.55], head: [0, 0, 0.16] },
  worried: { leftUpperArm: [0, -0.9, 1.0], rightUpperArm: [0, 0.9, -1.0], head: [0.28, 0, -0.08], spine: [0.08, 0, 0] },
  angry: { leftUpperArm: [0, 0, 0.95], rightUpperArm: [0, 0, -0.95], leftLowerArm: [0, 0, 0.5], rightLowerArm: [0, 0, -0.5], head: [0.14, 0, 0], spine: [0.14, 0, 0] },
  proud: { leftUpperArm: [0, 0, 0.75], rightUpperArm: [0, 0, -0.75], leftLowerArm: [0, -1.7, 0], rightLowerArm: [0, 1.7, 0], head: [-0.18, 0, 0], chest: [-0.08, 0, 0] },
  surprised: { leftUpperArm: [0, 0, -0.15], rightUpperArm: [0, 0, 0.15], head: [-0.12, 0, 0], spine: [-0.08, 0, 0] },
};
