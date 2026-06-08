"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

interface CalendarGridProps {
  selected?: Date;
  onSelect: (date: Date) => void;
  className?: string;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function buildGrid(year: number, month: number) {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();
  const cells: Array<{ date: Date; current: boolean }> = [];

  for (let i = firstWeekday - 1; i >= 0; i--) {
    cells.push({ date: new Date(year, month - 1, daysInPrev - i), current: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), current: true });
  }
  const tail = 42 - cells.length;
  for (let d = 1; d <= tail; d++) {
    cells.push({ date: new Date(year, month + 1, d), current: false });
  }
  return cells;
}

function NavButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="grid size-8 shrink-0 place-items-center rounded-(--r-sm) transition-colors duration-100"
      style={{
        color: "var(--ink-2)",
        background: hovered ? "var(--card-2)" : "transparent",
      }}
    >
      {children}
    </button>
  );
}

function DayCell({
  date,
  current,
  isToday,
  isSelected,
  onClick,
}: {
  date: Date;
  current: boolean;
  isToday: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = React.useState(false);

  let bg = "transparent";
  if (isSelected) bg = "var(--violet)";
  else if (isToday) bg = "var(--card-2)";
  else if (hovered) bg = "var(--card-2)";

  let color = "var(--ink)";
  if (isSelected) color = "#fff";
  else if (isToday) color = "var(--violet)";
  else if (!current) color = "var(--ink-3)";

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex aspect-square w-full items-center justify-center rounded-(--r-sm) text-[13px] font-semibold transition-all duration-100"
      style={{
        color,
        background: bg,
        outline:
          isToday && !isSelected
            ? "2px solid var(--violet)"
            : "none",
        outlineOffset: "-2px",
      }}
    >
      {date.getDate()}
    </button>
  );
}

function MonthCell({
  label,
  isSelected,
  onClick,
}: {
  label: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="rounded-(--r-sm) py-2.5 text-sm font-semibold transition-all duration-100"
      style={{
        background: isSelected ? "var(--violet)" : hovered ? "var(--card-2)" : "transparent",
        color: isSelected ? "#fff" : "var(--ink)",
      }}
    >
      {label}
    </button>
  );
}

export function CalendarGrid({ selected, onSelect, className }: CalendarGridProps) {
  const today = React.useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [year, setYear] = React.useState(() => (selected ?? today).getFullYear());
  const [month, setMonth] = React.useState(() => (selected ?? today).getMonth());
  const [view, setView] = React.useState<"days" | "months">("days");

  React.useEffect(() => {
    if (selected) {
      setYear(selected.getFullYear());
      setMonth(selected.getMonth());
    }
  }, [selected]);

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  }

  function nextMonth() {
    if (month === 11) { setMonth(0); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  }

  const cells = buildGrid(year, month);

  if (view === "months") {
    return (
      <div className={cn("w-full p-3", className)}>
        <div className="mb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setView("days")}
            className="flex items-center gap-0.5 text-sm font-bold transition-opacity hover:opacity-60"
            style={{ color: "var(--violet)" }}
          >
            <ChevronLeft size={14} />
            <span>Back</span>
          </button>
          <div className="ml-auto flex items-center gap-1">
            <NavButton onClick={() => setYear((y) => y - 1)} label="Previous year">
              <ChevronLeft size={14} />
            </NavButton>
            <span
              className="min-w-12 text-center text-sm font-bold"
              style={{ color: "var(--ink)" }}
            >
              {year}
            </span>
            <NavButton onClick={() => setYear((y) => y + 1)} label="Next year">
              <ChevronRight size={14} />
            </NavButton>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {MONTH_SHORT.map((m, i) => (
            <MonthCell
              key={m}
              label={m}
              isSelected={i === month}
              onClick={() => {
                setMonth(i);
                setView("days");
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("w-full select-none p-3", className)}>
      <div className="mb-3 flex items-center gap-1">
        <NavButton onClick={prevMonth} label="Previous month">
          <ChevronLeft size={16} />
        </NavButton>
        <button
          type="button"
          onClick={() => setView("months")}
          className="flex-1 rounded-(--r-sm) py-1 text-center text-sm font-bold transition-opacity hover:opacity-60"
          style={{ color: "var(--ink)" }}
        >
          {MONTH_NAMES[month]} {year}
        </button>
        <NavButton onClick={nextMonth} label="Next month">
          <ChevronRight size={16} />
        </NavButton>
      </div>

      <div className="mb-1 grid grid-cols-7">
        {DAY_LABELS.map((d) => (
          <div
            key={d}
            className="flex h-8 items-center justify-center text-[11px] font-bold uppercase tracking-wide"
            style={{ color: "var(--ink-3)" }}
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map(({ date, current }, i) => (
          <DayCell
            key={i}
            date={date}
            current={current}
            isToday={isSameDay(date, today)}
            isSelected={!!selected && isSameDay(date, selected)}
            onClick={() => onSelect(date)}
          />
        ))}
      </div>
    </div>
  );
}
