import { SettingsShell } from "@/features/settings/components/SettingsClient";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsShell>{children}</SettingsShell>;
}
