import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        outline: "border border-border bg-[#111113] text-[#d4d4d8] font-normal hover:border-border-strong hover:text-strong",
        ghost: "text-muted-foreground hover:bg-accent hover:text-strong",
        teal: "border border-[#1d5c55] bg-[#0d1f1d] text-[#5eead4] font-normal hover:border-[#2a7a70]",
        amber: "border border-[rgba(245,158,11,.32)] bg-[rgba(245,158,11,.08)] text-[#fbbf24] font-normal hover:bg-[rgba(245,158,11,.14)]",
        destructive: "border border-[#5b1d1d] bg-[#1f0d0d] text-[#fca5a5] font-normal hover:border-[#7f2a2a]",
      },
      size: {
        default: "h-[30px] px-2.5 text-xs",
        sm: "h-7 px-2 text-xs",
        lg: "h-10 px-4 text-sm",
        md: "h-9 px-3 text-[13px]",
        icon: "size-[30px]",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
  },
);
Button.displayName = "Button";

export { buttonVariants };
