import { Browser } from "@wailsio/runtime";
import { UpdateService, type BuildInfo } from "@/lib/api";

export const REPO = "https://github.com/shad0wcrawl3r/relay";

/** The rows Settings → About shows and "Copy build info" copies. */
export function buildRows(b: BuildInfo, date: (iso: string) => string = (s) => s): [string, string][] {
  return [
    ["Version", b.dev ? `${b.display} (dev build of ${b.version})` : b.version],
    ["Build", b.dev ? "Development" : "Release"],
    ["Commit", b.commit ? `${b.commit}${b.dirty ? " with uncommitted changes" : ""}` : "Unknown"],
    ["Commit date", b.commitDate ? date(b.commitDate) : "Unknown"],
    ["Platform", b.platform],
    ["Go", b.go],
    ["Wails", b.wails || "Unknown"],
  ];
}

/**
 * A new GitHub issue from the bug form, with the version, platform and build
 * info filled in. Only those: never logs, settings or anything from the
 * user's projects, posts or terminal.
 */
export function bugReportURL(b: BuildInfo | null): string {
  const q = new URLSearchParams({ template: "bug_report.yml" });
  if (b) {
    q.set("version", b.dev ? `${b.display} (dev build of ${b.version})` : b.version);
    q.set("platform", b.platform);
    q.set("build", ["Relay", ...buildRows(b).map(([k, v]) => `${k}: ${v}`)].join("\n"));
  }
  return `${REPO}/issues/new?${q}`;
}

/** Opens the bug form in the browser, with build info when it's available. */
export async function reportBug(b?: BuildInfo | null) {
  const info = b ?? (await UpdateService.Build().catch(() => null));
  Browser.OpenURL(bugReportURL(info));
}
