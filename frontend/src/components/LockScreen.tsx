import { useState } from "react";
import { Fingerprint, KeyRound, Loader2, Lock } from "lucide-react";
import { projectKey, type Project } from "@/lib/api";
import { usePlane } from "@/lib/store";
import { ProjectGlyph } from "@/components/bits";

/** Unlock button: Touch ID / Face ID when enrolled, else the login password. */
export function UnlockButton({ lockKey, label, small }: { lockKey: string; label?: string; small?: boolean }) {
  const { unlock, unlockMethod } = usePlane();
  const [busy, setBusy] = useState(false);
  const Icon = unlockMethod?.biometry ? Fingerprint : KeyRound;
  if (unlockMethod && !unlockMethod.available) {
    return <span className="text-xs text-dim">Unlocking isn't supported on this system yet.</span>;
  }
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await unlock(lockKey);
        setBusy(false);
      }}
      className={
        small
          ? "no-drag inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-foreground hover:border-border-strong hover:text-strong disabled:opacity-60"
          : "no-drag inline-flex h-9 items-center gap-2 rounded-md bg-strong px-4 text-[13px] font-medium text-background disabled:opacity-60"
      }
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Icon className={small ? "size-3.5" : "size-4"} strokeWidth={1.9} />}
      {label ?? unlockMethod?.label ?? "Unlock"}
    </button>
  );
}

/** Stands in for a locked project's board. */
export function LockScreen({ project }: { project: Project }) {
  const { unlockMethod } = usePlane();
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="drag h-10 shrink-0" />
      <div className="grid flex-1 place-items-center px-6 pb-16">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <div className="relative">
            <ProjectGlyph project={project} />
            <Lock className="absolute -bottom-1.5 -right-1.5 size-3.5 rounded-sm bg-background p-px text-[#5eead4]" strokeWidth={2.2} />
          </div>
          <div>
            <h1 className="m-0 text-[15px] font-semibold text-strong">{project.name} is locked</h1>
            <p className="mt-1.5 text-[13px] leading-relaxed text-dim">
              Its items are encrypted on disk and hidden until you unlock it
              {unlockMethod?.biometry === "touchid" ? " with Touch ID or your password" : unlockMethod?.biometry ? " with Face ID or your password" : " with your password"}.
              It locks again after a few minutes.
            </p>
          </div>
          <UnlockButton lockKey={projectKey(project.identifier)} />
        </div>
      </div>
    </main>
  );
}
