import * as React from "react";

import { cn } from "../../lib/cn";

function Dock({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="dock" className={cn("aqua-dock", className)} {...props} />
  );
}

function DockItem({
  label,
  active = false,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  label?: string;
  active?: boolean;
}) {
  return (
    <div data-slot="dock-item" className={cn("aqua-dock-item", className)} {...props}>
      {label ? <span className="aqua-dock-label">{label}</span> : null}
      {children}
      <span className={cn("aqua-dock-dot", active && "on")} />
    </div>
  );
}

function DockIcon({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="dock-icon" className={cn("aqua-dock-icon", className)} {...props} />
  );
}

export { Dock, DockItem, DockIcon };
