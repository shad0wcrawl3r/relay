// Single import point for the generated Wails bindings.
//
// The generator types every Go slice as `T[] | null`. The Go side always
// sends [], but the wrappers below normalise at the boundary anyway and the
// exported types drop the nulls, so the UI never has to guard.
import * as AIBindings from "../../bindings/github.com/shad0wcrawl3r/relay/aiservice";
import * as BufferBindings from "../../bindings/github.com/shad0wcrawl3r/relay/bufferservice";
import * as GuideBindings from "../../bindings/github.com/shad0wcrawl3r/relay/guideservice";
import * as LogBindings from "../../bindings/github.com/shad0wcrawl3r/relay/logservice";
import * as PlaneBindings from "../../bindings/github.com/shad0wcrawl3r/relay/planeservice";
import * as PostBindings from "../../bindings/github.com/shad0wcrawl3r/relay/postservice";
import * as SettingsBindings from "../../bindings/github.com/shad0wcrawl3r/relay/settingsservice";
import * as TerminalBindings from "../../bindings/github.com/shad0wcrawl3r/relay/terminalservice";
import * as UpdateBindings from "../../bindings/github.com/shad0wcrawl3r/relay/updateservice";
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
/** Dev.to's copy of a post next to Relay's, when it was edited on Dev.to. */
export type Drift = Clean<M.Drift>;
export type TermInfo = Clean<TermM.Info>;
export type UnlockMethod = Clean<UnlockM.Method>;
export type TermOptions = Clean<TermM.Options>;
export type TermEndpoint = Clean<M.Endpoint>;
export type TermKeymap = Clean<TermM.Keymap>;
export type TermBinding = Clean<TermM.Binding>;
export type Shell = Clean<TermM.Shell>;
export type ShellChoice = Clean<M.ShellChoice>;
export type ExportResult = Clean<M.ExportResult>;
export type ImportResult = Clean<M.ImportResult>;

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
  SetProjectOrder: (identifiers: string[]) => PlaneBindings.SetProjectOrder(identifiers),
  SetProjectColor: (identifier: string, color: string) => PlaneBindings.SetProjectColor(identifier, color),
  SetCaptureProject: (identifier: string) => PlaneBindings.SetCaptureProject(identifier),
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
  /** Sends the post. An update that finds edits made on Dev.to sends nothing
   *  and returns the drift instead, unless overwrite is set. */
  Send: async (id: string, overwrite = false): Promise<{ post: Post; drift: Drift | null }> => {
    const r = await PostBindings.Send(id, overwrite);
    return { post: post(r.post), drift: r.drift ?? null };
  },
  Drift: async (id: string): Promise<Drift | null> => (await PostBindings.Drift(id)) ?? null,
  PullDevto: async (id: string) => post(await PostBindings.PullDevto(id)),
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
export type BufferOverview = Clean<M.BufferOverview>;
export type BufferOrganization = Clean<BufferM.Organization>;
export type BufferPost = Clean<BufferM.Post>;
export type BufferPostPage = Clean<BufferM.PostPage>;
export type BufferIdea = Clean<BufferM.Idea>;
export type BufferIdeaGroup = Clean<BufferM.IdeaGroup>;
export type BufferIdeaPage = Clean<BufferM.IdeaPage>;
export type IdeaLink = Clean<M.IdeaLink>;
export type BufferPostStatus = "scheduled" | "needs_approval" | "draft" | "sent" | "error" | "sending";

const channel = (c: BufferM.Channel): BufferChannel =>
  ({ ...c, postingSchedule: arr(c.postingSchedule).map((d) => ({ ...d, times: arr(d.times) })) }) as BufferChannel;
const bufferPost = (p: BufferM.Post): BufferPost => ({ ...p, actions: arr(p.actions), tags: arr(p.tags), images: arr(p.images) });
const idea = (i: BufferM.Idea): BufferIdea => ({ ...i, services: arr(i.services) });
export type BufferTiming = "queue" | "schedule" | "draft";
export type AIStatus = Clean<M.AIStatus>;
export type ModelTest = Clean<M.ModelTest>;
export type UpdateInfo = Clean<M.UpdateInfo>;
export type UpdateStatus = Clean<M.UpdateStatus>;

export const BufferService = {
  Status: (): Promise<BufferStatus> => BufferBindings.Status(),
  Connect: () => BufferBindings.Connect(),
  Disconnect: () => BufferBindings.Disconnect(),
  Channels: async (): Promise<BufferChannel[]> => arr(await BufferBindings.Channels()).map(channel),
  Overview: async (): Promise<BufferOverview> => {
    const o = await BufferBindings.Overview();
    return { ...o, organizations: arr(o.organizations), channels: arr(o.channels).map(channel) } as BufferOverview;
  },
  Posts: async (q: { organizationId: string; statuses: BufferPostStatus[]; channelIds: string[]; after: string }): Promise<BufferPostPage> => {
    const p = await BufferBindings.Posts(q);
    return { ...p, posts: arr(p.posts).map(bufferPost) };
  },
  DeletePost: (id: string) => BufferBindings.DeletePost(id),
  /** dueAt is an ISO time, or "" to keep the current schedule. */
  EditPost: async (id: string, text: string, dueAt: string): Promise<BufferPost> =>
    bufferPost(await BufferBindings.EditPost({ id, text, dueAt: dueAt || "0001-01-01T00:00:00Z" } as BufferM.PostEdit)),
  Ideas: async (orgId: string, after = ""): Promise<BufferIdeaPage> => {
    const p = await BufferBindings.Ideas(orgId, after);
    return { ...p, ideas: arr(p.ideas).map(idea), groups: arr(p.groups) };
  },
  CreateIdea: async (n: { organizationId: string; groupId: string; title: string; text: string }): Promise<BufferIdea> =>
    idea(await BufferBindings.CreateIdea(n)),
  Organizations: async (): Promise<BufferOrganization[]> => arr(await BufferBindings.Organizations()),
  IdeaLinks: async (): Promise<Record<string, IdeaLink>> => {
    const m = (await BufferBindings.IdeaLinks()) ?? {};
    return Object.fromEntries(Object.entries(m).filter((e): e is [string, IdeaLink] => !!e[1]));
  },
  ItemToIdea: async (orgId: string, projectId: string, itemId: string): Promise<BufferIdea> =>
    idea(await BufferBindings.ItemToIdea(orgId, projectId, itemId)),
  IdeaToItem: async (n: { ideaId: string; title: string; text: string; projectId: string; stateId: string }): Promise<Item> =>
    item(await BufferBindings.IdeaToItem(n)),
  PreviewPromotion: (postId: string, text: string): Promise<string> => BufferBindings.PreviewPromotion(postId, text),
  // The note dev builds add to every post, or "" in release builds.
  EvalNote: (): Promise<string> => BufferBindings.EvalNote(),
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
  SetPrivate: async (provider: string, isPrivate: boolean) => aiStatus(await AIBindings.SetPrivate(provider, isPrivate)),
  TestModel: (provider: string, model: string): Promise<ModelTest> => AIBindings.TestModel(provider, model),
  SummarizePost: (id: string) => AIBindings.SummarizePost(id),
  SummarizeText: (title: string, text: string) => AIBindings.SummarizeText(title, text),
};

export const SettingsService = {
  Get: async (): Promise<Settings> => SettingsBindings.Get(),
  Save: async (s: SettingsInput): Promise<Settings> => SettingsBindings.Save(s as M.SettingsInput),
  ClearDevtoKey: async (): Promise<Settings> => SettingsBindings.ClearDevtoKey(),
  ClearAllData: (): Promise<void> => SettingsBindings.ClearAllData(),
  Integrations: (): Promise<M.Integrations> => SettingsBindings.Integrations(),
  SavePlaneApp: async (clientId: string, secret: string, workspace: string): Promise<Settings> =>
    SettingsBindings.SavePlaneApp(clientId, secret, workspace),
  SaveDevtoKey: async (key: string): Promise<Settings> => SettingsBindings.SaveDevtoKey(key),
  ExportSettings: async (): Promise<ExportResult> => {
    const r = await SettingsBindings.ExportSettings();
    return { ...r, words: arr(r.words) };
  },
  RevealExport: (path: string) => SettingsBindings.RevealExport(path),
  ChooseSettingsFile: () => SettingsBindings.ChooseSettingsFile(),
  ImportSettings: async (path: string, passphrase: string): Promise<ImportResult> => {
    const r = await SettingsBindings.ImportSettings(path, passphrase);
    return { ...r, imported: arr(r.imported) };
  },
  CheckDevtoKey: (key: string) => SettingsBindings.CheckDevtoKey(key),
};

// The floating setup guide window.
export const GuideService = {
  Status: (): Promise<M.GuideStatus> => GuideBindings.Status(),
  Open: () => GuideBindings.Open(),
  Close: () => GuideBindings.Close(),
  Finish: () => GuideBindings.Finish(),
  Show: (view: "editor" | "buffer" | "attention" | "terminal" | "settings") => GuideBindings.Show(view),
};

const shellChoice = (c: M.ShellChoice): ShellChoice => ({ ...c, shells: arr(c.shells) });

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
  Shells: async (): Promise<ShellChoice> => shellChoice(await TerminalBindings.Shells()),
  SetShell: async (path: string): Promise<ShellChoice> => shellChoice(await TerminalBindings.SetShell(path)),
};

export const UpdateService = {
  Status: (): Promise<UpdateStatus> => UpdateBindings.Status() as Promise<UpdateStatus>,
  Check: (): Promise<UpdateInfo> => UpdateBindings.Check(),
  SetAutoCheck: (on: boolean): Promise<UpdateStatus> => UpdateBindings.SetAutoCheck(on) as Promise<UpdateStatus>,
};
