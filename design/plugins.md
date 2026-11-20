# Relay plugins: architecture (locked)

Decided 2026-11-07. Planning only: work starts after the Buffer Commit
contest closes (2026-11-13). Every decision below is final. Change one only
if a security test in §8 fails.

## 1. Shape

- **The core is open source** (BSD-3). It contains:
  - the UI framework: shell, sidebar, routing, settings, command palette,
    shortcuts and the `@relay/ui` kit;
  - the trust pieces: `vault`, keychain secrets, `unlock`, AI provider
    routing, `logs`.
- **Every feature is a plugin**, including the first-party ones: Plane,
  Dev.to, Buffer (plus Buffer planning, still experimental) and Terminal.
- **Plugins may be proprietary.** They link only against the public SDK.

## 2. Backend: plugins run as separate processes

- **No rebuild model.** The xcaddy approach and Go's `plugin` package are
  both rejected.
- **Each plugin is its own executable**, started and supervised by the core,
  in the style of hashicorp/go-plugin.
- **Transport is gRPC over a Unix socket file, never TCP.**
  - Sockets live in a per-launch directory under the app dir.
  - The directory is `0700` and each socket is `0600`.
  - Sockets are removed on quit and on the next launch after a crash.
  - Windows uses AF_UNIX (Windows 10 1803 and later). go-plugin defaults
    to TCP there, so it needs a custom listener.
- **The public surface is the `relay/sdk` Go module**: the protobuf API and
  helpers.
  - Everything under `internal/` stays private.
  - If DI or reflection (fx) is used at all, it stays inside the core.
- **Versioning**: the SDK protocol version is negotiated at handshake.
  Each manifest declares a minimum Relay version.

## 3. Frontend

- **Full views** (board, editor, terminal) run in iframes with
  `sandbox="allow-scripts"`, never `allow-same-origin`.
- **Plugin content is never placed in `srcdoc` or `about:blank` iframes.**
  On Linux those are same-origin, and WebKitGTK can't guard them.
- **Small UI pieces are declared in the manifest and drawn by the core:**
  sidebar entries, commands, shortcuts, settings forms, and slots (for
  example `editor.actions`). This is the VS Code model.
- **Plugins reach the core only through a `postMessage` bridge** that checks
  permissions on every call.
- **`@relay/ui`** (zinc theme, design tokens, shadcn components) is bundled
  by each plugin. No React instance is shared with the core.
- **Core security prompts never sit inside plugin-controlled UI.** That
  covers unlock, install permissions and the publish/send confirmations.

## 4. Gating calls into the core (Wails is not the boundary)

Wails v3.0.0 and v3.1.0 let child frames call bound methods over HTTP at
`/wails/runtime` on every platform. On Windows they can also send reserved
`wails:` messages. Relay's design assumes this stays true. Five rules follow:

1. **Sensitive core methods are not bound directly.** The core frontend uses
   one entry point, `Core.Call(token, method, args)`, and Go refuses any
   call without the valid per-launch token.
2. **The token is handed out once, to whoever asks first.** The main frame
   asks before any plugin iframe exists, so later requests are refused.
   It's kept only in memory: never in the DOM, storage or URLs.
3. **`Assets.Middleware` filters runtime calls.** It runs outside Wails' own
   handler for `/wails/runtime` (checked in the v3.1.0 source) and rejects
   requests with `Origin: null` or any origin other than the app's.
   This is a second layer only.
4. **Go treats frontend-emitted events as hints, never as commands.**
   No `RawMessageHandler`.
5. **Plugin iframes get no token.** Everything they do goes through the
   bridge, which adds the token after its permission check.

## 5. Capabilities and privacy

- **Plugins declare what they provide and what they need**, for example
  `provides: articles` or `requires?: articles`. The core connects them.
- **Rules that span two plugins belong to the plugin that depends on the
  other.** "Promotions need a live article" is Buffer's rule.
- **The core enforces these rules on everything that passes through it:**
  - locked project data only goes to plugins with that permission, and only
    while an unlock is active;
  - AI prompts go through `ai.Client.Complete` with an `ai.Origin`, so the
    private-provider rule still holds;
  - secrets and vault storage are separated per plugin;
  - plugin logs go through `internal/logs` with the same never-log rules.
- **The core can't control what a plugin process does on its own.** For
  third-party plugins that rests on declared permissions plus review, and
  the install screen says so.
- **Terminal**: the webview can't open a WebSocket to a socket file. So the
  core keeps one 127.0.0.1 endpoint with a per-launch token and proxies it
  to the plugin's socket.

## 6. Distribution

- **An open `relay-extensions` repo.** Each PR adds one manifest:
  - ID and publisher;
  - version and minimum Relay version;
  - permissions and capabilities;
  - download URLs per platform (darwin/arm64, darwin/amd64, windows/amd64,
    linux/amd64), each with a sha256.
- **CI checks each PR:**
  - the schema;
  - that every download matches its hash;
  - that the plugin completes the handshake on macOS, Windows and Linux;
  - that it only calls the permissions it declares.
- **After merge, CI publishes an ed25519-signed (minisign) `index.json`**
  to Pages. The app ships the public key.
- **Installing a plugin:**
  1. Fetch the index and verify its signature.
  2. Show the permissions.
  3. Download the binary and verify its hash.
  4. Store it in the app dir.
  5. Launch it on demand.
- **Each reviewed version is fixed by its hash**, so every update is a new
  PR. Closed-source entries are labelled as such.
- **First-party plugins go through the same index.**

## 7. Open choices (not security-relevant)

- Whether the main download comes with the first-party plugins
  pre-installed.
- Whether to add per-publisher signing keys later.

## 8. Security test cases

Run each case on macOS (arm64), Windows (amd64) and Linux (amd64; GTK3 and
GTK4 where both exist). The middleware, token, socket and supervisor cases
also go into Go tests. The webview cases need a real window, so they run in
a CI job using a fixture plugin whose iframe tries each attack and reports
what happened through the bridge.

### 8.1 Runtime HTTP channel (`/wails/runtime`)

| ID | Setup | Action | Expected |
|---|---|---|---|
| RT-1 | Sandboxed plugin iframe | `fetch` POST to `/wails/runtime` calling `Core.Call` with no token | Middleware returns 403, or Go refuses: no core method runs |
| RT-2 | Same as RT-1 | Call `Core.Call` with a guessed or random token | Refused; the attempt is logged with plugin ID only |
| RT-3 | Same as RT-1 | Call any other bound method by name (e.g. a settings or vault getter) | Refused: only `Core.Call` is bound, and RT-1 applies |
| RT-4 | Sandboxed iframe | Record the `Origin` and `Sec-Fetch-Site` headers the middleware sees | Written down per platform. Expected `null`; if it's missing or rewritten (macOS custom scheme), RT-1 must still pass via the token |
| RT-5 | Main frame | Normal `Core.Call` with the token | Succeeds |
| RT-6 | Main frame already holds the token | Plugin iframe calls the token-issuing method | Refused: the token is handed out only once |
| RT-7 | Plugin iframe created before the main frame asks (forced ordering in the fixture) | Iframe requests the token | Never happens in the real core: no iframe is created until the main frame holds the token. The fixture asserts that ordering |
| RT-8 | Unit test: middleware | Requests with Origin = app origin / `null` / `http://evil` / missing | Allow / 403 / 403 / falls through to the token check |

### 8.2 Native `wails:` message channel

| ID | Setup | Action | Expected |
|---|---|---|---|
| NM-1 | macOS, sandboxed iframe | Send reserved `wails:` messages (drag, resize, runtime-ready) | Ignored |
| NM-2 | Linux, sandboxed iframe | Same as NM-1 | Blocked by the guard script |
| NM-3 | Windows, sandboxed iframe | Same as NM-1 | Known gap: record exactly what happens. Pass if it can't reach data, open or close core dialogs, or change which view is active |
| NM-4 | All platforms | Iframe emits an app event a core listener uses (e.g. `integrations:changed`) | Go takes no action from it beyond re-reading state it owns |
| NM-5 | Linux | Core renders any plugin surface | Asserted in code: no `srcdoc` or `about:blank` iframe ever carries plugin content (lint plus a unit test on the iframe factory) |

### 8.3 Frame isolation and the bridge

| ID | Setup | Action | Expected |
|---|---|---|---|
| FR-1 | Sandboxed iframe | Read `parent.document`, `parent.window.*`, or the token variable | Throws a cross-origin error |
| FR-2 | Sandboxed iframe | Read cookies, `localStorage` or `indexedDB` from the app origin | Unavailable (opaque origin) |
| FR-3 | Plugin without `plane.locked` permission | Ask the bridge for a locked project's items | Refused; nothing logged about the project |
| FR-4 | Plugin with the permission, no active unlock | Same as FR-3 | Refused until unlocked; refused again after the unlock expires |
| FR-5 | Plugin asks the bridge for a permission it didn't declare | Any call | Refused; the attempt is logged with plugin ID only |
| FR-6 | Plugin draws a fake unlock or permission prompt | Visual check | Real prompts come only from the core, outside the iframe, and look distinct from anything a plugin can draw |
| FR-7 | Plugin A's iframe | `postMessage` pretending to be plugin B | The bridge identifies the sender by `event.source` / frame handle, never by message content: refused |

### 8.4 Plugin process and socket

| ID | Setup | Action | Expected |
|---|---|---|---|
| PS-1 | Running core | Check the socket directory and files | Directory `0700`, sockets `0600`, owned by the user; on Windows the ACL is limited to the user |
| PS-2 | Another local user | Connect to a plugin socket | Denied by the OS |
| PS-3 | Same user, a process that isn't the core | Connect to a plugin socket and send RPCs | Handshake fails without the per-launch handshake secret |
| PS-4 | Plugin speaks a different SDK protocol version | Launch | Refused with a clear error; the core keeps running |
| PS-5 | Plugin crashes | — | Supervisor restarts it with backoff; its views show an error state; nothing else is affected |
| PS-6 | Core quits or crashes | — | Plugin processes exit; stale sockets are removed at the next launch |
| PS-7 | Plugin writes data through the vault API | Inspect disk | Only AES-256-GCM ciphertext in that plugin's namespace; it can't read another plugin's namespace |
| PS-8 | Plugin asks for another plugin's keychain secret | Call | Refused |
| PS-9 | Plugin sends a prompt with locked-project content to a provider that isn't private | Call | Refused by `ai.Client`; the prompt and project aren't logged |
| PS-10 | Plugin logs | Emits logs | They go through `internal/logs` at that plugin's level and stay in memory only |

### 8.5 Terminal proxy

| ID | Setup | Action | Expected |
|---|---|---|---|
| TP-1 | Core proxy | Check the listen address | 127.0.0.1 only |
| TP-2 | Connect without or with a wrong token | — | Rejected |
| TP-3 | Sandboxed non-terminal plugin iframe | Open a WebSocket to the proxy | Rejected: the token is only given to the terminal view, through the bridge |

### 8.6 Distribution

| ID | Setup | Action | Expected |
|---|---|---|---|
| DI-1 | Index with a bad or missing signature | Fetch | Refused; the cached index is kept |
| DI-2 | Binary whose hash doesn't match the index | Install | Refused; the file is deleted |
| DI-3 | Manifest declares a minimum Relay version above the running one | Install | Refused with an "update Relay" message |
| DI-4 | Registry PR changes a published version's URL or hash | CI | Fails: published versions are immutable |
| DI-5 | Registry PR whose binary fails the handshake on any OS | CI | Fails |
| DI-6 | Registry PR whose plugin calls a permission it didn't declare (fixture run) | CI | Fails |
| DI-7 | Index served over a downgrade or replay (an older signed index) | Fetch | Refused: the index carries a monotonically increasing sequence number |
| DI-8 | Plugin downloaded by the app on macOS | Launch | Record whether Gatekeeper blocks it; document the steps if needed |
