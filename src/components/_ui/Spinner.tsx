import { cn } from "@/lib/utils";

interface Props {
  size?: number;
  className?: string;
  /** Use on dark/hero surfaces where the ink-colored ring would vanish. */
  inverse?: boolean;
}

/** Dual-ring loading spinner — for button-loading and async states
 * ("Saving…") where plain text alone gave no motion feedback. Color
 * routes through --violet/--violet-fg so light/dark adapt automatically. */
export function Spinner({ size = 16, className, inverse }: Props) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn("spinner-dual inline-block shrink-0 rounded-full", className)}
      style={{
        width: size,
        height: size,
        border: "2px solid transparent",
        borderTopColor: inverse ? "var(--violet-fg)" : "var(--violet)",
        borderRightColor: inverse
          ? "color-mix(in srgb, var(--violet-fg) 35%, transparent)"
          : "color-mix(in srgb, var(--violet) 35%, transparent)",
      }}
    />
  );
}
