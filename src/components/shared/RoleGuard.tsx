"use client";

import { useSession } from "next-auth/react";
import { type ReactNode } from "react";

interface Props {
  roles: string[];
  children: ReactNode;
  fallback?: ReactNode;
}

export function RoleGuard({ roles, children, fallback = null }: Props) {
  const { data: session } = useSession();
  if (!session?.user?.role || !roles.includes(session.user.role)) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
}
