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
      className={cn(
        // iOS proportions (44x26 track, white thumb), green when on.
        "data-[size=default]:h-[1.625rem] data-[size=default]:w-11 border-0 shadow-none",
        "data-[state=checked]:bg-(--green) data-[state=unchecked]:bg-[color-mix(in_srgb,var(--ink-3)_38%,transparent)]",
        "[&>span]:size-[1.375rem]! [&>span]:ml-[2px] [&>span]:bg-white! [&>span]:shadow-[0_1px_3px_rgba(0,0,0,.3)]",
        "[&>span]:data-[state=checked]:translate-x-[calc(100%-4px)]! [&>span]:transition-transform [&>span]:duration-200 [&>span]:ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:[&>span]:transition-none",
        "active:[&>span]:w-[1.625rem] focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_srgb,var(--violet)_28%,transparent)]",
        className
      )}
      {...props}
    />
  );
});
