import { Sidebar } from "@/components/layout/Sidebar";
import { BottomNav } from "@/components/layout/BottomNav";
import { MobileHeader } from "@/components/layout/MobileHeader";
import { DesktopTopbar } from "@/components/layout/DesktopTopbar";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { PageTransition } from "@/components/shared/PageTransition";
import { PushBannerPrompt } from "@/components/shared/PushBannerPrompt";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen" style={{ background: "var(--bg)" }}>
      <Sidebar />

      <div className="flex flex-col flex-1 min-w-0">
        <MobileHeader />
        <DesktopTopbar />

        {/* Fluid: pages use the full content width up to --maxw (ultrawide
            cap), centred beyond it, with gutters that scale with viewport. */}
        <main className="flex-1 app-main min-w-0">
          <div className="min-w-0 mx-auto w-full" style={{ maxWidth: "var(--maxw)" }}>
            <PushBannerPrompt />
            <PageTransition>{children}</PageTransition>
          </div>
        </main>
      </div>

      <BottomNav />
      <CommandPalette />
    </div>
  );
}
