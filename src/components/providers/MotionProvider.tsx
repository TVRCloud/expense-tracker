"use client";

import { MotionConfig } from "motion/react";
import { type ReactNode } from "react";

// Every motion/react animation follows the system "reduce motion" setting:
// transforms and layout animations are skipped, opacity changes stay (the
// CSS side is handled in globals.css).
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
