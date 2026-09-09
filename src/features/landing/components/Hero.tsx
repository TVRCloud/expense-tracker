import Link from "next/link";
import { Button } from "@/components/_ui/Button";

export function Hero() {
  return (
    <section className="px-6 pt-16 pb-20 md:pt-24 md:pb-28 text-center">
      <h1
        className="font-extrabold tracking-tight"
        style={{ color: "var(--ink)", fontSize: "clamp(2.25rem, 5vw, 3.5rem)" }}
      >
        Finance OS
      </h1>
      <p
        className="mt-4 max-w-xl mx-auto text-lg"
        style={{ color: "var(--ink-2)" }}
      >
        Track your expenses, budgets, loans, and savings goals.
      </p>
      <p className="mt-2 text-sm" style={{ color: "var(--ink-3)" }}>
        A production-quality full-stack expense tracker.
      </p>

      <div className="mt-8 flex items-center justify-center gap-3">
        <Button asChild size="lg">
          <Link href="/register">Get started</Link>
        </Button>
        <Link
          href="/login"
          className="px-4 py-2 text-sm font-semibold"
          style={{ color: "var(--ink-2)" }}
        >
          Sign in
        </Link>
      </div>
    </section>
  );
}
