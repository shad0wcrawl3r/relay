import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export const placeholderToken = (desc: string) => `<INSERT IMAGE HERE: ${desc.replace(/[<>\n]/g, "").trim()}>`;

export function ImageDialog({ open, onOpenChange, onInsert }: { open: boolean; onOpenChange: (v: boolean) => void; onInsert: (token: string) => void }) {
  const [desc, setDesc] = useState("");
  useEffect(() => {
    if (open) setDesc("");
  }, [open]);
  const token = placeholderToken(desc || "…");
  const submit = () => {
    if (!desc.trim()) return;
    onInsert(placeholderToken(desc));
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-[18px]" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Insert image placeholder</DialogTitle>
          <DialogDescription>Describe the image. You'll swap it for the real one when you finish the draft on Dev.to.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-[18px]"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-2">
            <label htmlFor="img-desc" className="text-sm font-medium text-strong">
              Description
            </label>
            <Input id="img-desc" autoFocus className="h-10 text-sm" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="architecture diagram" />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[13px] text-muted-foreground">Inserts at cursor</span>
            <div className="rounded-md border border-border bg-[#0c0c0e] px-3 py-2.5 font-mono text-[13px]">
              <span className="break-all rounded px-1.5 py-px text-[#fbbf24] shadow-[0_0_0_1px_rgba(245,158,11,.32)]" style={{ background: "rgba(245,158,11,.12)" }}>
                {token}
              </span>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" size="lg" className="font-medium text-strong">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="lg" disabled={!desc.trim()}>
              Insert
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
