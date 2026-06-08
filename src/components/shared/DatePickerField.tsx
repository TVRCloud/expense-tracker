"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { format } from "date-fns";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { CalendarGrid } from "@/components/shared/CalendarGrid";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DatePickerFieldProps {
  value?: Date;
  onChange: (date: Date | undefined) => void;
  label?: string;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
}

export function DatePickerField({
  value,
  onChange,
  label,
  placeholder = "Select date",
  clearable = false,
  disabled = false,
  className,
}: DatePickerFieldProps) {
  const [desktopOpen, setDesktopOpen] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const displayValue = value ? format(value, "MMMM d, yyyy") : placeholder;

  function selectDate(date: Date | undefined) {
    if (!date && !clearable) return;
    onChange(date);
    setDesktopOpen(false);
    setMobileOpen(false);
  }

  function clearDate(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    onChange(undefined);
    setDesktopOpen(false);
    setMobileOpen(false);
  }

  function renderTrigger() {
    return (
      <button
        type="button"
        aria-label={label ?? placeholder}
        disabled={disabled}
        className={cn(
          "flex w-full items-center justify-between gap-3 rounded-[var(--r-sm)] px-3 py-2.5 text-left text-sm font-semibold outline-none transition disabled:cursor-not-allowed disabled:opacity-50",
          "focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]",
          !value && "font-medium"
        )}
        style={{
          background: "var(--card-2)",
          color: value ? "var(--ink)" : "var(--ink-3)",
          border: "1.5px solid var(--line)",
        }}
      >
        <span className="min-w-0 flex-1 truncate">{displayValue}</span>
        <CalendarIcon size={16} className="shrink-0" style={{ color: "var(--ink-3)" }} />
      </button>
    );
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      {label && (
        <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "var(--ink-3)" }}>
          {label}
        </div>
      )}

      <div className="hidden md:block">
        <Popover open={desktopOpen} onOpenChange={setDesktopOpen}>
          <PopoverTrigger asChild>{renderTrigger()}</PopoverTrigger>
          <PopoverContent className="w-[288px] overflow-hidden rounded-(--r-md) border p-0 shadow-xl" align="start" style={{ borderColor: "var(--line)", background: "var(--card)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}>
            <CalendarGrid
              selected={value}
              onSelect={(d) => selectDate(d)}
            />
            {clearable && value && (
              <div className="border-t p-2" style={{ borderColor: "var(--line)" }}>
                <button
                  type="button"
                  onClick={clearDate}
                  className="w-full rounded-[var(--r-sm)] px-3 py-2 text-sm font-bold"
                  style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
                >
                  Clear date
                </button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>

      <div className="md:hidden">
        <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
          <Dialog.Trigger asChild>{renderTrigger()}</Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
            <Dialog.Content
              className="fixed inset-x-0 bottom-0 z-50 max-h-[88dvh] overflow-y-auto rounded-t-[var(--r-lg)] border-x border-t p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom"
              style={{ background: "var(--card)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", borderColor: "var(--line)", color: "var(--ink)" }}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <Dialog.Title className="text-sm font-extrabold">
                  {label ?? "Select date"}
                </Dialog.Title>
                <Dialog.Close
                  aria-label="Close calendar"
                  className="grid size-9 place-items-center rounded-full"
                  style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
                >
                  <X size={16} />
                </Dialog.Close>
              </div>

              <CalendarGrid
                selected={value}
                onSelect={(d) => selectDate(d)}
              />

              {clearable && value && (
                <button
                  type="button"
                  onClick={clearDate}
                  className="mt-3 w-full rounded-[var(--r-sm)] px-3 py-2.5 text-sm font-bold"
                  style={{ background: "var(--card-2)", color: "var(--ink-2)" }}
                >
                  Clear date
                </button>
              )}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    </div>
  );
}
