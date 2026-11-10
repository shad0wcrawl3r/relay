import { useEffect, useSyncExternalStore } from "react";
import { BufferService, type BufferIdea, type BufferIdeaGroup, type IdeaLink } from "./api";
import { errorMessage } from "./utils";

/**
 * Buffer ideas, shared by the Buffer tab and the Buffer column on Plane
 * boards, so an idea made in one shows in the other. Loaded on demand and
 * at most once a minute: Buffer's OAuth rate limit is tight.
 */
interface IdeasState {
  orgId: string;
  ideas: BufferIdea[];
  groups: BufferIdeaGroup[];
  links: Record<string, IdeaLink>;
  cursor: string;
  more: boolean;
  loading: boolean;
  error: string;
  loadedAt: number;
}

const FRESH_MS = 60_000;

let state: IdeasState = { orgId: "", ideas: [], groups: [], links: {}, cursor: "", more: false, loading: false, error: "", loadedAt: 0 };
const listeners = new Set<() => void>();
const set = (patch: Partial<IdeasState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
let inflight: Promise<void> | null = null;

/** Loads the first page for orgId, or the account's first organization. */
export function loadIdeas(orgId?: string, force = false): Promise<void> {
  const sameOrg = !orgId || orgId === state.orgId;
  if (!force && sameOrg && state.loadedAt && Date.now() - state.loadedAt < FRESH_MS) return Promise.resolve();
  if (inflight && sameOrg) return inflight;
  inflight = (async () => {
    set({ loading: true, error: "" });
    try {
      let org = orgId || state.orgId;
      if (!org) org = (await BufferService.Organizations())[0]?.id ?? "";
      if (!org) throw new Error("No Buffer organization found");
      if (org !== state.orgId || state.ideas.length === 0) {
        // The last copy, shown while the fresh one loads.
        const cached = await BufferService.CachedIdeas(org).catch(() => null);
        if (cached) set({ orgId: org, ideas: cached.ideas, groups: cached.groups, cursor: cached.cursor, more: cached.more });
      }
      const [page, links] = await Promise.all([BufferService.Ideas(org, ""), BufferService.IdeaLinks()]);
      set({ orgId: org, ideas: page.ideas, groups: page.groups, cursor: page.cursor, more: page.more, links, loadedAt: Date.now() });
    } catch (err) {
      set({ error: errorMessage(err) });
    } finally {
      set({ loading: false });
      inflight = null;
    }
  })();
  return inflight;
}

export async function loadMoreIdeas() {
  if (!state.more || state.loading) return;
  set({ loading: true });
  try {
    const page = await BufferService.Ideas(state.orgId, state.cursor);
    set({ ideas: [...state.ideas, ...page.ideas], cursor: page.cursor, more: page.more });
  } catch (err) {
    set({ error: errorMessage(err) });
  } finally {
    set({ loading: false });
  }
}

/** The organization the ideas were last loaded for, or "" before the first load. */
export const ideasOrg = () => state.orgId;

export function addIdea(i: BufferIdea, link?: IdeaLink) {
  set({ ideas: [i, ...state.ideas.filter((x) => x.id !== i.id)], links: link ? { ...state.links, [i.id]: link } : state.links });
}

export function addLink(link: IdeaLink) {
  set({ links: { ...state.links, [link.ideaId]: link } });
}

/** Subscribes to the ideas, loading them when first used and on window focus. */
export function useIdeas(enabled: boolean, orgId?: string): IdeasState {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
  useEffect(() => {
    if (!enabled) return;
    loadIdeas(orgId);
    const onFocus = () => loadIdeas(orgId);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [enabled, orgId]);
  return s;
}
