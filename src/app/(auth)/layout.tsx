import { BrandMark } from "@/features/auth/components/AuthShell";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" style={{ background: "var(--bg)" }}>
      {/* Brand panel — desktop only. Gold appears here as the one hero touchpoint. */}
      <aside
        className="relative hidden flex-col justify-between overflow-hidden p-12 lg:flex xl:p-16"
        style={{
          background:
            "linear-gradient(145deg, var(--hero-from) 0%, var(--hero-mid1) 45%, var(--hero-mid2) 80%, var(--hero-to) 140%)",
          color: "#fff",
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -bottom-24 size-[28rem] rounded-full opacity-30"
          style={{ background: "radial-gradient(circle, var(--amber) 0%, transparent 68%)" }}
        />
        <div className="relative [&_span]:!text-white">
          <BrandMark />
        </div>
        <div className="relative max-w-lg">
          <h2
            className="font-bold"
            style={{ fontSize: "clamp(2rem, 3.4vw, 3.25rem)", lineHeight: 1.05, letterSpacing: "var(--track-title)" }}
          >
            Every rupee, dollar and euro, accounted for.
          </h2>
          <p className="mt-4 text-base" style={{ color: "rgba(255,255,255,.7)" }}>
            Budgets, loans, goals and cards in one calm place.
          </p>
        </div>
        <p className="relative text-sm" style={{ color: "rgba(255,255,255,.5)" }}>
          © {new Date().getFullYear()} Finance OS
        </p>
      </aside>

      <main
        className="flex items-center justify-center px-4 py-10 sm:px-8"
        style={{
          background:
            "radial-gradient(120% 80% at 50% 0%, color-mix(in srgb, var(--ink) 5%, transparent), transparent 70%), var(--bg)",
        }}
      >
        <div className="w-full max-w-[440px]">{children}</div>
      </main>
    </div>
  );
}
