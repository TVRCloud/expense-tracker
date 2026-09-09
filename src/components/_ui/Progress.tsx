import type { CSSProperties } from "react";
import { Progress as ProgressRoot } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface Props {
  value: number;
  color?: string;
  trackColor?: string;
  className?: string;
  height?: number;
  "aria-label"?: string;
}

/** Progress bar with a per-instance fill color — the stock component's
 * indicator/track are hardcoded to bg-primary/bg-secondary. Since those
 * Tailwind utilities resolve to `var(--primary)`/`var(--secondary)`, scoping
 * a local override of those two custom properties on the wrapper achieves a
 * per-instance color without touching the CLI-vendored component (this app
 * needs green/amber/red bars driven by data — budget usage, credit
 * utilization, loan payoff, goal progress). */
export function Progress({ value, color, trackColor, className, height = 8, "aria-label": ariaLabel }: Props) {
  const style = {
    height,
    "--primary": color ?? "var(--violet)",
    "--secondary": trackColor ?? "var(--line-2)",
  } as CSSProperties;

  return (
    <ProgressRoot
      value={Math.min(100, Math.max(0, value))}
      className={cn(className)}
      style={style}
      aria-label={ariaLabel}
    />
  );
}
