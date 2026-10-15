import Link from "next/link";
import { Button } from "@/components/_ui/Button";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col" style={{ background: "var(--bg)" }}>
      <header
        className="chrome sticky top-0 z-30"
        style={{ borderBottom: "1px solid var(--line)", paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div
          className="mx-auto flex h-14 w-full items-center justify-between px-5 sm:px-8"
          style={{ maxWidth: "var(--maxw)" }}
        >
          <Link href="/" className="text-base font-bold tracking-[-0.02em]" style={{ color: "var(--ink)" }}>
            Finance OS
          </Link>
          <nav className="flex items-center gap-1.5">
            <Button asChild variant="ghost" className="h-9 rounded-full px-4">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild className="h-9 rounded-full px-4">
              <Link href="/register">Get started</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer
        className="mx-auto w-full px-5 py-8 text-center sm:px-8"
        style={{ maxWidth: "var(--maxw)", color: "var(--ink-3)", borderTop: "1px solid var(--line)" }}
      >
        <p className="text-sm">© {new Date().getFullYear()} Finance OS</p>
      </footer>
    </div>
  );
}
