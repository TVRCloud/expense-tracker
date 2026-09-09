import Link from "next/link";
import { Button } from "@/components/_ui/Button";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <header
        className="flex items-center justify-between px-6 py-4 mx-auto w-full"
        style={{ maxWidth: "var(--maxw)" }}
      >
        <Link href="/" className="font-extrabold" style={{ color: "var(--ink)" }}>
          Finance OS
        </Link>
        <nav className="flex items-center gap-2">
          <Link
            href="/login"
            className="px-3 py-2 text-sm font-semibold"
            style={{ color: "var(--ink-2)" }}
          >
            Sign in
          </Link>
          <Button asChild>
            <Link href="/register">Get started</Link>
          </Button>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <footer
        className="px-6 py-8 mx-auto w-full text-center"
        style={{ maxWidth: "var(--maxw)", color: "var(--ink-3)" }}
      >
        <p className="text-sm">© {new Date().getFullYear()} Finance OS</p>
      </footer>
    </div>
  );
}
