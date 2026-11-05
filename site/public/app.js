"use strict";

// Fills the page from /status.json, which the Pages workflow writes at deploy
// time from the newest published release and the build of its tag.

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
  { os: "windows", name: "Windows", note: "10 and 11, x64" },
  { os: "linux", name: "Linux", note: "x64" },
];

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
        el("h3", {}, p.name, el("span", { textContent: p.note })), list);
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
      `${status.version}${status.prerelease ? " (alpha)" : ""} · ${size(asset.size)} · other platforms below.`;
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
    version.replaceChildren(el("a", { href: status.release_url, rel: "noopener", textContent: status.version + (status.prerelease ? " (alpha)" : "") }));
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
    line.textContent = `${status.version}${status.prerelease ? " is an alpha" : ""}${when ? `, released ${when}` : ""}. Relay is early: expect rough edges, and please report them.`;
    document.getElementById("hero-version").textContent = `${status.version}${status.prerelease ? " alpha" : ""} · macOS, Windows and Linux`;
  } else {
    line.textContent = "No release yet. Check back soon.";
  }
  renderDownloads(status);
  renderStatus(status);
}

fetch("/status.json", { cache: "no-store" })
  .then((response) => {
    if (!response.ok) throw new Error(String(response.status));
    return response.json();
  })
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
