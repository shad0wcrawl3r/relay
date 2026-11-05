import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

/** A password field with a show/hide toggle, for pasting API keys and secrets. */
export const SecretInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">
>(({ className, ...props }, ref) => {
  const [shown, setShown] = React.useState(false);
  return (
    <div className="relative w-full">
      <Input
        ref={ref}
        type={shown ? "text" : "password"}
        autoComplete="off"
        spellCheck={false}
        className={cn("pr-9", shown && "font-mono text-xs", className)}
        {...props}
      />
      <button
        type="button"
        aria-label={shown ? "Hide" : "Show"}
        aria-pressed={shown}
        onClick={() => setShown((v) => !v)}
        className="absolute inset-y-0 right-0 grid w-9 place-items-center text-dim hover:text-strong"
      >
        {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </div>
  );
});
SecretInput.displayName = "SecretInput";
