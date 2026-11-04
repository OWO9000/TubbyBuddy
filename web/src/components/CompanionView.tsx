import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import type { Cosmetic, Slot } from "../api";
import { Companion, type Mood } from "./Companion";
import { hasWebGL, to3D, type Mood3D } from "./companionEvents";

const Companion3D = lazy(() => import("./Companion3D"));

function to2D(m: Mood | Mood3D): Mood {
  return m;
}

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function CompanionView({ mood, equipped, size = 220, label, onReady }: { mood: Mood | Mood3D; equipped?: Partial<Record<Slot, Cosmetic>>; size?: number; label?: string; onReady?: () => void }) {
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const fallback = <Companion mood={to2D(mood)} equipped={equipped} size={size} />;
  if (!hasWebGL() || failed) return fallback;
  return (
    <div className="companion-view" style={{ position: "relative", width: size, height: size }}>
      <Boundary fallback={fallback}>
        <Suspense fallback={fallback}>
          <Companion3D mood={to3D(mood)} equipped={equipped} size={size} label={label} onError={() => setFailed(true)} onReady={() => { setReady(true); onReady?.(); }} />
        </Suspense>
      </Boundary>
      {!failed && (
        <div className="companion-view-cover" aria-hidden="true" style={{ opacity: ready ? 0 : 1 }}>
          {fallback}
        </div>
      )}
    </div>
  );
}
