/**
 * 2D accessories drawn over the pre-rendered Tubby frames. Coordinates are in the 512x512 frame space, so the same
 * overlay works at every size. The 3D viewer builds matching props from primitives (see Companion3D.tsx).
 */
export const ACCESSORY_NAMES: Record<string, string> = {
  "acc-bow": "Velvet Bow",
  "acc-glasses": "Star Shades",
  "acc-scarf": "Cozy Scarf",
  "acc-flowers": "Daisy Crown",
  "acc-headphones": "Beat Headphones",
  "acc-crown": "Sunbeam Crown",
};

/** Tight square boxes around each prop in the 512 frame space, so the shop can show the object on its own. */
const ICON_BOX: Record<string, string> = {
  "acc-bow": "292 106 136 136",
  "acc-glasses": "100 96 313 313",
  "acc-scarf": "132 274 249 249",
  "acc-flowers": "88 -56 336 336",
  "acc-headphones": "54 24 404 404",
  "acc-crown": "161 9 190 190",
};

export function AccessoryOverlay({ id }: { id?: string }) {
  if (!id || !ACCESSORY_NAMES[id]) return null;
  return (
    <svg className="accessory-overlay" viewBox="0 0 512 512" aria-hidden="true" focusable="false">
      <AccessoryShape id={id} />
    </svg>
  );
}

/** The prop by itself (shop tiles), without the cat. */
export function AccessoryIcon({ id, size = 64 }: { id: string; size?: number }) {
  if (!ACCESSORY_NAMES[id]) return null;
  return (
    <svg className="accessory-icon" width={size} height={size} viewBox={ICON_BOX[id]} aria-hidden="true" focusable="false">
      <AccessoryShape id={id} />
    </svg>
  );
}

function AccessoryShape({ id }: { id: string }) {
  return (
    <g data-acc={id}>
      {id === "acc-bow" && (
        <g transform="translate(362 158) rotate(12)">
          <path d="M0 4 C-46 -30 -74 6 -16 20 Z" fill="#ff6fa5" stroke="#c53a76" strokeWidth="4" />
          <path d="M2 4 C48 -30 76 6 18 20 Z" fill="#ff8ab8" stroke="#c53a76" strokeWidth="4" />
          <circle r="11" fill="#e94b86" stroke="#a92c5f" strokeWidth="3" />
          <path d="M-4 16 L-16 44" stroke="#c53a76" strokeWidth="5" strokeLinecap="round" />
          <path d="M6 16 L18 42" stroke="#c53a76" strokeWidth="5" strokeLinecap="round" />
        </g>
      )}

      {id === "acc-glasses" && (
        <g transform="translate(256 252)" fill="#202a36" stroke="#111820" strokeWidth="5">
          <rect x="-92" y="-26" width="76" height="52" rx="22" />
          <rect x="16" y="-26" width="76" height="52" rx="22" />
          <rect x="-18" y="-7" width="36" height="10" rx="5" />
          <path d="M-92 -8 L-132 -20" strokeWidth="7" strokeLinecap="round" />
          <path d="M92 -8 L132 -20" strokeWidth="7" strokeLinecap="round" />
          <path d="M-74 -18 L-46 -18" stroke="#fff" strokeWidth="5" opacity=".45" strokeLinecap="round" />
          <path d="M34 -18 L62 -18" stroke="#fff" strokeWidth="5" opacity=".45" strokeLinecap="round" />
        </g>
      )}

      {id === "acc-scarf" && (
        <g transform="translate(256 338)">
          <path d="M-104 -4 Q0 44 104 -4 L96 34 Q0 84 -96 34 Z" fill="#e04b4b" stroke="#a52f2f" strokeWidth="4" />
          <path d="M-88 28 L-64 126 L-18 108 L-42 22 Z" fill="#c93b3b" stroke="#a52f2f" strokeWidth="4" />
          <path d="M-84 52 L-44 64 M-78 78 L-36 90" stroke="#ffd2d2" strokeWidth="6" opacity=".7" strokeLinecap="round" />
          <path d="M-96 34 Q0 84 96 34" fill="none" stroke="#ffb3b3" strokeWidth="4" opacity=".6" />
        </g>
      )}

      {id === "acc-flowers" && (
        <g transform="translate(256 122)">
          <path d="M-134 18 Q0 -42 134 18" fill="none" stroke="#4e9b52" strokeWidth="9" strokeLinecap="round" />
          {[-120, -72, -24, 24, 72, 120].map((x, i) => (
            <g key={x} transform={`translate(${x} ${[4, -14, -24, -24, -14, 4][i]})`}>
              {[0, 72, 144, 216, 288].map((a) => (
                <ellipse key={a} cx="0" cy="-10" rx="7" ry="11" fill={i % 2 ? "#fff6d8" : "#ffd6e7"} transform={`rotate(${a})`} />
              ))}
              <circle r="6" fill="#ffc93c" />
            </g>
          ))}
        </g>
      )}

      {id === "acc-headphones" && (
        <g transform="translate(256 228)">
          <path d="M-150 6 C-150 -118 150 -118 150 6" fill="none" stroke="#28313d" strokeWidth="24" strokeLinecap="round" />
          <path d="M-150 6 C-150 -118 150 -118 150 6" fill="none" stroke="#455367" strokeWidth="10" strokeLinecap="round" opacity=".7" />
          <rect x="-172" y="-16" width="48" height="100" rx="22" fill="#28313d" stroke="#151c24" strokeWidth="4" />
          <rect x="124" y="-16" width="48" height="100" rx="22" fill="#28313d" stroke="#151c24" strokeWidth="4" />
          <rect x="-164" y="-4" width="32" height="76" rx="15" fill="#5c6b80" opacity=".55" />
          <rect x="132" y="-4" width="32" height="76" rx="15" fill="#5c6b80" opacity=".55" />
        </g>
      )}

      {id === "acc-crown" && (
        <g transform="translate(256 104)">
          <defs>
            <linearGradient id="acc-gold" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff0a8" />
              <stop offset=".55" stopColor="#ffd34d" />
              <stop offset="1" stopColor="#e2a10e" />
            </linearGradient>
          </defs>
          <path d="M-74 34 L-62 -34 L-26 0 L0 -48 L26 0 L62 -34 L74 34 Z" fill="url(#acc-gold)" stroke="#b87c09" strokeWidth="5" strokeLinejoin="round" />
          <rect x="-78" y="30" width="156" height="18" rx="8" fill="#f3bb21" stroke="#b87c09" strokeWidth="4" />
          <circle cx="0" cy="12" r="9" fill="#ff5f8f" stroke="#b5305e" strokeWidth="3" />
          <circle cx="-45" cy="14" r="6" fill="#67d4ff" stroke="#2b7fa3" strokeWidth="2" />
          <circle cx="45" cy="14" r="6" fill="#67d4ff" stroke="#2b7fa3" strokeWidth="2" />
        </g>
      )}
    </g>
  );
}
