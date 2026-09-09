import { Button as ButtonRoot, type ButtonProps, buttonVariants } from "@/components/ui/button";

// Thin re-export so feature code never imports `@/components/ui/button`
// directly — keeps a single seam for future project-specific tweaks without
// ever hand-editing the CLI-vendored file in `ui/`. Colors already resolve
// correctly through globals.css's --primary/--secondary/--destructive
// mappings onto --violet/--card-2/--red, so no visual override is needed here.
export { buttonVariants };
export type { ButtonProps };
export const Button = ButtonRoot;
