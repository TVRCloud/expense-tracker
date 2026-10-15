"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** Right-aligned actions (buttons, segmented controls). Wrap below the title on narrow screens. */
  actions?: ReactNode;
}

/**
 * Large page title (iOS "large title"). While it is on screen the topbar
 * hides its own small title; once it scrolls away the small one fades in.
 * Pages without a PageHeader keep the topbar title always visible.
 */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const io = new IntersectionObserver(
      ([entry]) => {
        root.dataset.largeTitle = entry.isIntersecting ? "visible" : "hidden";
      },
      { rootMargin: "-56px 0px 0px 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      delete root.dataset.largeTitle;
    };
  }, []);

  return (
    <div ref={ref} className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 min-w-0">
      <div className="min-w-0">
        <h1 style={{ font: "var(--text-title)", letterSpacing: "var(--track-title)", color: "var(--ink)" }}>
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1.5" style={{ font: "var(--text-body)", color: "var(--ink-2)" }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}
