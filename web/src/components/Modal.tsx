import { createPortal } from "react-dom";
import { type ReactNode, useEffect, useRef } from "react";
import { APP_NAME } from "../api";
import { Window } from "./Window";

export function Modal({ open, onClose, children, wide, title }: { open: boolean; onClose: () => void; children: ReactNode; wide?: boolean; title?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    boxRef.current?.querySelector("button")?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", k);
    return () => {
      window.removeEventListener("keydown", k);
      prev?.focus();
    };
  }, [open]);

  if (!open) return null;
  // Portal to <body>: a transformed or animated window above would otherwise turn `position: fixed` into
  // "fixed to that window", and the dialog would scroll off the screen with the page.
  return createPortal(
    <div className="modal-back" onClick={() => closeRef.current()}>
      <div ref={boxRef} role="dialog" aria-modal="true" aria-label={title ?? APP_NAME} onClick={(e) => e.stopPropagation()}>
        <Window title={title ?? APP_NAME} onClose={onClose} className={`dialog-window ${wide ? "wide" : ""}`}>
          {children}
        </Window>
      </div>
    </div>,
    document.body,
  );
}
