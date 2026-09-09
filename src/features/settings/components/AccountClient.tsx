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
import { Skeleton } from "@/components/ui/skeleton";

export function AccountClient() {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const { data: accounts, isLoading: accountsLoading } = useAccounts();

  const totalBalance = (accounts ?? []).reduce((sum, a) => sum + a.balance, 0);

  if (profileLoading || accountsLoading) {
    return (
      <div className="flex flex-col gap-5">
        <Skeleton className="h-44 rounded-[var(--r-lg)]" />
        <Skeleton className="h-24 rounded-[var(--r-lg)]" />
        <div className="grid md:grid-cols-2 gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-16 rounded-[var(--r-md)]" />
          ))}
        </div>
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
    <div className="flex flex-col gap-5">
      {/* Balance banner */}
      <BalanceBanner
        totalBalance={totalBalance}
        accountCount={accounts?.length ?? 0}
      />

      {/* Profile card */}
      <ProfileCard user={profile} />

      {/* Settings grid */}
      <div className="grid md:grid-cols-2 gap-3">
        {/* Left column */}
        <div className="flex flex-col gap-3">
          <SettingsRow
            icon={User}
            title="Edit Profile"
            subtitle="Update your name and avatar"
            href="/settings/profile"
          />
          <SettingsRow
            icon={Lock}
            title="Security"
            subtitle="Password & active sessions"
            href="/settings/security"
          />
          <SettingsRow
            icon={Bell}
            title="Notifications"
            subtitle="Push & email preferences"
            href="/settings/notifications"
          />
          <SettingsRow
            icon={APPEARANCE_ICON}
            title="Appearance"
            subtitle="Theme and display"
            href="/settings/appearance"
          />
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-3">
          <SettingsRow
            icon={ACCOUNTS_NAV_ICON}
            title="Accounts"
            subtitle={`${accounts?.length ?? 0} linked accounts`}
            href="/accounts"
          />
          <SettingsRow
            icon={Shield}
            title="Privacy"
            subtitle="Data and permissions"
            href="/settings/privacy"
          />
          <SettingsRow
            icon={HelpCircle}
            title="Help & Support"
            subtitle="FAQ and contact"
            href="/settings/help"
          />
          <SettingsRow
            icon={LogOut}
            title="Sign Out"
            onClick={() => void handleSignOut()}
          />
        </div>
      </div>

      {/* Danger zone */}
      <div className="flex flex-col gap-3">
        <div className="text-[11px] font-bold uppercase tracking-wider px-1" style={{ color: "var(--ink-3)" }}>
          Danger Zone
        </div>
        <SettingsRow
          icon={Trash2}
          title="Delete Account"
          subtitle="Permanently remove your data"
          onClick={() => void handleDeleteAccount()}
          danger
        />
      </div>
      {dialog}
    </div>
  );
}
