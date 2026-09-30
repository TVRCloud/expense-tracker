import { forwardRef } from "react";
import { Button as ButtonRoot, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Thin wrapper so feature code never imports `@/components/ui/button`
// directly — keeps a single seam for project-specific tweaks without ever
// hand-editing the CLI-vendored file in `ui/`. Colors resolve through
// globals.css's --primary/--secondary/--destructive mappings. Adds the
// shared press feedback (`.btn-interactive`: a small scale on pointer-down)
// and, on touch screens, a 44px minimum hit area.
export { buttonVariants };
// The vendored button no longer exports a props type (shadcn's React 19
// version is a plain function component), so derive it here.
export type ButtonProps = React.ComponentProps<typeof ButtonRoot>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, asChild, ...props }, ref) {
  return (
    <ButtonRoot
      ref={ref}
      asChild={asChild}
      className={cn(!asChild && "btn-interactive", "pointer-coarse:min-h-11 pointer-coarse:min-w-11", className)}
      {...props}
    />
  );
});
