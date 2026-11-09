"use strict";

// Fills the page with the newest published release and the build of its tag.

const LABELS = { success: ["ok", "Passing"], failure: ["bad", "Failing"], cancelled: ["warn", "Cancelled"] };

// Release files by name, in the order they're offered.
const FILES = [
  { os: "macos", test: /macos.*\.zip$/i, kind: "Apple silicon", ext: ".zip" },
  { os: "windows", test: /installer\.exe$/i, kind: "Installer", ext: ".exe" },
  { os: "windows", test: /^relay\.exe$/i, kind: "Portable", ext: ".exe" },
  { os: "linux", test: /\.deb$/i, kind: "Debian / Ubuntu", ext: ".deb" },
  { os: "linux", test: /linux.*\.tar\.gz$/i, kind: "Any distribution", ext: ".tar.gz" },
];
const PLATFORMS = [
  { os: "macos", name: "macOS", note: "12 or later" },
  {
    os: "windows", name: "Windows", note: "10 and 11, x64",
    warning: "Not guaranteed to work. Windows is flaky with unsigned apps, and Relay isn't signed yet. With Smart App Control on, Windows 11 refuses to run it (\u201cAn Application Control policy has blocked this file\u201d), and on many PCs turning Smart App Control off can't be undone without resetting Windows.",
  },
  { os: "linux", name: "Linux", note: "x64" },
];

// "alpha", "beta" or "pre-release" for a pre-release, from its name or tag;
// "" for a full release.
function stage(status) {
  if (!status.prerelease) return "";
  const named = `${status.name ?? ""} ${status.version ?? ""}`.toLowerCase();
  return named.includes("beta") ? "beta" : named.includes("alpha") ? "alpha" : "pre-release";
}
const tagged = (status) => (stage(status) ? ` (${stage(status)})` : "");

function ago(iso) {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} d ago`;
}

function size(bytes) {
  return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} KB`;
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// Only links into this repo's releases are ever rendered.
const RELEASE = /^https:\/\/github\.com\/shad0wcrawl3r\/relay\/releases\//;

function visitorOS() {
  const p = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent).toLowerCase();
  if (p.includes("mac")) return "macos";
  if (p.includes("win")) return "windows";
  if (p.includes("linux") && !p.includes("android")) return "linux";
  return "";
}

function renderDownloads(status) {
  const box = document.getElementById("downloads");
  const assets = (status.assets ?? []).filter((a) => RELEASE.test(a.url));
  const mine = visitorOS();
  box.replaceChildren(
    ...PLATFORMS.map((p) => {
      const files = FILES.filter((f) => f.os === p.os)
        .map((f) => [f, assets.find((a) => f.test.test(a.name))])
        .filter(([, a]) => a);
      const list = files.length
        ? el("ul", {}, ...files.map(([f, a]) =>
            el("li", {}, el("a", { className: "file", href: a.url, rel: "noopener" },
              el("span", { className: "kind", textContent: f.kind }),
              el("span", { textContent: f.ext }),
              el("span", { className: "size", textContent: size(a.size) })))))
        : el("p", { className: "none", textContent: "Not in this release." });
      const card = el("div", { className: "platform" },
        el("h3", {}, p.name, el("span", { textContent: p.note })),
        ...(p.warning ? [el("p", { className: "platform-warning", textContent: p.warning })] : []),
        list);
      card.dataset.current = String(p.os === mine);
      return card;
    }),
  );

  // The hero button points at this visitor's file when there is one.
  const first = FILES.find((f) => f.os === mine && assets.some((a) => f.test.test(a.name)));
  const asset = first && assets.find((a) => first.test.test(a.name));
  if (asset) {
    const button = document.getElementById("hero-download");
    button.href = asset.url;
    button.textContent = `Download for ${PLATFORMS.find((p) => p.os === mine).name}`;
    document.getElementById("hero-note").textContent =
      `${status.version}${tagged(status)} · ${size(asset.size)} · other platforms below.` +
      (mine === "windows" ? " Windows isn't guaranteed to work; read the warning below first." : "");
  }
}

function setBanner(state, headline, subline) {
  document.getElementById("banner").dataset.state = state;
  document.getElementById("headline").textContent = headline;
  document.getElementById("subline").textContent = subline;
}

function pill(node, [state, label]) {
  node.dataset.state = state;
  node.textContent = label;
}

function renderStatus(status) {
  const platforms = status.platforms ?? [];
  document.getElementById("platforms").replaceChildren(...platforms.map((p) => {
    const result = el("span", { className: "pill" });
    pill(result, LABELS[p.conclusion] ?? ["unknown", "Unknown"]);
    return el("li", {}, el("span", { textContent: p.name }), result);
  }));
  const failing = platforms.filter((p) => p.conclusion !== "success");
  if (platforms.length === 0) setBanner("unknown", "No build data yet", "Waiting for the first release.");
  else if (failing.length === 0) setBanner("ok", "All builds passing", `${status.version} built ${ago(status.updated_at)}.`);
  else setBanner("bad", "Build problem", `${failing.map((p) => p.name).join(", ")} did not pass for ${status.version}.`);

  const version = document.getElementById("version");
  if (status.version && RELEASE.test(status.release_url ?? "")) {
    version.replaceChildren(el("a", { href: status.release_url, rel: "noopener", textContent: status.version + tagged(status) }));
  } else {
    version.textContent = status.version ?? "Not released yet";
  }
  document.getElementById("updated").textContent = status.updated_at ? ago(status.updated_at) : "Unknown";
  document.getElementById("commit").textContent = status.commit ?? "Unknown";
}

function render(status) {
  const line = document.getElementById("release-line");
  if (status.version) {
    const when = status.published_at ? new Date(status.published_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
    const article = stage(status) === "alpha" ? "an alpha" : stage(status) === "beta" ? "a beta" : stage(status) ? "a pre-release" : "";
    line.textContent = `${status.version}${article ? ` is ${article}` : ""}${when ? `, released ${when}` : ""}. Relay is early: expect rough edges, and please report them.`;
    document.getElementById("hero-version").textContent = `${status.version}${stage(status) ? ` ${stage(status)}` : ""} · macOS, Windows and Linux`;
  } else {
    line.textContent = "No release yet. Check back soon.";
  }
  renderDownloads(status);
  renderStatus(status);
}

// Release data comes live from GitHub's public API, so a new release shows up
// without waiting for a site deploy. /status.json, written at deploy time, is
// the fallback when the API is unreachable or rate-limited (60 requests an hour
// per visitor IP).
const API = "https://api.github.com/repos/shad0wcrawl3r/relay";

async function getJSON(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

// The same shape the Pages workflow writes to status.json.
async function liveStatus() {
  const releases = await getJSON(`${API}/releases?per_page=20`);
  const release = releases.find((r) => !r.draft);
  if (!release) return {};
  const status = {
    version: release.tag_name,
    name: release.name,
    prerelease: release.prerelease,
    published_at: release.published_at,
    release_url: release.html_url,
    assets: release.assets.map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url })),
  };
  const { sha } = await getJSON(`${API}/commits/${encodeURIComponent(release.tag_name)}`);
  const { workflow_runs: runs } = await getJSON(`${API}/actions/runs?head_sha=${sha}&event=push&status=completed&per_page=20`);
  const build = runs.find((r) => r.name === "Build");
  if (build) {
    const { jobs } = await getJSON(`${API}/actions/runs/${build.id}/jobs`);
    status.updated_at = build.updated_at;
    status.commit = sha.slice(0, 7);
    status.platforms = jobs
      .filter((j) => j.conclusion !== "skipped" && j.name !== "Draft release")
      .map((j) => ({ name: j.name.split(" ")[0], conclusion: j.conclusion }));
  }
  return status;
}

liveStatus()
  .catch(() => getJSON("/status.json"))
  .then(render)
  .catch(() => {
    setBanner("warn", "Status unavailable", "Release data couldn't be loaded.");
    document.getElementById("release-line").textContent = "Couldn't load the release list.";
    document.getElementById("downloads").replaceChildren(
      el("a", { className: "button", href: "https://github.com/shad0wcrawl3r/relay/releases", rel: "noopener", textContent: "All releases on GitHub" }));
  });

fetch("/oauth/callback", { method: "HEAD", cache: "no-store" })
  .then((response) => pill(document.getElementById("callback"), response.ok ? ["ok", "Online"] : ["bad", "Offline"]))
  .catch(() => pill(document.getElementById("callback"), ["bad", "Offline"]));
