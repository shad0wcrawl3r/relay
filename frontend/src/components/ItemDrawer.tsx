import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Browser } from "@wailsio/runtime";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { Bot, ChevronDown, ChevronUp, ExternalLink, Loader2, X } from "lucide-react";
import type { Activity, Comment, ItemDetail, Project } from "@/lib/api";
import { PlaneService } from "@/lib/api";
import { usePlane } from "@/lib/store";
import { findState, isOverdue, norm, planeURL, PRIORITIES, priorityLabel, stateById, stateColor } from "@/lib/plane";
import { ago, isoDate, shortDate } from "@/lib/time";
import { cn, errorMessage } from "@/lib/utils";
import { Dot, ExperimentalBadge, Kbd, PriorityIcon, PrivateLock, ProjectGlyph } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DueChip } from "@/components/Reschedule";
import { LinkedPosts } from "@/components/LinkedPosts";
import { shelveState } from "@/views/Attention";

/** Sanitise Plane HTML and promote "Verdict · …" lines to the verdict pill. */
function renderHTML(html: string): string {
  const clean = DOMPurify.sanitize(html || "", { USE_PROFILES: { html: true } });
  const doc = new DOMParser().parseFromString(`<div>${clean}</div>`, "text/html");
  doc.querySelectorAll("p, li, strong").forEach((el) => {
    if (/^\s*verdict\b/i.test(el.textContent ?? "") && (el.textContent ?? "").length < 80) el.classList.add("verdict");
  });
  doc.querySelectorAll("a").forEach((a) => a.setAttribute("data-external", "1"));
  return doc.body.firstElementChild?.innerHTML ?? "";
}

function openLinks(e: React.MouseEvent) {
  const a = (e.target as HTMLElement).closest("a");
  if (a?.href) {
    e.preventDefault();
    Browser.OpenURL(a.href);
  }
}

const markdownToHTML = (md: string) => DOMPurify.sanitize(marked.parse(md, { async: false, gfm: true, breaks: true }) as string);

interface Props {
  project: Project;
  itemId: string;
  siblings: string[];
  focusComposer?: boolean;
  onNavigate: (itemId: string) => void;
  onClose: () => void;
  /** Opens a linked post in the editor. */
  openPost?: (postId: string) => void;
}

export function ItemDrawer({ project, itemId, siblings, focusComposer, onNavigate, onClose, openPost }: Props) {
  const { update, comment, snapshot } = usePlane();
  const item = project.items.find((i) => i.id === itemId);
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<"comments" | "activity">("comments");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(() => {
    setLoadError("");
    PlaneService.Detail(project.id, itemId)
      .then(setDetail)
      .catch((err) => setLoadError(errorMessage(err)));
  }, [project.id, itemId]);

  useEffect(() => {
    setDetail(null);
    setDraft("");
    load();
  }, [load]);

  // Refresh the thread when a sync shows the item changed underneath us.
  useEffect(() => {
    if (detail && item && item.updatedAt !== detail.updatedAt) load();
  }, [item?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (focusComposer) setTimeout(() => composer.current?.focus(), 50);
  }, [focusComposer, itemId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[data-radix-popper-content-wrapper]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const idx = siblings.indexOf(itemId);
  const byState = stateById(project);
  const state = item ? byState.get(item.stateId) : undefined;
  const n = norm(state?.name);
  const labels = project.labels.filter((l) => item?.labelIds?.includes(l.id));
  const modules = project.modules.filter((m) => item?.moduleIds?.includes(m.id));
  const agentName = detail?.comments.find((c) => c.agent)?.author.name;
  const comments = detail?.comments ?? [];
  // Cards on the Buffer planning board have no priority, comments or activity.
  const fromBuffer = project.source === "buffer";

  const send = async (then?: { stateId: string; message: string }) => {
    if (!item) return;
    const text = draft.trim();
    if (!text && !then) return;
    setSending(true);
    let ok = true;
    if (text) ok = await comment(item, markdownToHTML(text));
    if (ok && then) ok = await update(item, { stateId: then.stateId }, then.message);
    setSending(false);
    if (ok) {
      setDraft("");
      load();
    }
  };

  const contextActions = useMemo(() => {
    if (!item) return [];
    const acts: { label: string; variant: "outline" | "teal"; stateId: string; message: string }[] = [];
    if (n === "needs review" && !project.private) {
      const back = findState(project, "Ready for Agent");
      const done = findState(project, "Done") ?? project.states.find((s) => s.group === "completed");
      if (back) acts.push({ label: "Send back", variant: "outline", stateId: back.id, message: `${item.key} sent back to the agent` });
      if (done) acts.push({ label: "Done", variant: "teal", stateId: done.id, message: `${item.key} marked done` });
    } else if (n === "in debate" || n === "idea") {
      const shelve = shelveState(project);
      const approve = findState(project, "Approved");
      if (shelve) acts.push({ label: "Shelve", variant: "outline", stateId: shelve.id, message: `${item.key} shelved` });
      if (approve) acts.push({ label: "Approve", variant: "teal", stateId: approve.id, message: `${item.key} approved` });
    }
    return acts;
  }, [item, n, project]);

  if (!item) return null;

  return (
    <>
      <div className="fixed inset-0 z-30 bg-[rgba(4,4,6,.5)]" aria-hidden="true" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        className="fixed bottom-0 right-0 top-0 z-40 flex w-[min(580px,100%)] flex-col border-l border-card-border bg-[#0f0f12] shadow-[-24px_0_60px_rgba(0,0,0,.45)]"
      >
        <div className="drag flex h-[52px] shrink-0 items-center gap-2 border-b border-hairline pl-5 pr-3">
          <ProjectGlyph project={project} />
          <span className="font-mono text-xs text-muted-foreground">{item.key}</span>
          {fromBuffer && <ExperimentalBadge />}
          {project.private && <PrivateLock size={12} color="#5eead4" />}
          <span className="flex-1" />
          <div className="no-drag flex items-center gap-0.5">
            <IconBtn label="Previous item" disabled={idx <= 0} onClick={() => onNavigate(siblings[idx - 1])}>
              <ChevronUp className="size-3.5" strokeWidth={2} />
            </IconBtn>
            <IconBtn label="Next item" disabled={idx < 0 || idx >= siblings.length - 1} onClick={() => onNavigate(siblings[idx + 1])}>
              <ChevronDown className="size-3.5" strokeWidth={2} />
            </IconBtn>
            {!fromBuffer && (
              <IconBtn label="Open in Plane" onClick={() => snapshot && Browser.OpenURL(planeURL(snapshot.appUrl, snapshot.workspace, item))}>
                <ExternalLink className="size-3.5" strokeWidth={1.8} />
              </IconBtn>
            )}
            <IconBtn label="Close" onClick={onClose}>
              <X className="size-[15px]" strokeWidth={2} />
            </IconBtn>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 pb-4 pt-5">
          <EditableTitle key={item.id} value={item.name} onSave={(name) => update(item, { name })} />

          <dl className="m-0 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-xs">
            <dt className="flex min-h-[26px] items-center text-dim">State</dt>
            <dd className="m-0 flex min-h-[26px] items-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="inline-flex h-[26px] items-center gap-1.5 rounded-md border border-[#2a2a30] bg-[#141417] px-[9px] text-xs text-[#f4f4f5] hover:border-border-strong">
                    <Dot color={stateColor(state)} size={7} />
                    {state?.name ?? "—"}
                    <ChevronDown className="size-[11px]" strokeWidth={2} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {project.states.map((s) => (
                    <DropdownMenuItem key={s.id} onSelect={() => s.id !== item.stateId && update(item, { stateId: s.id })}>
                      <Dot color={stateColor(s)} size={7} />
                      {s.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </dd>

            {!fromBuffer && (
              <>
            <dt className="flex min-h-[26px] items-center text-dim">Priority</dt>
            <dd className="m-0 flex min-h-[26px] items-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="inline-flex h-[26px] items-center gap-1.5 rounded-md border border-[#2a2a30] bg-[#141417] px-[9px] text-xs text-[#f4f4f5] hover:border-border-strong">
                    <PriorityIcon priority={item.priority} />
                    {priorityLabel(item.priority)}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {PRIORITIES.map((p) => (
                    <DropdownMenuItem key={p} onSelect={() => p !== item.priority && update(item, { priority: p })}>
                      <span className="grid w-4 place-items-center">
                        <PriorityIcon priority={p} />
                      </span>
                      {priorityLabel(p)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </dd>
              </>
            )}

            <dt className="flex min-h-[26px] items-center text-dim">Labels</dt>
            <dd className="m-0 flex min-h-[26px] flex-wrap items-center gap-1.5">
              {labels.map((l) => (
                <span key={l.id} className="inline-flex h-[22px] items-center gap-[5px] rounded-full border border-[#2a2a30] px-2 text-[11px] text-[#b4b4bc]">
                  <Dot color={l.color || "#71717a"} size={6} />
                  {l.name}
                </span>
              ))}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button aria-label="Edit labels" className="inline-flex h-[26px] items-center rounded-md border border-[#2a2a30] bg-[#141417] px-[9px] text-xs text-[#f4f4f5] hover:border-border-strong">
                    +
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[200px]">
                  {project.labels.length === 0 && <div className="px-2 py-1.5 text-xs text-dim">No labels in this project</div>}
                  {project.labels.map((l) => {
                    const on = item.labelIds?.includes(l.id) ?? false;
                    return (
                      <DropdownMenuCheckboxItem
                        key={l.id}
                        checked={on}
                        onSelect={(e) => e.preventDefault()}
                        onCheckedChange={() =>
                          update(item, { labelIds: on ? item.labelIds.filter((x) => x !== l.id) : [...(item.labelIds ?? []), l.id] })
                        }
                      >
                        <Dot color={l.color || "#71717a"} size={6} />
                        {l.name}
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </dd>

            <dt className="flex min-h-[26px] items-center text-dim">Due</dt>
            <dd className="m-0 flex min-h-[26px] items-center">
              <DueChip
                current={item.targetDate}
                overdue={isOverdue(item, state)}
                onPick={(d) => update(item, { targetDate: d ? isoDate(d) : "" })}
              />
            </dd>

            {modules.length > 0 && (
              <>
                <dt className="flex min-h-[26px] items-center text-dim">Module</dt>
                <dd className="m-0 flex min-h-[26px] items-center text-[#e4e4e7]">{modules.map((m) => m.name).join(", ")}</dd>
              </>
            )}

            <dt className="flex min-h-[26px] items-center text-dim">Created</dt>
            <dd className="m-0 flex min-h-[26px] items-center text-[#e4e4e7]">
              {shortDate(item.createdAt)}
              {item.createdBy && ` · ${item.createdBy}`}
            </dd>

            {(item.agent || agentName) && (
              <>
                <dt className="flex min-h-[26px] items-center text-dim">Picked up by</dt>
                <dd className="m-0 flex min-h-[26px] items-center gap-1.5 text-agent">
                  <Bot className="size-[13px]" strokeWidth={2} />
                  {agentName ?? "Agent"}
                </dd>
              </>
            )}
          </dl>

          <div>
            <p className="mb-2 mt-0 text-[11px] font-medium uppercase tracking-[.06em] text-dim">Description</p>
            {detail ? (
              detail.descriptionHtml && detail.descriptionHtml.replace(/<[^>]+>/g, "").trim() ? (
                <div className="prose-relay text-[13.5px]" onClick={openLinks} dangerouslySetInnerHTML={{ __html: renderHTML(detail.descriptionHtml) }} />
              ) : (
                <p className="m-0 text-[13px] text-dim">No description.</p>
              )
            ) : loadError ? (
              <p className="m-0 text-[13px] text-overdue">
                {loadError}{" "}
                <button className="underline" onClick={load}>
                  Retry
                </button>
              </p>
            ) : (
              <Loader2 className="size-4 animate-spin text-dim" />
            )}
          </div>

          {!fromBuffer && !project.private && openPost && <LinkedPosts itemId={itemId} openPost={openPost} />}

          {fromBuffer ? (
            <p className="m-0 text-xs text-dim">
              This card is a Buffer content item. Move it between Idea, Todo, In Progress and Ready here; once it has posts in Buffer it
              follows them to Scheduled and Published.
            </p>
          ) : (
            <>
          <div className="flex gap-[18px] border-b border-hairline" role="tablist">
            {(["comments", "activity"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn("-mb-px h-[34px] border-b-2 border-transparent text-[13px] text-dim", tab === t && "border-strong text-strong")}
              >
                {t === "comments" ? `Comments${detail ? ` ${comments.length}` : ""}` : "Activity"}
              </button>
            ))}
          </div>

          {tab === "comments" ? (
            <div className="flex flex-col gap-[18px]">
              {detail && comments.length === 0 && <p className="m-0 text-[13px] text-dim">No comments yet.</p>}
              {comments.map((c) => (
                <CommentView key={c.id} c={c} />
              ))}
            </div>
          ) : (
            <ActivityList activity={detail?.activity ?? []} project={project} />
          )}
            </>
          )}
        </div>

        {!fromBuffer && (
        <div className="flex flex-col gap-2.5 border-t border-hairline bg-[#0c0c0f] px-5 pb-4 pt-3.5">
          <label className="sr-only" htmlFor="reply">
            Reply
          </label>
          <textarea
            id="reply"
            ref={composer}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={n === "in debate" ? "Reply to the debate…  (markdown)" : "Leave a comment…  (markdown)"}
            className="min-h-[76px] w-full resize-none rounded-lg border border-[#2a2a30] bg-[#121215] px-3 py-2.5 text-[13px] leading-normal text-[#e4e4e7] outline-none placeholder:text-dim focus:border-[#52525b]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-[11px] text-dim">
              <Kbd>⌘↵</Kbd> to send
            </span>
            {contextActions.map((a) => (
              <Button key={a.label} variant={a.variant} disabled={sending} onClick={() => send({ stateId: a.stateId, message: a.message })}>
                {a.label}
              </Button>
            ))}
            <Button disabled={sending || !draft.trim()} onClick={() => send()}>
              {sending && <Loader2 className="size-3 animate-spin" />}
              Comment
            </Button>
          </div>
        </div>
        )}
      </aside>
    </>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-[30px] place-items-center rounded-md text-muted-foreground hover:bg-[#1c1c20] hover:text-strong disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function EditableTitle({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    const t = v.trim();
    if (t && t !== value) onSave(t);
    else setV(value);
  };
  return (
    <textarea
      id="drawer-title"
      aria-label="Title"
      rows={1}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          setV(value);
          e.stopPropagation();
          e.currentTarget.blur();
        }
      }}
      ref={(el) => {
        if (el) {
          el.style.height = "auto";
          el.style.height = `${el.scrollHeight}px`;
        }
      }}
      className="m-0 w-full resize-none overflow-hidden rounded-md bg-transparent text-xl font-semibold leading-[1.3] tracking-[-.01em] text-strong outline-none focus:bg-[#141417]"
    />
  );
}

function CommentView({ c }: { c: Comment }) {
  return (
    <div className="flex gap-3">
      {c.agent ? (
        <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-agent-bg text-agent">
          <Bot className="size-3.5" strokeWidth={2} />
        </span>
      ) : (
        <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-[#27272a] text-xs font-semibold text-[#f4f4f5]">
          {c.author.name.charAt(0).toUpperCase()}
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2 text-xs">
          <b className="font-semibold text-[#f4f4f5]">{c.author.name}</b>
          {c.agent && <span className="inline-flex h-4 items-center rounded border border-agent-border px-[5px] text-[10px] text-agent">agent</span>}
          <span className="text-dim">{ago(c.createdAt)}</span>
        </div>
        <div
          className="prose-relay comment-bubble rounded-[10px] border border-[#222227] bg-[#141417] px-3.5 py-3 text-[13px] leading-[1.55]"
          onClick={openLinks}
          dangerouslySetInnerHTML={{ __html: renderHTML(c.html) }}
        />
      </div>
    </div>
  );
}

function ActivityList({ activity, project }: { activity: Activity[]; project: Project }) {
  if (activity.length === 0) return <p className="m-0 text-[13px] text-dim">No activity yet.</p>;
  const describe = (a: Activity) => {
    if (a.verb === "created") return "created the item";
    if (!a.field) return a.verb;
    if (a.field === "state") {
      const to = findState(project, a.newValue);
      return (
        <>
          moved it to <Dot color={stateColor(to)} size={6} className="mx-0.5 inline-block" /> <b className="font-medium text-[#e4e4e7]">{a.newValue}</b>
        </>
      );
    }
    if (a.newValue) return `set ${a.field.replace(/_/g, " ")} to ${a.newValue}`;
    if (a.oldValue) return `removed ${a.field.replace(/_/g, " ")} ${a.oldValue}`;
    return `updated ${a.field.replace(/_/g, " ")}`;
  };
  return (
    <ol className="m-0 flex list-none flex-col gap-3 p-0">
      {activity.map((a) => (
        <li key={a.id} className="flex items-baseline gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-[#e4e4e7]">{a.actor.name}</span>
          <span className="min-w-0 flex-1">{describe(a)}</span>
          <span className="shrink-0 text-dim">{ago(a.createdAt)}</span>
        </li>
      ))}
    </ol>
  );
}
