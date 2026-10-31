// Single import point for the generated Wails bindings.
//
// The generator types every Go slice as `T[] | null`. The Go side always
// sends [], but the wrappers below normalise at the boundary anyway and the
// exported types drop the nulls, so the UI never has to guard.
import * as AIBindings from "../../bindings/github.com/shad0wcrawl3r/relay/aiservice";
import * as BufferBindings from "../../bindings/github.com/shad0wcrawl3r/relay/bufferservice";
import * as LogBindings from "../../bindings/github.com/shad0wcrawl3r/relay/logservice";
import * as PlaneBindings from "../../bindings/github.com/shad0wcrawl3r/relay/planeservice";
import * as PostBindings from "../../bindings/github.com/shad0wcrawl3r/relay/postservice";
import * as SettingsBindings from "../../bindings/github.com/shad0wcrawl3r/relay/settingsservice";
import * as TerminalBindings from "../../bindings/github.com/shad0wcrawl3r/relay/terminalservice";
import type * as M from "../../bindings/github.com/shad0wcrawl3r/relay/models";
import type * as BufferM from "../../bindings/github.com/shad0wcrawl3r/relay/internal/buffer/models";
import type * as LogM from "../../bindings/github.com/shad0wcrawl3r/relay/internal/logs/models";
import type * as PM from "../../bindings/github.com/shad0wcrawl3r/relay/internal/plane/models";
import type * as PostM from "../../bindings/github.com/shad0wcrawl3r/relay/internal/posts/models";
import type * as TermM from "../../bindings/github.com/shad0wcrawl3r/relay/internal/term/models";
import type * as UnlockM from "../../bindings/github.com/shad0wcrawl3r/relay/internal/unlock/models";

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
export type TermInfo = Clean<TermM.Info>;
export type UnlockMethod = Clean<UnlockM.Method>;
export type TermOptions = Clean<TermM.Options>;
export type TermEndpoint = Clean<M.Endpoint>;
export type TermKeymap = Clean<TermM.Keymap>;
export type TermBinding = Clean<TermM.Binding>;

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

const post = (p: PostM.Post): Post => ({ ...p, tags: arr(p.tags), promotions: arr(p.promotions) });
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
  UnlockMethod: (): Promise<UnlockMethod> => PlaneBindings.UnlockMethod(),
  Unlock: (key: string) => PlaneBindings.Unlock(key),
  Lock: (key = "") => PlaneBindings.Lock(key),
  SetLockable: (key: string, locked: boolean) => PlaneBindings.SetLockable(key, locked),
};

/** Lock keys, matching internal/plane/locks.go. */
export const projectKey = (identifier: string) => `project:${identifier.toUpperCase()}`;
export const moduleKey = (id: string) => `module:${id}`;

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
  Publish: async (id: string) => post(await PostBindings.Publish(id)),
  Series: async (): Promise<string[]> => arr(await PostBindings.Series()),
};

export type LogEntry = Clean<LogM.Entry>;
export type LogStatus = Clean<M.LogStatus>;

const logStatus = (s: M.LogStatus): LogStatus => ({ ...s, subsystems: arr(s.subsystems) });

export const LogService = {
  Status: async () => logStatus(await LogBindings.Status()),
  SetEnabled: async (on: boolean) => logStatus(await LogBindings.SetEnabled(on)),
  SetLevel: async (subsystem: string, level: string) => logStatus(await LogBindings.SetLevel(subsystem, level)),
  Entries: async (after: number): Promise<LogEntry[]> => arr(await LogBindings.Entries(after)),
  Clear: () => LogBindings.Clear(),
};

export type BufferStatus = M.BufferStatus;
export type BufferChannel = Clean<BufferM.Channel>;
export type BufferTiming = "queue" | "schedule" | "draft";
export type AIStatus = Clean<M.AIStatus>;

export const BufferService = {
  Status: (): Promise<BufferStatus> => BufferBindings.Status(),
  Connect: () => BufferBindings.Connect(),
  Disconnect: () => BufferBindings.Disconnect(),
  Channels: async (): Promise<BufferChannel[]> => arr(await BufferBindings.Channels()),
  PreviewPromotion: (postId: string, text: string): Promise<string> => BufferBindings.PreviewPromotion(postId, text),
  Promote: async (p: { postId: string; channelId: string; channel: string; text: string; timing: BufferTiming; dueAt: string }) =>
    post(await BufferBindings.Promote(p as M.Promotion)),
};

const aiStatus = (s: M.AIStatus): AIStatus => ({ ...s, providers: arr(s.providers) });

export const AIService = {
  Status: async () => aiStatus(await AIBindings.Status()),
  Models: async (provider: string): Promise<string[]> => arr(await AIBindings.Models(provider)),
  SetKey: async (provider: string, key: string) => aiStatus(await AIBindings.SetKey(provider, key)),
  ClearKey: async (provider: string) => aiStatus(await AIBindings.ClearKey(provider)),
  SetEndpoint: async (provider: string, endpoint: string) => aiStatus(await AIBindings.SetEndpoint(provider, endpoint)),
  Select: async (provider: string, model: string) => aiStatus(await AIBindings.Select(provider, model)),
  SummarizePost: (id: string) => AIBindings.SummarizePost(id),
};

export const SettingsService = {
  Get: async (): Promise<Settings> => SettingsBindings.Get(),
  Save: async (s: SettingsInput): Promise<Settings> => SettingsBindings.Save(s as M.SettingsInput),
  ClearDevtoKey: async (): Promise<Settings> => SettingsBindings.ClearDevtoKey(),
};

export const normaliseSessions = (l: TermM.Info[] | null | undefined): TermInfo[] => arr(l);

export const TerminalService = {
  Endpoint: (): Promise<TermEndpoint> => TerminalBindings.Endpoint(),
  Create: (o: Partial<TermOptions>): Promise<TermInfo> =>
    TerminalBindings.Create({ name: "", shell: "", cwd: "", cols: 0, rows: 0, ...o }),
  List: async () => normaliseSessions(await TerminalBindings.List()),
  Kill: (id: string) => TerminalBindings.Kill(id),
  Resize: (id: string, cols: number, rows: number) => TerminalBindings.Resize(id, cols, rows),
  Rename: (id: string, name: string) => TerminalBindings.Rename(id, name),
  LoadLayout: () => TerminalBindings.LoadLayout(),
  SaveLayout: (layout: string) => TerminalBindings.SaveLayout(layout),
  Keymap: async (): Promise<TermKeymap> => {
    const k = await TerminalBindings.Keymap();
    return { ...k, bindings: arr(k.bindings), skipped: arr(k.skipped) };
  },
  TmuxConfig: () => TerminalBindings.TmuxConfig(),
};
