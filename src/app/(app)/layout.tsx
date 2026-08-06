import { Sidebar } from "@/components/layout/Sidebar";
import { BottomNav } from "@/components/layout/BottomNav";
import { MobileHeader } from "@/components/layout/MobileHeader";
import { DesktopTopbar } from "@/components/layout/DesktopTopbar";
import { PageTransition } from "@/components/shared/PageTransition";
import { PushBannerPrompt } from "@/components/shared/PushBannerPrompt";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex min-h-screen"
      style={{ background: "var(--bg)" }}
    >
      <Sidebar />

      <div className="flex flex-col flex-1 min-w-0">
        <MobileHeader />
        <DesktopTopbar />

        <main
          className="flex-1 app-main min-w-0"
          style={{
            padding: "80px 28px 120px",
          }}
        >
          <div className="min-w-0" style={{ maxWidth: "var(--maxw)", width: "100%" }}>
            <PushBannerPrompt />
            <PageTransition>{children}</PageTransition>
          </div>
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
