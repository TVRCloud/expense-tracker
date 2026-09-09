"use client";

import { motion } from "motion/react";
import { ReactNode, CSSProperties } from "react";

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
  staggerDelay = 0.06,
  delayChildren = 0.02,
}: StaggerContainerProps) {
  return (
    <motion.div
      initial="hidden"
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
          transition: {
            type: "spring",
            stiffness: 350,
            damping: 25,
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
