import { useState } from "react";
import { Inbox, X } from "lucide-react";
import { ago } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { ToneIcon, useInbox } from "@/components/Toaster";

/**
 * The notification pane: toasts worth finding again after they're gone
 * (errors, failed Buffer posts, updates, publish results). Kept in memory for
 * this session only. Opening it marks everything read.
 */
export function NotificationsButton({ rail, itemClass }: { rail: boolean; itemClass: string }) {
  const { notices, unread, markRead, remove, clear } = useInbox();
  const [open, setOpen] = useState(false);

  const trigger = (
    <PopoverTrigger asChild>
      <button className={cn(itemClass, "relative")} aria-label={rail ? `Notifications${unread ? `, ${unread} unread` : ""}` : undefined}>
        <Inbox className="size-[15px]" strokeWidth={1.8} />
        {rail && unread > 0 && <span aria-hidden className="absolute right-2 top-2 size-1.5 rounded-full bg-[#f87171]" />}
        {!rail && <span className="truncate">Notifications</span>}
        {!rail && unread > 0 && (
          <span className="ml-auto rounded-full bg-[#3b1a1a] px-[7px] py-px text-[11px] text-[#fecaca]" aria-label={`${unread} unread`}>
            {unread}
          </span>
        )}
      </button>
    </PopoverTrigger>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) markRead();
      }}
    >
      {rail ? (
        <Tooltip label="Notifications" side="right">
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}
      <PopoverContent side="right" align="end" sideOffset={10} className="flex max-h-[70vh] w-[380px] flex-col p-0">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="text-[13px] font-semibold text-strong">Notifications</span>
          <span className="text-xs text-dim">This session</span>
          {notices.length > 0 && (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={clear}>
              Clear all
            </Button>
          )}
        </div>
        {notices.length === 0 ? (
          <p className="m-0 px-4 py-8 text-center text-[13px] text-dim">Nothing yet. Errors, failed posts and updates collect here.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col overflow-y-auto p-0">
            {notices.map((n) => (
              <li key={n.id} className={cn("group flex gap-3 border-b border-column-border px-4 py-3 last:border-b-0", !n.read && "bg-[#121216]")}>
                <ToneIcon tone={n.tone} className="mt-0.5 size-4 shrink-0" />
                <div className="flex min-w-0 grow flex-col gap-1">
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 grow text-[13px] font-medium text-strong">{n.title}</span>
                    <span className="shrink-0 text-[11px] text-dim">{ago(new Date(n.at))}</span>
                  </div>
                  {n.body && <span className="selectable break-words text-xs leading-normal text-muted-foreground">{n.body}</span>}
                  {n.actions && n.actions.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {n.actions.map((a) => (
                        <Button
                          key={a.label}
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            a.onClick();
                            remove(n.id);
                            setOpen(false);
                            markRead();
                          }}
                        >
                          {a.label}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  aria-label="Remove"
                  onClick={() => remove(n.id)}
                  className="-mr-1 grid size-6 shrink-0 place-items-center rounded text-dim opacity-0 hover:text-strong focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
