import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { GlassIntensityProvider } from "@/components/providers/GlassIntensityProvider";
import { SessionProvider } from "@/components/providers/SessionProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { MotionProvider } from "@/components/providers/MotionProvider";
import { SocketProvider } from "@/components/providers/SocketProvider";
import { Toaster } from "sonner";
import { HydrationMarker } from "@/components/shared/hydration";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

// Ledger-precision numerals for monetary figures — see globals.css --font-mono.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Finance OS",
    template: "%s | Finance OS",
  },
  description: "Track your expenses, budgets, loans, and savings goals.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0b" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plusJakarta.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <HydrationMarker />
        <SessionProvider>
          <ThemeProvider>
            <GlassIntensityProvider>
              <QueryProvider>
                <MotionProvider>
                  <SocketProvider>
                    {children}
                  </SocketProvider>
                </MotionProvider>
                {/* Bottom-centre, above the mobile tab bar: top-right sat under
                    the sticky mobile header. */}
                <Toaster position="bottom-center" offset={{ bottom: 96 }} mobileOffset={{ bottom: 96 }} richColors closeButton />
              </QueryProvider>
            </GlassIntensityProvider>
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
