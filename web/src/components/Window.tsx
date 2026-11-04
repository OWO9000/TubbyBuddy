import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";

/** An Aqua window: pinstripe body, traffic-light title bar. `onClose` turns the red light into a real close button. */
export function Window({
  title,
  onClose,
  toolbar,
  className,
  bodyClassName,
  children,
  ...rest
}: Omit<ComponentProps<"section">, "title"> & {
  title: string;
  onClose?: () => void;
  toolbar?: ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("aqua-window", className)} aria-label={rest["aria-label"] ?? title} {...rest}>
      <div className="aqua-titlebar">
        <span className="aqua-lights">
          {onClose ? (
            <button type="button" className="light close" aria-label="Close" onClick={onClose} />
          ) : (
            <i className="light close" aria-hidden="true" />
          )}
          <i className="light min" aria-hidden="true" />
          <i className="light max" aria-hidden="true" />
        </span>
        <span className="aqua-title">{title}</span>
      </div>
      {toolbar && <div className="aqua-toolbar">{toolbar}</div>}
      <div className={cn("aqua-body", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Aqua segmented control (radio-style tabs). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("segmented", className)} role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={value === o.value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
