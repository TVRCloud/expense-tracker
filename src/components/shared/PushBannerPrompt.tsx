"use client";

import { useState, useEffect } from "react";
import { Bell, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/_ui/Button";
import { usePushNotification } from "@/features/settings/hooks/usePushNotification";

export function PushBannerPrompt() {
  const { status, subscribe, isLoading, error } = usePushNotification();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    // Only show banner if supported, not enabled yet, and not explicitly dismissed in this session
    if (status === "disabled" && !sessionStorage.getItem("push_banner_dismissed")) {
      setDismissed(false);
    }
  }, [status]);

  if (dismissed || status !== "disabled") return null;

  const handleDismiss = () => {
    sessionStorage.setItem("push_banner_dismissed", "true");
    setDismissed(true);
  };

  return (
    <div
      className="mb-4 rounded-(--r-md) p-4 flex flex-col gap-3 transition-all duration-200"
      style={{
        background: "var(--card)",
        border: "1px solid var(--line)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-full grid place-items-center shrink-0"
            style={{ background: "color-mix(in srgb, var(--amber) 15%, transparent)", color: "var(--amber)" }}
          >
            <Bell size={20} />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-bold truncate" style={{ color: "var(--ink)" }}>
              Enable Push Notifications
            </h4>
            <p className="text-xs truncate" style={{ color: "var(--ink-2)" }}>
              Get instant alerts for EMI reminders, credit due dates, and budget limits.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            onClick={() => subscribe().catch((err: Error) => toast.error(err.message))}
            disabled={isLoading}
            className="h-auto px-3.5 py-1.5 rounded-(--r-sm) text-xs font-bold"
          >
            {isLoading ? "Enabling..." : "Enable"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleDismiss}
            className="w-7 h-7 rounded-full"
            style={{ color: "var(--ink-3)" }}
            aria-label="Dismiss banner"
          >
            <X size={15} />
          </Button>
        </div>
      </div>

      {error && (
        <div
          className="text-xs rounded-(--r-sm) px-3 py-2"
          style={{ background: "color-mix(in srgb, var(--red) 10%, transparent)", color: "var(--red)" }}
        >
          {error} — permission was granted, but the subscription itself failed. Try again, or check{" "}
          <span className="font-semibold">Settings → Notifications</span> for details.
        </div>
      )}
    </div>
  );
}
