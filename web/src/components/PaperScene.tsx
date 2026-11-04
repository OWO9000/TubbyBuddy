import { memo, useEffect, useRef } from "react";
import Parallax from "parallax-js";

/**
 * Tubby's valley: paper-cut layers (grain, cut-edge highlight, stacked drop shadows) that drift with the pointer
 * or the phone's tilt through Parallax.js. Generated once from a fixed seed so every visit sees the same place.
 */

const W = 1600;
const H = 1000;
const STEP = 16;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ridge = (x: number) => number;

function mountains(seed: number, base: number, peaks: number, height: number): Ridge {
  const r = rng(seed);
  const ps = Array.from({ length: peaks }, (_, i) => ({
    c: ((i + 0.2 + r() * 0.6) / peaks) * (W + 200) - 100,
    h: height * (0.55 + r() * 0.45),
    w: 170 + r() * 190,
  }));
  const ph = r() * 6;
  return (x) => {
    let lift = 0;
    for (const p of ps) lift = Math.max(lift, p.h * Math.pow(Math.max(0, 1 - Math.abs(x - p.c) / p.w), 1.25));
    return base - lift - 9 * Math.sin(x / 61 + ph) - 5 * Math.sin(x / 23 + ph * 2);
  };
}

function hills(seed: number, base: number, amp: number): Ridge {
  const r = rng(seed);
  const waves = [0, 1, 2].map((i) => ({ f: (0.0018 + r() * 0.0022) * (i + 1), p: r() * 7, a: amp / (i + 1.2) }));
  return (x) => base - waves.reduce((s, w) => s + w.a * Math.sin(x * w.f + w.p), 0);
}

function ridgePath(y: Ridge) {
  let d = `M-40 ${H + 40} L-40 ${y(-40).toFixed(1)}`;
  for (let x = -40 + STEP; x <= W + 40; x += STEP) d += ` L${x} ${y(x).toFixed(1)}`;
  return `${d} L${W + 40} ${H + 40} Z`;
}

function pine(x: number, y0: number, h: number) {
  const w = h * 0.42;
  const t = y0 - h;
  return `M${x} ${t} L${x + w * 0.62} ${t + h * 0.48} L${x + w * 0.36} ${t + h * 0.46} L${x + w} ${y0} L${x - w} ${y0} L${x - w * 0.36} ${t + h * 0.46} L${x - w * 0.62} ${t + h * 0.48} Z`;
}

interface Tree { kind: "pine" | "round"; x: number; h: number; tint?: string; r: number }

function trees(seed: number, count: number, minH: number, maxH: number, roundShare: number, tints: string[] = [], maxR = 24): Tree[] {
  const r = rng(seed);
  return Array.from({ length: count }, () => {
    const round = r() < roundShare;
    const h = minH + r() * (maxH - minH);
    return {
      kind: round ? "round" : "pine",
      x: -20 + r() * (W + 40),
      h: round ? Math.min(h, maxR * 2.6) : h,
      r: Math.min(h * 0.24, maxR),
      tint: round && tints.length && r() < 0.35 ? tints[Math.floor(r() * tints.length)] : undefined,
    } as Tree;
  });
}

interface LayerSpec {
  depth: number;
  ridge: Ridge;
  top: string;
  bottom: string;
  treeColor?: string;
  trees?: Tree[];
  sway?: boolean;
}

const LAYERS: LayerSpec[] = [
  { depth: 0.16, ridge: mountains(7, 600, 5, 300), top: "#e2f2fd", bottom: "#cde7fa" },
  { depth: 0.26, ridge: mountains(19, 660, 6, 240), top: "#c3e3f9", bottom: "#a9d6f5" },
  {
    depth: 0.4,
    ridge: hills(3, 720, 46),
    top: "#9fd2f2",
    bottom: "#86c4ec",
    treeColor: "#7dbde8",
    trees: trees(11, 16, 34, 64, 0.55, [], 14),
    sway: true,
  },
  {
    depth: 0.6,
    ridge: hills(29, 800, 40),
    top: "#73b6e6",
    bottom: "#5ea8df",
    treeColor: "#539ed8",
    trees: trees(23, 24, 50, 104, 0.4, ["#e6f4fd", "#d2ebfb"], 20),
  },
  {
    depth: 0.9,
    ridge: hills(41, 905, 34),
    top: "#4f9bd6",
    bottom: "#3f89c7",
    treeColor: "#3a82c0",
    trees: trees(37, 16, 90, 170, 0.3, ["#dff0fc"], 28),
  },
];

function PaperFilter({ id, seed }: { id: string; seed: number }) {
  return (
    <filter id={id} x="-2%" y="-2%" width="104%" height="104%" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves={2} seed={seed} result="n" />
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.38 0 0 0 -0.18" result="speck" />
      <feComposite in="speck" in2="SourceAlpha" operator="in" result="tex" />
      <feOffset in="SourceAlpha" dy={2} result="off" />
      <feComposite in="SourceAlpha" in2="off" operator="out" result="rim" />
      <feFlood floodColor="#ffffff" floodOpacity={0.5} />
      <feComposite in2="rim" operator="in" result="rimc" />
      <feMerge>
        <feMergeNode in="SourceGraphic" />
        <feMergeNode in="tex" />
        <feMergeNode in="rimc" />
      </feMerge>
    </filter>
  );
}

function Cloud({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-120 30 C-120 6 -96 -6 -74 0 C-66 -34 -24 -44 2 -24 C18 -54 70 -52 82 -14 C108 -18 128 4 120 30 Z" />
    </g>
  );
}

function PaperSceneInner() {
  const sceneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sceneRef.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const p = new Parallax(el, {
      relativeInput: true,
      scalarX: 7,
      scalarY: 4,
      frictionX: 0.06,
      frictionY: 0.06,
      pointerEvents: false,
    });
    return () => p.destroy();
  }, []);

  return (
    <div className="paper-world" aria-hidden="true">
      <div className="paper-scene" ref={sceneRef}>
        <div className="layer" data-depth="0">
          <svg className="paper-sky" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice">
            <defs>
              <linearGradient id="ps-sky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#6db3f0" />
                <stop offset=".45" stopColor="#ace0fb" />
                <stop offset=".75" stopColor="#dcf1fd" />
                <stop offset="1" stopColor="#f2faff" />
              </linearGradient>
            </defs>
            <rect width={W} height={H} fill="url(#ps-sky)" />
          </svg>
        </div>
        <div className="layer" data-depth="0.06">
          <svg className="paper" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice">
            <g transform="translate(1250 230)">
              <circle r="112" fill="#fff8e4" opacity=".14" />
              <circle r="92" fill="#fff8e4" opacity=".2" />
              <circle r="72" fill="#fff8e4" opacity=".3" />
              <circle r="52" fill="#fff6dc" />
            </g>
          </svg>
        </div>
        <div className="layer" data-depth="0.12">
          <svg className="paper sway" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice">
            <defs><PaperFilter id="ps-f-cloud" seed={4} /></defs>
            <g fill="#ffffff" filter="url(#ps-f-cloud)">
              <Cloud x={240} y={190} s={1.15} />
              <Cloud x={820} y={120} s={0.8} />
              <Cloud x={1480} y={330} s={0.95} />
            </g>
          </svg>
        </div>
        {LAYERS.map((l, i) => (
          <div className="layer" data-depth={l.depth} key={i}>
            <svg className={`paper ${l.sway ? "sway b" : ""}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice">
              <defs>
                <PaperFilter id={`ps-f${i}`} seed={20 + i} />
                <linearGradient id={`ps-g${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={l.top} />
                  <stop offset="1" stopColor={l.bottom} />
                </linearGradient>
              </defs>
              <g filter={`url(#ps-f${i})`}>
                {l.trees?.map((t, j) => {
                  const y0 = l.ridge(t.x) + 10;
                  return t.kind === "pine" ? (
                    <path key={j} d={pine(t.x, y0, t.h)} fill={l.treeColor} />
                  ) : (
                    <g key={j} fill={t.tint ?? l.treeColor}>
                      <rect x={t.x - 2.5} y={y0 - t.r * 2.2} width={5} height={t.r * 2.2} fill={l.treeColor} />
                      <circle cx={t.x} cy={y0 - t.r * 2.3} r={t.r} />
                    </g>
                  );
                })}
                <path d={ridgePath(l.ridge)} fill={`url(#ps-g${i})`} />
              </g>
            </svg>
          </div>
        ))}
      </div>
      <div className="paper-grain" />
      <div className="paper-vignette" />
    </div>
  );
}

export const PaperScene = memo(PaperSceneInner);
