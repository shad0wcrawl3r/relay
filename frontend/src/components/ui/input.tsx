import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full rounded-md border border-border bg-transparent px-3 text-[13px] text-strong outline-none placeholder:text-dim focus:border-[#52525b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/20",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
