import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function PublishDialog({
  open,
  onOpenChange,
  onPublish,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPublish: () => Promise<void>;
}) {
  const [publishing, setPublishing] = useState(false);
  const publish = async () => {
    setPublishing(true);
    try {
      await onPublish();
    } finally {
      setPublishing(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-[18px]" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Publish on Dev.to?</DialogTitle>
          <DialogDescription>
            This makes the article public right away, exactly as it stands on Dev.to. Use Update draft first if you have changes in Relay you want included.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="md" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="md" disabled={publishing} onClick={publish}>
            {publishing && <Loader2 className="size-3.5 animate-spin" />}
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
