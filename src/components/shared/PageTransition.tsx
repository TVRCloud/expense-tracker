"use client";

import { motion } from "motion/react";
import { ReactNode } from "react";
import { hasHydrated } from "@/components/shared/hydration";

interface PageTransitionProps {
  children: ReactNode;
  className?: string;
}

// Opacity and a small rise only: animating `filter: blur()` repaints the
// whole page every frame. Server-rendered pages appear at once (see
// hydration.tsx).
export function PageTransition({ children, className = "" }: PageTransitionProps) {
  return (
    <motion.div
      initial={hasHydrated() ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25, ease: [0.25, 1, 0.5, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
