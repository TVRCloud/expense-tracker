"use client";

import { motion } from "motion/react";
import { ReactNode, CSSProperties } from "react";
import { hasHydrated } from "@/components/shared/hydration";

interface StaggerContainerProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  staggerDelay?: number;
  delayChildren?: number;
}

export function StaggerContainer({
  children,
  className = "",
  style,
  staggerDelay = 0.04,
  delayChildren = 0.02,
}: StaggerContainerProps) {
  return (
    <motion.div
      // Already in the server HTML: show at once, no stagger (hydration.tsx).
      initial={hasHydrated() ? "hidden" : false}
      animate="show"
      exit="hidden"
      variants={{
        hidden: {},
        show: {
          transition: {
            staggerChildren: staggerDelay,
            delayChildren: delayChildren,
          },
        },
      }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}

interface StaggerItemProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function StaggerItem({ children, className = "", style }: StaggerItemProps) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 12, scale: 0.98 },
        show: {
          opacity: 1,
          y: 0,
          scale: 1,
          // Critically damped (2·√350 ≈ 37): items settle, they don't bounce.
          transition: {
            type: "spring",
            stiffness: 350,
            damping: 38,
          },
        },
      }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}
