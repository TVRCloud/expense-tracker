import { forwardRef } from "react";
import { Switch as SwitchRoot } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// Thin wrapper — tunes the thumb's transition to a snappier, slightly
// bouncy easing than the vendored `ui/switch.tsx` default, so toggles
// (notifications, appearance) feel more responsive. Never edit that file
// directly; extend here.
export const Switch = forwardRef<
  React.ElementRef<typeof SwitchRoot>,
  React.ComponentPropsWithoutRef<typeof SwitchRoot>
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchRoot
      ref={ref}
      className={cn("[&>span]:transition-transform [&>span]:duration-300 [&>span]:ease-[cubic-bezier(0.34,1.56,0.64,1)]", className)}
      {...props}
    />
  );
});
