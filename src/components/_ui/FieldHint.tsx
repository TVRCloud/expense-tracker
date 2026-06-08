"use client";

import { useState } from "react";

interface FieldHintProps {
  text: string;
}

export function FieldHint({ text }: FieldHintProps) {
  const [visible, setVisible] = useState(false);

  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      <span
        tabIndex={0}
        role="button"
        aria-label="More information"
        className="inline-flex items-center justify-center cursor-default select-none outline-none"
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          fontSize: 9,
          fontWeight: 700,
          background: visible
            ? "color-mix(in srgb, var(--violet) 15%, transparent)"
            : "var(--card-2)",
          color: visible ? "var(--violet)" : "var(--ink-3)",
          transition: "background 0.15s, color 0.15s",
          lineHeight: 1,
        }}
      >
        ?
      </span>

      {visible && (
        <span
          role="tooltip"
          className="absolute z-50 text-left"
          style={{
            bottom: "calc(100% + 7px)",
            left: "50%",
            transform: "translateX(-50%)",
            width: 220,
            background: "var(--card)",
            boxShadow: "var(--shadow-sm)",
            borderRadius: "var(--r-sm)",
            padding: "7px 10px",
            fontSize: 12,
            fontWeight: 500,
            color: "var(--ink-2)",
            lineHeight: 1.45,
            whiteSpace: "normal",
            pointerEvents: "none",
          }}
        >
          {text}
          {/* Arrow */}
          <span
            style={{
              position: "absolute",
              bottom: -5,
              left: "50%",
              transform: "translateX(-50%)",
              width: 0,
              height: 0,
              borderLeft: "5px solid transparent",
              borderRight: "5px solid transparent",
              borderTop: "5px solid var(--card)",
            }}
          />
        </span>
      )}
    </span>
  );
}
