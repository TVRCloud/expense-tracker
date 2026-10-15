import { forwardRef } from "react";
import { Input as InputRoot } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Thin wrapper — adds the shared animated focus-glow ring (`.focus-glow` in
// globals.css) plus a brief shake when `aria-invalid` is set, on top of the
// CLI-vendored `ui/input.tsx`. Never edit that file directly; extend here.
export const Input = forwardRef<HTMLInputElement, React.ComponentProps<typeof InputRoot>>(
  function Input({ className, ...props }, ref) {
    return <InputRoot ref={ref} className={cn(
        "focus-glow h-11 rounded-(--r-sm) border-(--line-2) bg-(--card-2) px-3.5 text-[15px] font-medium md:text-[15px] dark:bg-(--card-2)",
        "placeholder:text-(--ink-3) focus-visible:border-(--violet) focus-visible:ring-0 aria-invalid:border-(--red)",
        className
      )} {...props} />;
  }
);
