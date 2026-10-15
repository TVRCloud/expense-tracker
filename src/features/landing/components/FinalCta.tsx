import Link from "next/link";
import { Button } from "@/components/_ui/Button";

export function FinalCta() {
  return (
    <section className="px-5 pb-20 sm:px-8 md:pb-28">
      <div
        className="relative mx-auto flex flex-col items-center gap-4 overflow-hidden rounded-(--r-lg) px-6 py-14 text-center md:py-20"
        style={{
          maxWidth: "var(--maxw)",
          background: "linear-gradient(135deg, var(--hero-from) 0%, var(--hero-mid1) 45%, var(--hero-mid2) 85%, var(--hero-to) 150%)",
          color: "#fff",
        }}
      >
        <h2
          className="max-w-3xl font-bold"
          style={{ fontSize: "clamp(1.9rem, 4.5vw, 3.5rem)", lineHeight: 1.05, letterSpacing: "-0.03em" }}
        >
          Take control of your expenses, budgets, loans and goals.
        </h2>
        <Button
          asChild
          size="lg"
          className="mt-4 h-12 rounded-full px-8 text-base"
          style={{ background: "#fff", color: "#18181b" }}
        >
          <Link href="/register">Get started</Link>
        </Button>
        <p className="text-sm" style={{ color: "rgba(255,255,255,.65)" }}>
          Already have an account?{" "}
          <Link href="/login" className="font-semibold underline-offset-4 hover:underline" style={{ color: "#fff" }}>
            Sign in
          </Link>
        </p>
      </div>
    </section>
  );
}
