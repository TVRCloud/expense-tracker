export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
      <div
        className="w-20 h-20 rounded-[24px] grid place-items-center"
        style={{ background: "var(--card)", boxShadow: "var(--shadow)" }}
      >
        <span className="text-4xl">📡</span>
      </div>
      <h1 className="text-2xl font-extrabold text-center" style={{ color: "var(--ink)" }}>
        You&apos;re offline
      </h1>
      <p className="text-sm text-center max-w-xs" style={{ color: "var(--ink-2)" }}>
        Check your internet connection and try again.
      </p>
    </div>
  );
}
