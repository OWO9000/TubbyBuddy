import { useEffect, useState } from "react";

interface Piece { id: number; left: number; delay: number; duration: number; color: string; size: number; rotate: number }
const COLORS = ["#ff6fa5", "#ffd34d", "#6cd6ff", "#9b8cff", "#7ee0a8", "#ff9a5c"];

export function celebrate(): void {
  window.dispatchEvent(new CustomEvent("tubby:celebrate"));
}

/** Tiny CSS confetti layer, triggered by celebrate() on wins (check-in, focus done, redeem, purchase). */
export function Celebration() {
  const [pieces, setPieces] = useState<Piece[]>([]);
  useEffect(() => {
    const on = () => {
      const next = Array.from({ length: 28 }, (_, i) => ({
        id: Date.now() + i,
        left: Math.random() * 100,
        delay: Math.random() * 0.25,
        duration: 1.1 + Math.random() * 0.9,
        color: COLORS[i % COLORS.length],
        size: 6 + Math.random() * 8,
        rotate: Math.random() * 360,
      }));
      setPieces(next);
      window.setTimeout(() => setPieces([]), 2200);
    };
    window.addEventListener("tubby:celebrate", on);
    return () => window.removeEventListener("tubby:celebrate", on);
  }, []);
  if (!pieces.length) return null;
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.id}
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * (Math.random() > 0.5 ? 0.55 : 1),
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            transform: `rotate(${p.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}
