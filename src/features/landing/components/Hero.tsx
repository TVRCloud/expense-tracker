import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/_ui/Button";

const BARS = [38, 56, 44, 72, 52, 84, 66];

/** Static illustration of the product (sample figures, decorative). */
function ProductPreview() {
  return (
    <div
      aria-hidden
      className="relative mx-auto w-full max-w-5xl overflow-hidden rounded-(--r-lg) p-5 sm:p-8"
      style={{ background: "var(--card)", boxShadow: "var(--shadow-lg)" }}
    >
      <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <div
          className="relative overflow-hidden rounded-(--r-md) p-6 text-left sm:p-8"
          style={{
            background: "linear-gradient(135deg, var(--hero-from) 0%, var(--hero-mid1) 40%, var(--hero-mid2) 75%, var(--hero-to) 135%)",
            color: "#fff",
          }}
        >
          <div className="text-sm" style={{ color: "rgba(255,255,255,.65)" }}>Net worth</div>
          <div className="tnum mt-1" style={{ font: "var(--text-display)", letterSpacing: "var(--track-title)" }}>
            2,48,310
          </div>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs" style={{ background: "rgba(255,255,255,.12)" }}>
            <span className="size-1.5 rounded-full" style={{ background: "var(--amber)" }} /> 4 accounts
          </div>
        </div>
        <div className="flex flex-col justify-between gap-4 rounded-(--r-md) p-5 text-left" style={{ background: "var(--card-2)" }}>
          <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>This week</div>
          <div className="flex h-24 items-end gap-2">
            {BARS.map((h, i) => (
              <div key={i} className="flex-1 rounded-md" style={{ height: `${h}%`, background: i === 5 ? "var(--violet)" : "var(--line-2)" }} />
            ))}
          </div>
          <div className="flex justify-between text-xs" style={{ color: "var(--ink-3)" }}>
            <span>Spent</span>
            <span className="tnum font-semibold" style={{ color: "var(--ink-2)" }}>on track</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="px-5 pt-14 pb-16 text-center sm:px-8 md:pt-24 md:pb-24">
      <p
        className="mx-auto mb-5 inline-flex rounded-full px-3.5 py-1"
        style={{ background: "var(--card)", boxShadow: "var(--shadow-sm)", font: "var(--text-label)", color: "var(--ink-2)" }}
      >
        Personal finance, minus the noise
      </p>
      <h1
        className="mx-auto max-w-4xl font-bold"
        style={{
          color: "var(--ink)",
          fontSize: "clamp(2.5rem, 7.5vw, 5.5rem)",
          lineHeight: 1.02,
          letterSpacing: "-0.035em",
        }}
      >
        Your money, clearly in view.
      </h1>
      <p className="mx-auto mt-6 max-w-2xl text-lg md:text-xl" style={{ color: "var(--ink-2)", letterSpacing: "-0.01em" }}>
        Track expenses, budgets, loans, cards and savings goals in one calm, fast, installable app.
      </p>

      <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
        <Button asChild size="lg" className="h-12 rounded-full px-7 text-base">
          <Link href="/register">
            Get started <ArrowRight size={18} />
          </Link>
        </Button>
        <Button asChild variant="ghost" size="lg" className="h-12 rounded-full px-6 text-base">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>

      <div className="mt-14 md:mt-20">
        <ProductPreview />
      </div>
    </section>
  );
}
