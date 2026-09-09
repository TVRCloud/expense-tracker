import { Skeleton as SkeletonRoot } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface Props extends React.ComponentPropsWithoutRef<typeof SkeletonRoot> {
  /** Use on dark/hero surfaces (e.g. the gradient balance card) where the
   * stock muted-gray fill would be invisible. */
  inverse?: boolean;
}

export function Skeleton({ inverse, className, ...props }: Props) {
  return (
    <SkeletonRoot
      className={cn(inverse && "bg-white/15 before:via-white/25", className)}
      {...props}
    />
  );
}
