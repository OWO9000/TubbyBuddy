import { useId, type SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = ({ size = 20, ...rest }: P) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  "aria-hidden": true,
  focusable: false,
  ...rest,
});

export const GiftIcon = (p: P) => (
  <svg {...base(p)} fill="currentColor">
    <path d="M3 9.5A1.5 1.5 0 0 1 4.5 8h15A1.5 1.5 0 0 1 21 9.5V12H3z" />
    <path d="M4 13h7v8H5.5A1.5 1.5 0 0 1 4 19.5zM13 13h7v6.5a1.5 1.5 0 0 1-1.5 1.5H13z" />
    <path d="M11 8h2v4h-2z" opacity=".55" />
    <path d="M12 7.6C10.6 4.4 6.4 3.4 6.2 5.8c-.2 2 3.3 2.2 5.8 2.2zm0 0c1.4-3.2 5.6-4.2 5.8-1.8.2 2-3.3 2.2-5.8 2.2z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
  </svg>
);

export const TrophyIcon = (p: P) => (
  <svg {...base(p)} fill="currentColor">
    <path d="M7 3h10v2.5h3.5V7c0 2.7-1.9 4.8-4.4 5.1A5 5 0 0 1 13 15.4V18h3.2v3H7.8v-3H11v-2.6a5 5 0 0 1-3.1-3.3C5.4 11.8 3.5 9.7 3.5 7V5.5H7zm0 4H5.5c.2 1.3.9 2.3 1.9 2.8-.3-.6-.4-1.2-.4-1.8zm10 0v1c0 .6-.1 1.2-.4 1.8 1-.5 1.7-1.5 1.9-2.8z" />
    <path d="M9.4 5.2h1.4v5.6H9.4z" fill="#fff" opacity=".45" />
  </svg>
);

export const PaletteIcon = (p: P) => (
  <svg {...base(p)} fill="currentColor">
    <path d="M12 3c5 0 9 3.6 9 8 0 2.7-2.1 4.3-4.6 4.3h-1.6c-1 0-1.6.9-1.2 1.8l.3.6c.6 1.4-.4 3.3-2 3.3C6.9 21 3 17 3 12s4-9 9-9z" />
    <circle cx="7.6" cy="11.3" r="1.7" fill="#ff5a6e" />
    <circle cx="10.2" cy="7.3" r="1.7" fill="#ffbf2e" />
    <circle cx="14.9" cy="7.4" r="1.7" fill="#3aa3f2" />
    <circle cx="17.4" cy="11.2" r="1.7" fill="#3fc977" />
  </svg>
);

export const GearIcon = (p: P) => (
  <svg {...base(p)} fill="currentColor">
    <path
      fillRule="evenodd"
      d="M10.3 2h3.4l.5 2.6c.6.2 1.2.5 1.7.9l2.5-.9 1.7 2.9-2 1.7c.1.6.1 1.3 0 1.9l2 1.7-1.7 2.9-2.5-.9c-.5.4-1.1.7-1.7.9l-.5 2.6h-3.4l-.5-2.6c-.6-.2-1.2-.5-1.7-.9l-2.5.9-1.7-2.9 2-1.7a6.3 6.3 0 0 1 0-1.9l-2-1.7 1.7-2.9 2.5.9c.5-.4 1.1-.7 1.7-.9zM12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z"
      transform="translate(0 1)"
    />
  </svg>
);

export function FlameIcon(p: P) {
  const id = useId().replace(/:/g, "");
  return (
  <svg {...base(p)}>
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffd36b" />
        <stop offset=".55" stopColor="#ff8a2b" />
        <stop offset="1" stopColor="#e2462c" />
      </linearGradient>
    </defs>
    <path d="M12.4 2.5c.4 3-1.7 4.4-3 6.2C7.7 10.9 7 12.7 7 14.6 7 18.2 9.3 21 12.3 21s5.2-2.6 5.2-6c0-2.8-1.6-4.3-2.6-5.6-.3 1.6-1 2.6-2 3 .7-3.3-.1-6.6-.5-8.9z" fill={`url(#${id})`} stroke="#b9381f" strokeWidth=".8" />
    <path d="M12.3 13.2c1.3 1.2 2.3 2.3 2.3 3.9 0 1.5-1 2.6-2.3 2.6S10 18.6 10 17.2c0-1.6 1.1-2.6 2.3-4z" fill="#fff3c4" opacity=".9" />
  </svg>
  );
}

export const SpeakerIcon = ({ muted, ...p }: P & { muted?: boolean }) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" stroke="none" />
    {muted ? (
      <path d="m16 9.5 5 5m0-5-5 5" />
    ) : (
      <>
        <path d="M15.5 9a4.2 4.2 0 0 1 0 6" />
        <path d="M18.2 6.5a8 8 0 0 1 0 11" />
      </>
    )}
  </svg>
);

export const RestartIcon = (p: P) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5.5 9.5A7 7 0 1 1 5 14" />
    <path d="M5 4.8v4.9h4.9" />
  </svg>
);

export const MicIcon = (p: P) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </svg>
);

export const StopIcon = (p: P) => (
  <svg {...base(p)} fill="currentColor">
    <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
  </svg>
);

export const SendIcon = (p: P) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5.5M6 11l6-6 6 6" />
  </svg>
);

export const LockIcon = (p: P) => (
  <svg {...base(p)} fill="currentColor">
    <path fillRule="evenodd" d="M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10h.5A1.5 1.5 0 0 1 18.5 11.5v8A1.5 1.5 0 0 1 17 21H7a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 7 10zm2 0h5V7.5a2.5 2.5 0 0 0-5 0z" />
  </svg>
);

export const CheckIcon = (p: P) => (
  <svg {...base(p)} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

/** A neutral monogram tile for a guarded app (no brand logos). */
const TILE_HUES = [204, 338, 28, 262, 160, 12, 190, 46];
export function AppTile({ name, size = 40 }: { name: string; size?: number }) {
  const clean = name.trim() || "?";
  let h = 0;
  for (const ch of clean.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = TILE_HUES[h % TILE_HUES.length];
  return (
    <span
      className="app-tile"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46), ["--tile-h" as string]: hue }}
    >
      {clean[0].toUpperCase()}
    </span>
  );
}
