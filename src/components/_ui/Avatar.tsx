import type { CSSProperties } from "react";
import {
  Avatar as AvatarRoot,
  AvatarImage,
  AvatarFallback,
} from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface Props {
  name: string;
  src?: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Initials avatar with the app's violet gradient fill — the one
 * implementation shared by every place a user/entity avatar shows up
 * (header, sidebar, settings, auth forms, admin user list). */
export function Avatar({ name, src, size = 40, className, style }: Props) {
  return (
    <AvatarRoot className={cn("shrink-0", className)} style={{ width: size, height: size, ...style }}>
      {src && <AvatarImage src={src} alt={name} className="object-cover" />}
      <AvatarFallback
        className="font-extrabold"
        style={{
          background: "linear-gradient(150deg,var(--violet),var(--violet-2))",
          color: "var(--violet-fg)",
          fontSize: Math.max(11, size * 0.38),
        }}
      >
        {initialsOf(name)}
      </AvatarFallback>
    </AvatarRoot>
  );
}
