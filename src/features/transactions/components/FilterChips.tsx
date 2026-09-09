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
}

// Used as a segmented filter control, not paired with TabsContent — Tabs
// still buys real keyboard arrow-key nav and role="tablist"/"tab" semantics
// over the previous plain <button> row.
export function FilterChips({ chips, active, onChange }: Props) {
  return (
    <Tabs value={active} onValueChange={onChange}>
      <TabsList className="h-auto w-max max-w-full justify-start gap-2.5 overflow-x-auto bg-transparent p-0 scrollbar-none">
        {chips.map((chip) => (
          <TabsTrigger
            key={chip.value}
            value={chip.value}
            className="flex-none whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-semibold"
            style={{
              background: chip.value === active ? "var(--violet)" : "var(--card)",
              color: chip.value === active ? "var(--violet-fg)" : "var(--ink-2)",
              boxShadow: chip.value === active ? "0 4px 14px rgba(0,0,0,.30)" : "var(--shadow-sm)",
            }}
          >
            {chip.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
