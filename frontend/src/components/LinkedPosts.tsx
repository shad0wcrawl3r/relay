import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { PostService, type PostList } from "@/lib/api";
import { postStep } from "@/views/editor/PostSteps";

// The posts linked to a Plane item (RELAY-71), with where each one is:
// local, a Dev.to draft, published or promoted. Read from Relay's own post
// list, which needs no network call when it's already loaded.

const STEP = ["Local draft", "Draft on Dev.to", "Published", "Promoted"];
const COLOR = ["#a1a1aa", "#60a5fa", "#4ade80", "#c4b5fd"];

export function LinkedPosts({ itemId, openPost }: { itemId: string; openPost: (postId: string) => void }) {
  const [list, setList] = useState<PostList | null>(null);
  useEffect(() => {
    PostService.List().then(setList, () => setList(null));
  }, [itemId]);
  const linked = (list?.posts ?? []).filter((p) => p.local && p.planeItems.some((l) => l.itemId === itemId));
  if (linked.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">Posts</span>
      {linked.map((p) => {
        const step = p.gone ? -1 : postStep(p.devtoId !== 0, p.published, p.promotions);
        return (
          <button
            key={p.id}
            onClick={() => openPost(p.id)}
            className="flex items-center gap-2 rounded-md border border-column-border px-2.5 py-1.5 text-left text-[13px] hover:bg-[#121215]"
          >
            <FileText className="size-3.5 shrink-0 text-dim" />
            <span className="min-w-0 grow truncate text-[#e4e4e7]">{p.title || "Untitled post"}</span>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-dim">
              <span aria-hidden className="size-1.5 rounded-full" style={{ background: step < 0 ? "#f87171" : COLOR[step] }} />
              {step < 0 ? "Gone from Dev.to" : STEP[step]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
