import { useState } from "react";
import { Browser } from "@wailsio/runtime";
import { EyeOff, Loader2, MoreHorizontal, Trash2, Unlink } from "lucide-react";
import { BufferService, PostService, type Post } from "@/lib/api";
import { errorMessage } from "@/lib/utils";
import { useToast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

// Managing an article that's on Dev.to: unpublish it, delete it there, or
// make the post local again. Forem's API can unpublish but can't delete, so
// deleting unpublishes from Relay and finishes on Dev.to's delete page.
// Every step is a confirmed user action.

type Dialogs = "unpublish" | "delete" | null;

export function ManagePost({
  post,
  published,
  onChanged,
  onDeleteLocal,
}: {
  post: Post;
  published: boolean;
  /** Called with the post after Relay changed it; refreshes the list too. */
  onChanged: (p: Post) => void;
  onDeleteLocal: () => void;
}) {
  const [open, setOpen] = useState<Dialogs>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Manage on Dev.to" title="Manage on Dev.to" className="size-9">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[240px]">
          {published && (
            <DropdownMenuItem onSelect={() => setOpen("unpublish")}>
              <EyeOff className="size-3.5" /> Unpublish…
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setOpen("delete")} className="text-overdue">
            <Trash2 className="size-3.5" /> Delete from Dev.to…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onDeleteLocal}>
            <Trash2 className="size-3.5" /> Delete Relay's copy
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <UnpublishDialog open={open === "unpublish"} post={post} onClose={() => setOpen(null)} onDone={onChanged} />
      <DeleteDialog open={open === "delete"} post={post} published={published} onClose={() => setOpen(null)} onDone={onChanged} />
    </>
  );
}

function PromotionsSwitch({ post, on, onChange }: { post: Post; on: boolean; onChange: (v: boolean) => void }) {
  if (post.promotions.length === 0) return null;
  return (
    <label className="flex items-start gap-2.5 rounded-md border border-border bg-[#0f0f11] p-3 text-[13px] text-foreground">
      <Switch checked={on} onCheckedChange={onChange} className="mt-0.5" />
      <span className="flex flex-col gap-0.5">
        Remove its promotions that haven't gone out
        <span className="text-xs text-dim">Scheduled, awaiting approval and draft posts in Buffer, so none goes out linking to it. Sent posts stay.</span>
      </span>
    </label>
  );
}

/** Removes pending promotions; a failure is reported but doesn't undo the Dev.to step. */
async function removePromotions(postId: string, toast: ReturnType<typeof useToast>) {
  try {
    return await BufferService.RemoveScheduledPromotions(postId);
  } catch (err) {
    toast({ tone: "error", title: "Couldn't remove the promotions from Buffer", body: `${errorMessage(err)} Check the Buffer tab: they may still go out.` });
    return -1;
  }
}

function UnpublishDialog({ open, post, onClose, onDone }: { open: boolean; post: Post; onClose: () => void; onDone: (p: Post) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [promos, setPromos] = useState(true);
  const run = async () => {
    setBusy(true);
    try {
      const p = await PostService.Unpublish(post.id);
      const removed = promos && post.promotions.length > 0 ? await removePromotions(post.id, toast) : 0;
      onDone(p);
      onClose();
      toast({
        tone: "success",
        title: "Unpublished on Dev.to",
        body: `It's a draft again, out of feeds and search.${removed > 0 ? ` Removed ${removed} scheduled promotion${removed === 1 ? "" : "s"} from Buffer.` : ""}`,
        keep: true,
      });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't unpublish", body: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="flex flex-col gap-[18px]" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Unpublish “{post.title || "Untitled post"}”?</DialogTitle>
          <DialogDescription>
            Dev.to turns it back into a draft: it leaves feeds and search, and its link stops working for readers. Comments are kept. You can publish it again later.
          </DialogDescription>
        </DialogHeader>
        <PromotionsSwitch post={post} on={promos} onChange={setPromos} />
        <DialogFooter>
          <Button variant="outline" size="md" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" size="md" disabled={busy} onClick={run}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Unpublish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ open, post, published, onClose, onDone }: { open: boolean; post: Post; published: boolean; onClose: () => void; onDone: (p: Post) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [promos, setPromos] = useState(true);
  const run = async () => {
    setBusy(true);
    try {
      let p = post;
      // Off the public site first, so it's gone for readers even if the
      // last step on Dev.to doesn't happen.
      if (published) p = await PostService.Unpublish(post.id);
      if (promos && post.promotions.length > 0) await removePromotions(post.id, toast);
      const link = await PostService.DeleteURL(post.id);
      Browser.OpenURL(link);
      onDone(p);
      onClose();
      toast(
        {
          tone: "info",
          title: "Confirm the delete on Dev.to",
          body: `${published ? "Relay unpublished it. " : ""}Dev.to's delete page is open in your browser. Once it's deleted there, Relay offers to keep this post as a local draft.`,
          actions: [{ label: "Open the page again", onClick: () => Browser.OpenURL(link) }],
          keep: true,
        },
        15_000,
      );
    } catch (err) {
      toast({ tone: "error", title: "Couldn't start the delete", body: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="flex flex-col gap-[18px]" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Delete “{post.title || "Untitled post"}” from Dev.to?</DialogTitle>
          <DialogDescription>Dev.to's API can't delete articles, so this takes two steps:</DialogDescription>
        </DialogHeader>
        <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-[13px] text-muted-foreground">
          {published && <li>Relay unpublishes it now, so readers can't see it.</li>}
          <li>Relay opens Dev.to's delete page in your browser; confirm there. Deleting removes it and its comments for good.</li>
        </ol>
        <p className="m-0 text-xs text-dim">Relay's copy stays. Once Dev.to no longer lists the article, the editor offers to keep it as a local draft or delete it.</p>
        <PromotionsSwitch post={post} on={promos} onChange={setPromos} />
        <DialogFooter>
          <Button variant="outline" size="md" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" size="md" disabled={busy} onClick={run}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {published ? "Unpublish and open Dev.to" : "Open Dev.to's delete page"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Shown when a post's article is no longer on Dev.to (deleted there). */
export function GoneBanner({ post, onChanged, onDeleteLocal }: { post: Post; onChanged: (p: Post) => void; onDeleteLocal: () => void }) {
  const toast = useToast();
  const unlink = async () => {
    try {
      onChanged(await PostService.Unlink(post.id));
      toast({ tone: "success", title: "Kept as a local draft", body: "Send it again to make a new Dev.to draft." });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't change the post", body: errorMessage(err) });
    }
  };
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-[rgba(248,113,113,.25)] bg-[rgba(248,113,113,.06)] px-6 py-2 text-[13px] text-[#fca5a5]">
      <Unlink className="size-3.5 shrink-0" />
      <span className="grow">
        Dev.to no longer has this article; it was probably deleted there.
        {post.promotions.length > 0 && " Keeping it as a local draft also forgets its promotion records, since they link to the deleted article."}
      </span>
      <Button variant="outline" size="sm" onClick={unlink}>
        Keep as a local draft
      </Button>
      <Button variant="ghost" size="sm" onClick={onDeleteLocal}>
        Delete Relay's copy
      </Button>
    </div>
  );
}
