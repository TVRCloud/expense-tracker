"use client";

import {
  User,
  Lock,
  Bell,
  LogOut,
  Shield,
  HelpCircle,
  Trash2,
} from "lucide-react";
import { APPEARANCE_ICON, ACCOUNTS_NAV_ICON } from "@/lib/icons";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import apiClient from "@/lib/api-client";
import { useConfirm } from "@/components/_ui/ConfirmDialog";
import { BalanceBanner } from "./BalanceBanner";
import { ProfileCard } from "./ProfileCard";
import { SettingsRow } from "./SettingsRow";
import { useProfile } from "../hooks/useProfile";
import { useAccounts } from "@/features/dashboard/hooks/useDashboard";
import { Skeleton } from "@/components/_ui/Skeleton";
import { PageHeader } from "@/components/shared/PageHeader";

export function AccountClient() {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const { data: accounts, isLoading: accountsLoading } = useAccounts();

  const totalBalance = (accounts ?? []).reduce((sum, a) => sum + a.balance, 0);

  if (profileLoading || accountsLoading) {
    return (
      <div className="page-stack">
        <Skeleton className="h-44 rounded-(--r-lg)" />
        <Skeleton className="h-24 rounded-(--r-lg)" />
        <Skeleton className="h-56 rounded-(--r-md)" />
      </div>
    );
  }

  if (!profile) return null;

  const handleSignOut = async () => {
    await signOut({ redirect: false });
    router.push("/login");
  };

  const handleDeleteAccount = async () => {
    const ok = await confirm({
      title: "Delete your account?",
      description: "This signs you out everywhere and blocks future logins. This can't be undone from here.",
      confirmLabel: "Delete account",
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiClient.delete("/me");
      toast.success("Account deleted");
      await signOut({ callbackUrl: "/login" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete account");
    }
  };

  return (
    <div className="page-stack">
      <PageHeader title="Account" subtitle="Your profile, balance and account controls." />

      <div className="grid-split">
        <div className="page-stack">
          <BalanceBanner totalBalance={totalBalance} accountCount={accounts?.length ?? 0} />

          <div className="grid-2 items-start">
            <div className="inset-group" style={{ "--inset": "60px" } as React.CSSProperties}>
              <SettingsRow icon={User} title="Edit profile" subtitle="Update your name and avatar" href="/settings/profile" />
              <SettingsRow icon={Lock} title="Security" subtitle="Password and sessions" href="/settings/security" />
              <SettingsRow icon={Bell} title="Notifications" subtitle="Push and email preferences" href="/settings/notifications" />
              <SettingsRow icon={APPEARANCE_ICON} title="Appearance" subtitle="Theme and display" href="/settings/appearance" />
            </div>
            <div className="inset-group" style={{ "--inset": "60px" } as React.CSSProperties}>
              <SettingsRow icon={ACCOUNTS_NAV_ICON} title="Accounts" subtitle={`${accounts?.length ?? 0} linked accounts`} href="/accounts" />
              <SettingsRow icon={Shield} title="Privacy" subtitle="Data and permissions" href="/settings/privacy" />
              <SettingsRow icon={HelpCircle} title="Help & Support" subtitle="FAQ and contact" href="/settings/help" />
              <SettingsRow icon={LogOut} title="Sign out" onClick={() => void handleSignOut()} />
            </div>
          </div>
        </div>

        <div className="rail page-stack">
          <ProfileCard user={profile} />
          <div>
            <h2 className="mb-2 px-4" style={{ font: "var(--text-label)", color: "var(--ink-3)" }}>Danger zone</h2>
            <div className="inset-group" style={{ "--inset": "60px" } as React.CSSProperties}>
              <SettingsRow
                icon={Trash2}
                title="Delete account"
                subtitle="Permanently remove your data"
                onClick={() => void handleDeleteAccount()}
                danger
              />
            </div>
          </div>
        </div>
      </div>
      {dialog}
    </div>
  );
}
