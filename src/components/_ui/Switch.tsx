import { forwardRef } from "react";
import { Switch as SwitchRoot } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// Thin wrapper — a quick ease-out thumb: a tap has no momentum, so the
// thumb settles without overshoot. Never edit the vendored `ui/switch.tsx`
// directly; extend here.
export const Switch = forwardRef<
  React.ElementRef<typeof SwitchRoot>,
  React.ComponentPropsWithoutRef<typeof SwitchRoot>
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchRoot
      ref={ref}
      className={cn("[&>span]:transition-transform [&>span]:duration-200 [&>span]:ease-[cubic-bezier(0.22,1,0.36,1)]", className)}
      {...props}
    />
  );
});
