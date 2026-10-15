import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Grouped-section primitives shared by every settings page (iOS grouped
 * list): a quiet label above, one inset surface, an optional footnote below.
 */
export function Group({
  title,
  footer,
  children,
  inset = 16,
  className,
}: {
  title?: string;
  footer?: ReactNode;
  children: ReactNode;
  /** Left inset of the hairline dividers (px). */
  inset?: number;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0", className)}>
      {title && (
        <h3
          className="mb-2 px-4"
          style={{ font: "var(--text-label)", color: "var(--ink-3)", letterSpacing: "0.01em" }}
        >
          {title}
        </h3>
      )}
      <div className="inset-group" style={{ "--inset": `${inset}px` } as CSSProperties}>
        {children}
      </div>
      {footer && (
        <p className="mt-2 px-4" style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>
          {footer}
        </p>
      )}
    </section>
  );
}

/** Static row: title + optional description left, control right. */
export function Row({
  title,
  description,
  trailing,
  danger,
}: {
  title: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  danger?: boolean;
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div style={{ font: "var(--text-body)", color: danger ? "var(--red)" : "var(--ink)" }}>{title}</div>
        {description && (
          <div className="mt-0.5" style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>
            {description}
          </div>
        )}
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-2">{trailing}</div>}
    </div>
  );
}

/** Padded block inside a Group for stacked form fields. */
export function FormBlock({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-4 p-4", className)}>{children}</div>;
}

export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} style={{ font: "var(--text-label)", color: "var(--ink-2)" }}>
      {children}
    </label>
  );
}

/** Two/three-way segmented control; the selected segment is a raised pill. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T | null;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex rounded-(--r-sm) p-0.5"
      style={{ background: "var(--card-2)" }}
    >
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className="btn-interactive min-h-8 rounded-[9px] px-3.5 text-[13px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-(--violet)"
            style={
              active
                ? { background: "var(--card)", color: "var(--ink)", boxShadow: "var(--shadow-sm)" }
                : { color: "var(--ink-2)" }
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
