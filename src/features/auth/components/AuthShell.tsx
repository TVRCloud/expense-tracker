import type { ReactNode } from "react";
import { Wallet } from "lucide-react";
import { Label } from "@/components/ui/label";

export function BrandMark({ size = 40 }: { size?: number }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="grid place-items-center rounded-[11px]"
        style={{
          width: size,
          height: size,
          background: "linear-gradient(150deg,var(--violet),var(--violet-2))",
          color: "var(--violet-fg)",
        }}
      >
        <Wallet size={size * 0.5} />
      </div>
      <span className="text-xl font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>
        exp<span style={{ color: "var(--violet)" }}>s</span>
      </span>
    </div>
  );
}

/** Glass card used by every auth screen: brand (mobile), big tight title, subtitle, content, footer link. */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      className="glass-surface w-full rounded-(--r-lg) p-6 sm:p-9"
      style={{ boxShadow: "var(--shadow-lg)" }}
    >
      <div className="mb-8 lg:hidden">
        <BrandMark />
      </div>
      <h1 style={{ font: "var(--text-title)", letterSpacing: "var(--track-title)", color: "var(--ink)" }}>{title}</h1>
      {subtitle && (
        <p className="mt-2" style={{ font: "var(--text-body)", color: "var(--ink-2)" }}>
          {subtitle}
        </p>
      )}
      <div className="mt-8">{children}</div>
      {footer && (
        <div className="mt-7 text-center" style={{ font: "var(--text-label)", color: "var(--ink-2)" }}>
          {footer}
        </div>
      )}
    </div>
  );
}

/** Label above a roomy field, inline error below. */
export function AuthField({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={htmlFor} style={{ font: "var(--text-label)", color: "var(--ink-2)" }}>
        {label}
      </Label>
      {children}
      {error && (
        <p role="alert" className="text-xs font-medium" style={{ color: "var(--red)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Success / confirmation state (check your email, password updated). */
export function AuthNotice({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="py-4 text-center">
      <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full" style={{ background: "color-mix(in srgb, var(--green) 14%, transparent)", color: "var(--green)" }}>
        {icon}
      </div>
      <h2 style={{ font: "var(--text-h2)", letterSpacing: "var(--track-h2)", color: "var(--ink)" }}>{title}</h2>
      {children}
    </div>
  );
}

export const AUTH_INPUT = "h-12 rounded-(--r-md) text-base";
export const AUTH_SUBMIT = "mt-1 h-12 w-full rounded-(--r-md) text-base font-semibold";
export const AUTH_LINK = "font-semibold underline-offset-4 outline-none hover:underline focus-visible:underline";
