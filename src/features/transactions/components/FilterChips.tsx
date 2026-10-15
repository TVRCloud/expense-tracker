"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Chip {
  label: string;
  value: string;
}

interface Props {
  chips: Chip[];
  active: string;
  onChange: (value: string) => void;
  /** "segmented": one rounded track with a raised active pill (type filter).
   *  "chips": free-floating scrollable pills (category filter). */
  variant?: "segmented" | "chips";
}

// Used as a filter control, not paired with TabsContent — Tabs still buys
// real keyboard arrow-key nav and role="tablist"/"tab" semantics.
export function FilterChips({ chips, active, onChange, variant = "chips" }: Props) {
  if (variant === "segmented") {
    return (
      <Tabs value={active} onValueChange={onChange} className="min-w-0">
        <TabsList
          className="h-10 w-full sm:w-max max-w-full gap-0.5 rounded-full p-1"
          style={{ background: "var(--card-2)" }}
        >
          {chips.map((chip) => {
            const on = chip.value === active;
            return (
              <TabsTrigger
                key={chip.value}
                value={chip.value}
                className="flex-1 sm:flex-none whitespace-nowrap rounded-full px-4 h-8 text-[13px] font-semibold border-0 shadow-none transition-[background-color,color,box-shadow] duration-150 active:scale-[0.97]"
                style={{
                  background: on ? "var(--card)" : "transparent",
                  color: on ? "var(--ink)" : "var(--ink-2)",
                  boxShadow: on ? "var(--shadow-sm)" : "none",
                }}
              >
                {chip.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
    );
  }

  return (
    <Tabs value={active} onValueChange={onChange} className="min-w-0">
      <TabsList className="h-auto w-max max-w-full justify-start gap-2 overflow-x-auto bg-transparent p-0 scrollbar-none">
        {chips.map((chip) => {
          const on = chip.value === active;
          return (
            <TabsTrigger
              key={chip.value}
              value={chip.value}
              className="flex-none whitespace-nowrap rounded-full px-3.5 h-8 text-[13px] font-semibold border-0 shadow-none transition-[background-color,color] duration-150 active:scale-[0.97]"
              style={{
                background: on ? "var(--ink)" : "var(--card-2)",
                color: on ? "var(--bg)" : "var(--ink-2)",
              }}
            >
              {chip.label}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
