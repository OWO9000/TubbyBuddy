/**
 * Focus modes: one-tap preset bundles for a moment of your day.
 * Applying a mode replaces the guarded-apps list (goals stay as they are).
 * The names reuse the suggested-app vocabulary so the chips light up in Settings.
 */
export interface FocusMode {
  id: string;
  name: string;
  blurb: string;
  /** Guarded apps for this moment. */
  apps: string[];
  /** Suggested focus-session length. */
  minutes: number;
}

export const FOCUS_MODES: FocusMode[] = [
  {
    id: "deep-focus",
    name: "Deep Focus",
    blurb: "A long stretch with nothing social.",
    apps: ["TikTok", "Instagram", "YouTube", "X", "Reddit", "Snapchat"],
    minutes: 45,
  },
  {
    id: "study",
    name: "Study",
    blurb: "Reading and notes stay; feeds go.",
    apps: ["TikTok", "Instagram", "YouTube", "X", "Games"],
    minutes: 25,
  },
  {
    id: "morning",
    name: "Morning",
    blurb: "A slow start, not a reactive one.",
    apps: ["TikTok", "Instagram", "X", "Reddit", "News"],
    minutes: 15,
  },
  {
    id: "night",
    name: "Night",
    blurb: "Wind down without the feed.",
    apps: ["TikTok", "Instagram", "YouTube", "X", "Netflix"],
    minutes: 15,
  },
  {
    id: "gym",
    name: "Gym",
    blurb: "Music stays. Everything else waits.",
    apps: ["TikTok", "Instagram", "YouTube", "X", "Snapchat", "Reddit"],
    minutes: 60,
  },
  {
    id: "reset",
    name: "Sunday Reset",
    blurb: "Plan the week, skip the scroll.",
    apps: ["TikTok", "Instagram", "YouTube", "X", "Shopping"],
    minutes: 25,
  },
];
