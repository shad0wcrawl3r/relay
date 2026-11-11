import { useEffect, useRef } from "react";
import { Events } from "@wailsio/runtime";
import type { FailedPost } from "@/lib/api";
import { useToast } from "@/components/Toaster";
import { serviceName } from "@/views/buffer/Buffer";
import type { BufferFocus } from "@/views/buffer/Buffer";

/**
 * Tells the user when Buffer couldn't publish a post. Go checks at launch
 * and every 15 minutes, and only sends posts it hasn't reported yet.
 */
export function FailedPostNotifier({ goBuffer }: { goBuffer: (focus: BufferFocus) => void }) {
  const toast = useToast();
  const go = useRef(goBuffer);
  go.current = goBuffer;

  useEffect(
    () =>
      Events.On("buffer:failed", (ev) => {
        const found = (ev.data as { new?: FailedPost[] | null } | undefined)?.new ?? [];
        if (found.length === 0) return;
        const first = found[0];
        const where = serviceName(first.channelService) || "A channel";
        toast(
          {
            tone: "error",
            keep: true,
            title: found.length === 1 ? `A Buffer post didn't go out` : `${found.length} Buffer posts didn't go out`,
            body: found.length === 1 ? `${where}: ${first.error || "Buffer gave no reason."}` : `The first, on ${where}: ${first.error || "no reason given."}`,
            actions: [{ label: "Show failed posts", primary: true, onClick: () => go.current({ postId: first.id, status: "error" }) }],
          },
          20_000,
        );
      }),
    [toast],
  );
  return null;
}
