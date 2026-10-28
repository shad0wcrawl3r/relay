import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer relative inline-flex h-4 w-7 shrink-0 items-center rounded-full bg-[#27272a] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=checked]:bg-[#6366f1]",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="block size-3 translate-x-0.5 rounded-full bg-dim transition-transform data-[state=checked]:translate-x-[14px] data-[state=checked]:bg-white" />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
