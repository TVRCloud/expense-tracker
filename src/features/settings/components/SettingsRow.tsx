import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { type ReactNode } from "react";

interface Props {
  icon: LucideIcon;
  iconColor?: string;
  title: string;
  subtitle?: string;
  href?: string;
  onClick?: () => void;
  trailing?: ReactNode;
  danger?: boolean;
}

export function SettingsRow({
  icon: Icon,
  iconColor = "var(--violet)",
  title,
  subtitle,
  href,
  onClick,
  trailing,
  danger,
}: Props) {
  const tintAlpha = danger ? "rgba(235,87,87,.12)" : "rgba(0,0,0,.12)";
  const finalIconColor = danger ? "var(--red)" : iconColor;

  const inner = (
    <>
      {/* Icon */}
      <div
        className="w-10 h-10 rounded-[12px] grid place-items-center flex-none"
        style={{ background: tintAlpha }}
      >
        <Icon size={19} style={{ color: finalIconColor }} />
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div
          className="text-sm font-bold truncate"
          style={{ color: danger ? "var(--red)" : "var(--ink)" }}
        >
          {title}
        </div>
        {subtitle && (
          <div className="text-xs font-medium mt-0.5 truncate" style={{ color: "var(--ink-3)" }}>
            {subtitle}
          </div>
        )}
      </div>

      {/* Trailing */}
      {trailing ?? <ChevronRight size={17} style={{ color: "var(--ink-3)", flexShrink: 0 }} />}
    </>
  );

  const cls =
    "flex items-center gap-3.5 rounded-[var(--r-md)] px-4 py-3.5 transition-all hover:opacity-85 w-full text-left";
  const style = { background: "var(--card)", boxShadow: "var(--shadow-sm)" };

  if (href) {
    return (
      <Link href={href} className={cls} style={style}>
        {inner}
      </Link>
    );
  }

  return (
    <button onClick={onClick} className={cls} style={style}>
      {inner}
    </button>
  );
}
