import type { ComponentProps } from "react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

type WorkspaceToolbarActionButtonProps = Omit<ComponentProps<typeof Button>, "size" | "variant"> & {
  readonly emphasized?: boolean;
  readonly iconOnly?: boolean;
  readonly selected?: boolean;
};

export function WorkspaceToolbarActionButton({
  className,
  emphasized = false,
  iconOnly = false,
  selected,
  ...props
}: WorkspaceToolbarActionButtonProps) {
  return (
    <Button
      {...props}
      aria-pressed={selected ?? props["aria-pressed"]}
      variant="ghost"
      size={iconOnly ? "icon-xs" : "xs"}
      className={cn(
        "h-7 gap-1.5 rounded-[7px] border border-foreground/[0.085] bg-foreground/[0.028] px-2.5 text-[11px] font-normal text-foreground/78 sm:h-6 sm:text-[11px]",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.025),0_1px_1px_rgba(0,0,0,0.08)]",
        "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out",
        "before:rounded-[6px] hover:border-foreground/[0.13] hover:bg-foreground/[0.055] hover:text-foreground",
        "active:translate-y-px active:border-foreground/[0.14] active:bg-foreground/[0.075] active:shadow-none",
        "focus-visible:ring-1 focus-visible:ring-ring/70 focus-visible:ring-offset-1",
        "[&_svg:not([class*='text-'])]:text-muted-foreground/78",
        iconOnly && "w-7 px-0 sm:w-6",
        emphasized && "bg-foreground/[0.045] font-medium text-foreground/92",
        selected &&
          "border-foreground/[0.13] bg-foreground/[0.085] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]",
        className,
      )}
    />
  );
}
