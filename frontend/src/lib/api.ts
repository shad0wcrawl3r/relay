// Single import point for the generated Wails bindings.
//
// The generator types every Go slice as `T[] | null`. The Go side always
// sends [], but the wrappers below normalise at the boundary anyway and the
// exported types drop the nulls, so the UI never has to guard.
import * as PlaneBindings from "../../bindings/github.com/shad0wcrawl3r/relay/planeservice";
import * as PostBindings from "../../bindings/github.com/shad0wcrawl3r/relay/postservice";
import * as SettingsBindings from "../../bindings/github.com/shad0wcrawl3r/relay/settingsservice";
import type * as M from "../../bindings/github.com/shad0wcrawl3r/relay/models";
import type * as PM from "../../bindings/github.com/shad0wcrawl3r/relay/internal/plane/models";
import type * as PostM from "../../bindings/github.com/shad0wcrawl3r/relay/internal/posts/models";

type Clean<T> = T extends (infer U)[] ? Clean<U>[] : T extends object ? { [K in keyof T]: Clean<Exclude<T[K], null>> } : T;

export type Snapshot = Clean<PM.Snapshot>;
export type Project = Clean<PM.Project>;
export type Item = Clean<PM.Item>;
export type ItemDetail = Clean<PM.ItemDetail>;
export type ItemPatch = Clean<PM.ItemPatch>;
export type NewItem = Clean<PM.NewItem>;
export type State = Clean<PM.State>;
export type Label = Clean<PM.Label>;
export type Module = Clean<PM.Module>;
export type Cycle = Clean<PM.Cycle>;
export type Comment = Clean<PM.Comment>;
export type Activity = Clean<PM.Activity>;
export type Member = Clean<PM.Member>;
export type PostSummary = Clean<M.PostSummary>;
export type PostList = Clean<M.PostList>;
export type Settings = Clean<M.Settings>;
export type SettingsInput = Clean<M.SettingsInput>;
export type Post = Clean<PostM.Post>;

const arr = <T,>(v: T[] | null | undefined): T[] => v ?? [];

const item = (it: PM.Item): Item => ({ ...it, labelIds: arr(it.labelIds), moduleIds: arr(it.moduleIds), cycleIds: arr(it.cycleIds) });

const snapshot = (s: PM.Snapshot): Snapshot => ({
  ...s,
  projects: arr(s.projects).map((p) => ({
    ...p,
    states: arr(p.states),
    labels: arr(p.labels),
    modules: arr(p.modules),
    cycles: arr(p.cycles),
    items: arr(p.items).map(item),
  })),
});

const post = (p: PostM.Post): Post => ({ ...p, tags: arr(p.tags) });
const postList = (l: M.PostList): PostList => ({ ...l, posts: arr(l.posts) });

export const PlaneService = {
  Snapshot: async () => snapshot(await PlaneBindings.Snapshot()),
  SyncNow: async () => snapshot(await PlaneBindings.SyncNow()),
  Connect: () => PlaneBindings.Connect(),
  Disconnect: () => PlaneBindings.Disconnect(),
  Detail: async (projectId: string, itemId: string): Promise<ItemDetail> => {
    const d = await PlaneBindings.Detail(projectId, itemId);
    return { ...item(d as unknown as PM.Item), descriptionHtml: d.descriptionHtml, comments: arr(d.comments), activity: arr(d.activity) } as ItemDetail;
  },
  Update: (projectId: string, itemId: string, patch: Partial<ItemPatch>) => PlaneBindings.Update(projectId, itemId, patch as PM.ItemPatch),
  Create: async (n: NewItem) => item(await PlaneBindings.Create(n as PM.NewItem)),
  Comment: (projectId: string, itemId: string, html: string) => PlaneBindings.Comment(projectId, itemId, html),
};

/** Normalise a snapshot pushed over the "plane:snapshot" event. */
export const normaliseSnapshot = (s: PM.Snapshot) => snapshot(s);

export const PostService = {
  List: async () => postList(await PostBindings.List()),
  Sync: async () => postList(await PostBindings.Sync()),
  Get: async (id: string) => post(await PostBindings.Get(id)),
  Create: async () => post(await PostBindings.Create()),
  Save: async (p: Post) => post(await PostBindings.Save(p as PostM.Post)),
  Delete: (id: string) => PostBindings.Delete(id),
  Send: async (id: string) => post(await PostBindings.Send(id)),
};

export const SettingsService = {
  Get: async (): Promise<Settings> => SettingsBindings.Get(),
  Save: async (s: SettingsInput): Promise<Settings> => SettingsBindings.Save(s as M.SettingsInput),
  ClearDevtoKey: async (): Promise<Settings> => SettingsBindings.ClearDevtoKey(),
};
