import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  icon: LucideIcon;
  /** Kept for API compatibility; tile colour now follows the brand tokens. */
  iconColor?: string;
  title: string;
  subtitle?: string;
  href?: string;
  onClick?: () => void;
  trailing?: ReactNode;
  danger?: boolean;
  /** Highlights the row (current section in the desktop two-pane layout). */
  selected?: boolean;
}

/**
 * Navigation row for an `.inset-group` (set `--inset: 60px` so the hairline
 * starts after the icon tile). 56px min height, 32px icon tile, press tint,
 * chevron trailing unless `trailing` is given.
 */
export function SettingsRow({ icon: Icon, title, subtitle, href, onClick, trailing, danger, selected }: Props) {
  const inner = (
    <>
      <div
        className="grid size-8 flex-none place-items-center rounded-[9px]"
        style={
          danger
            ? { background: "color-mix(in srgb, var(--red) 14%, transparent)", color: "var(--red)" }
            : { background: "var(--violet)", color: "var(--violet-fg)" }
        }
      >
        <Icon size={17} strokeWidth={2.2} />
      </div>
      <div className="min-w-0 flex-1 text-left">
        <div className="truncate" style={{ font: "var(--text-body)", color: danger ? "var(--red)" : "var(--ink)" }}>
          {title}
        </div>
        {subtitle && (
          <div className="mt-0.5 truncate" style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>
            {subtitle}
          </div>
        )}
      </div>
      {trailing ?? <ChevronRight size={16} className="flex-none" style={{ color: "var(--ink-3)" }} />}
    </>
  );

  const cls = cn(
    "flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left outline-none transition-colors",
    "hover:bg-(--card-2) active:bg-(--card-2) focus-visible:bg-(--card-2)",
    selected && "bg-[color-mix(in_srgb,var(--violet)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--violet)_12%,transparent)]"
  );

  if (href) {
    return (
      <Link href={href} className={cls} aria-current={selected ? "page" : undefined}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}
