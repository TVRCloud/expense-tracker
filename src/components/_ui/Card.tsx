import type { ComponentPropsWithoutRef, ElementType } from "react";
import { cn } from "@/lib/utils";

// Elevation tiers — one consistent shadow+border combo per surface role,
// so components pick a tier instead of copy-pasting a shadow value.
//   resting   — default static card (list rows, stat cards)
//   raised    — interactive card that responds to hover/focus (clickable rows/links)
//   floating  — anything visually above the page (menus rendered inline, banners)
const ELEVATION = {
  resting: "shadow-(--shadow-sm)",
  raised:
    "shadow-(--shadow-sm) transition-shadow duration-150 hover:shadow-(--shadow) focus-visible:shadow-(--shadow)",
  floating: "shadow-(--shadow-lg)",
} as const;

const SURFACE = {
  card: "bg-(--card)",
  "card-2": "bg-(--card-2)",
} as const;

const RADIUS = {
  lg: "rounded-(--r-lg)",
  md: "rounded-(--r-md)",
  sm: "rounded-(--r-sm)",
} as const;

interface CardOwnProps {
  surface?: keyof typeof SURFACE;
  elevation?: keyof typeof ELEVATION;
  radius?: keyof typeof RADIUS;
}

type CardProps<T extends ElementType> = CardOwnProps & {
  as?: T;
} & Omit<ComponentPropsWithoutRef<T>, keyof CardOwnProps | "as">;

/** Shared card surface — background, radius, and elevation tier all come from
 * the design tokens in globals.css instead of being redeclared per call site. */
export function Card<T extends ElementType = "div">({
  as,
  surface = "card",
  elevation = "resting",
  radius = "lg",
  className,
  ...props
}: CardProps<T>) {
  const Comp = as || "div";
  return (
    <Comp
      className={cn(SURFACE[surface], RADIUS[radius], ELEVATION[elevation], className)}
      {...props}
    />
  );
}
