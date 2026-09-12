"use client";

import { forwardRef, useCallback, useRef, useState, type PointerEvent } from "react";
import { Button as ButtonRoot, type ButtonProps, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Thin wrapper so feature code never imports `@/components/ui/button`
// directly — keeps a single seam for future project-specific tweaks without
// ever hand-editing the CLI-vendored file in `ui/`. Colors already resolve
// correctly through globals.css's --primary/--secondary/--destructive
// mappings onto --violet/--card-2/--red, so no visual override is needed
// for that. On top of the vendored component, this adds the shared
// press/shine micro-interaction (`.btn-interactive` in globals.css) plus a
// one-shot ripple spawned at the pointer's down position — purely visual,
// `asChild` still forwards straight to Slot with no ripple wrapper markup.
export { buttonVariants };
export type { ButtonProps };

let rippleId = 0;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, onPointerDown, asChild, children, ...props },
  ref
) {
  const [ripples, setRipples] = useState<{ id: number; x: string; y: string }[]>([]);
  const hostRef = useRef<HTMLButtonElement | null>(null);

  const setRefs = useCallback(
    (node: HTMLButtonElement | null) => {
      hostRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLButtonElement | null>).current = node;
    },
    [ref]
  );

  const handlePointerDown = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      const el = hostRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const id = rippleId++;
        setRipples((prev) => [
          ...prev,
          { id, x: `${e.clientX - rect.left}px`, y: `${e.clientY - rect.top}px` },
        ]);
        window.setTimeout(() => {
          setRipples((prev) => prev.filter((r) => r.id !== id));
        }, 600);
      }
      onPointerDown?.(e);
    },
    [onPointerDown]
  );

  // `asChild` renders whatever child was passed via Slot — no room to inject
  // ripple spans without breaking that contract, so skip the effect there.
  if (asChild) {
    return (
      <ButtonRoot ref={setRefs} className={className} asChild {...props}>
        {children}
      </ButtonRoot>
    );
  }

  return (
    <ButtonRoot
      ref={setRefs}
      className={cn("btn-interactive", className)}
      onPointerDown={handlePointerDown}
      {...props}
    >
      {children}
      {ripples.map((r) => (
        <span
          key={r.id}
          className="btn-ripple"
          style={{ "--ripple-x": r.x, "--ripple-y": r.y } as React.CSSProperties}
        />
      ))}
    </ButtonRoot>
  );
});
