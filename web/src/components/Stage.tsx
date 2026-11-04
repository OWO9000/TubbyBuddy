import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { APP_NAME, COMPANION_NAME } from "../api";
import { CompanionView } from "./CompanionView";
import { reactCompanion, type Mood3D } from "./companionEvents";

/**
 * Full-screen scene for first contact: the valley, a big 3D Tubby in the middle and a game-style dialogue box
 * along the bottom. Used for sign-in and for the setup conversation.
 */

interface Line {
  text: string;
  after?: () => void;
}

const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A small visual-novel script runner. Lines type out one at a time; a click (or Space/Enter) finishes the current
 * line, then moves to the next. The last queued line stays on screen and runs its `after` once it has typed out,
 * which is when the answer buttons appear.
 */
export function useScript() {
  const [line, setLine] = useState<Line | null>(null);
  const [typed, setTyped] = useState(0);
  const pending = useRef<Line[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const firedRef = useRef<Line | null>(null);

  const full = !!line && typed >= line.text.length;
  const idle = !line || (full && pendingCount === 0);

  const say = useCallback((texts: string[], after?: () => void) => {
    const lines: Line[] = texts.map((text, i) => ({ text, after: i === texts.length - 1 ? after : undefined }));
    if (!lines.length) {
      after?.();
      return;
    }
    setLine((cur) => {
      const spent = !cur || (firedRef.current === cur && pending.current.length === 0);
      if (spent) {
        const [first, ...rest] = lines;
        pending.current = rest;
        setPendingCount(rest.length);
        setTyped(0);
        return first;
      }
      pending.current = [...pending.current, ...lines];
      setPendingCount(pending.current.length);
      return cur;
    });
  }, []);

  // Typewriter.
  useEffect(() => {
    if (!line || typed >= line.text.length) return;
    if (reduceMotion()) {
      setTyped(line.text.length);
      return;
    }
    const t = setTimeout(() => setTyped((n) => Math.min(line.text.length, n + 2)), 26);
    return () => clearTimeout(t);
  }, [line, typed]);

  // When the last line finishes, run its callback once.
  useEffect(() => {
    if (!line || !full || pendingCount > 0 || firedRef.current === line) return;
    firedRef.current = line;
    line.after?.();
  }, [line, full, pendingCount]);

  const next = useCallback(() => {
    if (!line) return;
    if (typed < line.text.length) {
      setTyped(line.text.length);
      return;
    }
    if (pending.current.length) {
      const [n, ...rest] = pending.current;
      pending.current = rest;
      setPendingCount(rest.length);
      setTyped(0);
      setLine(n);
    }
  }, [line, typed]);

  return { text: line?.text ?? "", shown: line ? line.text.slice(0, typed) : "", full, idle, hasMore: pendingCount > 0, say, next, key: line };
}

export type Script = ReturnType<typeof useScript>;

/** Measures the free space between the top bar and the dialogue box so the cat always fits without clipping. */
function useFit<T extends HTMLElement>(max: number) {
  const ref = useRef<T>(null);
  const [size, setSize] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const s = Math.floor(Math.min(r.width * 0.9, r.height, max));
      // Too little room (a short phone with the keyboard open): hide the cat rather than let it overlap anything.
      setSize(s < 96 ? 0 : s);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [max]);
  return { ref, size };
}

export function Stage({
  label,
  title,
  mood = "happy",
  actions,
  leaving = false,
  children,
}: {
  label: string;
  title?: string;
  mood?: Mood3D;
  actions?: ReactNode;
  leaving?: boolean;
  children: ReactNode;
}) {
  const { ref, size } = useFit<HTMLDivElement>(460);
  // The stage is full screen: hide the menu bar, dock and page underneath until it starts to leave.
  useEffect(() => {
    if (leaving) return;
    document.body.classList.add("intro-open");
    return () => document.body.classList.remove("intro-open");
  }, [leaving]);
  const waved = useRef(false);
  const onReady = useCallback(() => {
    if (waved.current) return;
    waved.current = true;
    setTimeout(() => reactCompanion("hello"), 250);
  }, []);

  return (
    <div className={`intro ${leaving ? "leaving" : ""}`} role="dialog" aria-modal="true" aria-label={label}>
      <div className="intro-top">
        <span className="intro-brand">
          <img src="/icon-192.png" alt="" width={22} height={22} />
          {APP_NAME}
        </span>
        <span className="intro-actions">{actions}</span>
      </div>
      {title && <h1 className="intro-title">{title}</h1>}
      <div className="intro-cat" ref={ref}>
        {size > 0 && (
          <div className="intro-cat-inner" style={{ width: size, height: size }}>
            <span className="intro-shadow" aria-hidden="true" />
            <CompanionView mood={mood} size={size} label={`${COMPANION_NAME} waving hello`} onReady={onReady} />
          </div>
        )}
      </div>
      <div className="intro-bottom">{children}</div>
    </div>
  );
}

/** The dialogue box: name plate, typed line, a continue marker, and the answer area underneath. */
export function DialogueBox({ script, speaker = COMPANION_NAME, children, footer }: { script: Script; speaker?: string; children?: ReactNode; footer?: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canAdvance = !!script.text && (!script.full || script.hasMore);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " && e.key !== "Enter") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, button, a, [role=button]") || t.isContentEditable)) return;
      if (!canAdvance) return;
      e.preventDefault();
      script.next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canAdvance, script]);

  return (
    <div className="dialogue" ref={boxRef}>
      <span className="dialogue-name">{speaker}</span>
      <div className="dialogue-scroll">
      <div
        className={`dialogue-text ${canAdvance ? "can-advance" : ""}`}
        onClick={canAdvance ? script.next : undefined}
        role={canAdvance ? "button" : undefined}
        tabIndex={canAdvance ? 0 : undefined}
        aria-label={canAdvance ? "Continue" : undefined}
        onKeyDown={(e) => {
          if (canAdvance && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            script.next();
          }
        }}
      >
        {/* The full line reserves its space, so the box never jumps while text types in. */}
        <p className="dialogue-ghost" aria-hidden="true">{script.text || " "}</p>
        <p className="dialogue-live" aria-hidden="true">{script.shown}</p>
        <span className="sr-only" aria-live="polite">{script.text}</span>
        {canAdvance && script.full && <span className="dialogue-more" aria-hidden="true" />}
      </div>
      {script.idle && children && <div className="dialogue-answers">{children}</div>}
      {footer && <div className="dialogue-foot">{footer}</div>}
      </div>
    </div>
  );
}
