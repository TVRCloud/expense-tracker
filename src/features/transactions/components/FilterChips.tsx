"use client";

interface Chip {
  label: string;
  value: string;
}

interface Props {
  chips: Chip[];
  active: string;
  onChange: (value: string) => void;
}

export function FilterChips({ chips, active, onChange }: Props) {
  return (
    <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-none">
      {chips.map((chip) => {
        const isActive = chip.value === active;
        return (
          <button
            key={chip.value}
            onClick={() => onChange(chip.value)}
            className="whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-semibold transition-all flex-none"
            style={
              isActive
                ? {
                    background: "var(--violet)",
                    color: "#fff",
                    boxShadow: "0 4px 14px rgba(0,0,0,.30)",
                  }
                : {
                    background: "var(--card)",
                    color: "var(--ink-2)",
                    boxShadow: "var(--shadow-sm)",
                  }
            }
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
