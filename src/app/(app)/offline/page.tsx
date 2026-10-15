import { WifiOff } from "lucide-react";

export default function OfflinePage() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div
        className="grid size-20 place-items-center rounded-(--r-lg)"
        style={{ background: "var(--card)", boxShadow: "var(--shadow)", color: "var(--ink-2)" }}
      >
        <WifiOff size={34} strokeWidth={1.8} aria-hidden />
      </div>
      <h1 style={{ font: "var(--text-title)", letterSpacing: "var(--track-title)", color: "var(--ink)" }}>
        You&apos;re offline
      </h1>
      <p className="max-w-xs" style={{ font: "var(--text-body)", color: "var(--ink-2)" }}>
        Check your internet connection and try again. Pages you opened recently may still be available.
      </p>
    </div>
  );
}
