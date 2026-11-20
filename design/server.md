# Relay server and Android client

Decided 2026-11-20. Planning only. The server comes first, then the Android
client. Sync between devices is a later, separate project (§9).

## 1. Shape

- **Each user runs their own server**, on their own free Cloudflare account,
  set up with one "Deploy to Cloudflare" button. Relay doesn't run a shared
  backend.
- **The server only does two things:**
  1. OAuth, for the steps that need a secret or a stable redirect;
  2. proxying API calls to Plane, Dev.to and Buffer.
- **The server keeps no user data.** Boards, posts, drafts and caches live in
  device storage, the same as on desktop today. The proxy passes requests and
  responses through without storing or logging them.
- **Where tokens live depends on how many devices there are:**
  - **One device:** tokens stay on the device (OS keychain / Android
    Keystore). The server sees a token only in transit, when it proxies a call.
  - **Two or more devices:** the tokens move to the server. Devices then call
    through the proxy, and the server attaches the token.
- **The terminal stays desktop-only.** So do Ship's `git log` and anything
  else that needs the local machine.
- **AI never goes through the server.** Prompts still go from the device
  through `ai.Client.Complete` and its privacy gate.

## 2. Why tokens move in multi-device mode

- **Buffer rotates refresh tokens.** Two devices holding the same Buffer token
  race each other: whichever refreshes second holds a dead token. Desktop
  already works around this for two copies of Relay on one machine
  (`internal/buffer/buffer.go`, "another Relay rotated it"). Across devices,
  one owner is the only clean answer.
- **Plane bot tokens are minted with the app's client secret**
  (`client_credentials`, no refresh token; `internal/plane/oauth.go`). The
  server holds the secret in either mode, so it can mint tokens for any device.
- **The Dev.to API key is static.** It moves anyway, so there's one rule for
  every service.

## 3. What the server holds

| Item | One device | Multi-device |
|---|---|---|
| Plane app client ID and secret | Server (Worker secret) | Server (Worker secret) |
| Plane bot token | Device | Server |
| Buffer access and refresh tokens | Device | Server |
| Buffer insights key (optional) | Device | Server |
| Dev.to API key | Device | Server |
| Device public keys | Server | Server |
| Boards, posts, drafts, caches, settings | Device | Device |
| Locked-project list and unlocks | Device | Device |

- Tokens on the server are encrypted (AES-256-GCM) in D1. The key is a Worker
  secret generated at deploy.
- **This doesn't protect tokens from the Cloudflare account itself.** Whoever
  controls the account controls the server. The threat model and the setup
  screen say so.

## 4. Claiming the server and pairing devices

- **Claim.** Deploying asks for a claim code (or generates one). The first
  device that presents it within a short window becomes the first paired
  device. After that the claim endpoint is closed for good.
- **Device keys.** Each device makes an ed25519 key pair. It's
  non-exportable where the platform allows it (Android Keystore / StrongBox,
  Secure Enclave on macOS).
- **Signed requests.** Every request is signed over method, path, body hash,
  timestamp and a nonce. The server rejects stale timestamps and reused nonces.
- **Adding a device.** A paired device shows a one-time pairing code as a QR
  code, valid for 5 minutes and usable once. The new device scans it and sends
  its public key.
- **Revoking.** Any paired device can revoke another. Revoking the
  second-to-last device offers to move the tokens back to the device that's
  left (§5).

## 5. Handoff

- **One device → multi-device:** happens when the second device pairs.
  1. The first device uploads its tokens over TLS.
  2. The server stores them encrypted and confirms.
  3. Only then does the device delete its local copies.
  4. Both devices switch to proxy mode.
- **Multi-device → one device:** offered (not automatic) when only one device
  is left.
  1. The server sends the tokens to the last device.
  2. The device stores them in the keychain and confirms.
  3. The server deletes its copies.
- **A failed handoff leaves the tokens where they were.** They never end up
  in both places, and never in neither.
- **Buffer.** The server takes over the token's refresh lock. Devices in
  proxy mode never refresh Buffer tokens themselves.

## 6. OAuth per service

- **Plane:**
  - The user registers their own Plane app, as on desktop today.
  - Its redirect URI points at their server.
  - The server receives `app_installation_id` and mints bot tokens with the
    secret.
  - One device: the device fetches a fresh bot token from the server when its
    token expires. Multi-device: the server keeps the token.
- **Buffer:**
  - PKCE alone, no secret: the device can sign in without the server.
  - The redirect needs a stable https URL. Either the user's server or Relay's
    hosted callback can forward it to the app (Android App Link / custom
    scheme).
  - Using Relay's Buffer app vs. the user's own is open (§10).
- **Dev.to:** an API key, pasted in. No OAuth.

## 7. Proxy rules

- **Fixed allowlist of upstream hosts:** the user's Plane base URL, `dev.to`
  and Buffer's API. Anything else is refused, so it can't become an open proxy.
- **The server adds the token** in multi-device mode. In one-device mode the
  device sends it, and the server passes it on without keeping it.
- **No storage:** bodies are streamed, never written to D1, KV or logs.
  Worker logs record method, upstream host, status and timing only.
- **Rate limits:** the server honours `Retry-After` per account. It refuses
  calls until then, as `buffer.RateLimited` does on desktop.
- **Desktop rules still hold.** Dev.to drafts go up as `published: false`,
  and publishing stays a separate confirmed action. Buffer promotions need a
  live article. These checks stay in the client, and the server never weakens
  them.

## 8. Cloudflare deployment

- **Workers + D1, on the free plan.** One Worker (TypeScript), one D1 database
  for device keys, nonces and the encrypted token store.
  - Go can't run there: TinyGo/WASM is too limited, and Containers aren't
    free. So the server is a small TypeScript codebase of its own, not a port
    of the Go services.
- **"Deploy to Cloudflare" button** on the Relay site and README. It copies
  the server template into the user's GitHub and Cloudflare accounts, creates
  the D1 database and asks for the Plane app credentials and claim code.
- **Updates:** the copied repo pulls template releases through a scheduled
  GitHub Action, or the user clicks a sync button. The device shows the
  server's version and warns when it's behind the minimum the app needs.

## 9. Later: sync engine

- Not part of this work.
- Until it exists, every device keeps its own local data and reads fresh state
  from Plane, Dev.to and Buffer.
- Plane is already the source of truth for boards.
- Local-only things (drafts not yet sent, settings) don't follow you across
  devices.

## 10. Open questions

1. **Does one-device mode need the proxy at all?** The Android app is native,
   so CORS doesn't block it, and it could call the services directly. The
   proxy would then be needed only in multi-device mode and for any future web
   client. Recommendation: call directly in one-device mode; keep the proxy
   for multi-device.
2. **Server repo:** a subdirectory of this repo, or a separate public template
   repo, `relay-server`? Depends on whether the Deploy button handles
   subdirectories and secret prompts the way we need (spike).
3. **Buffer app:** Relay's app (`buffer.DefaultClientID`) with a hosted
   redirect to the Android app, or the user's own app pointed at their server?
4. **Android stack:** native Kotlin (Compose), or a WebView shell that reuses
   the React frontend (Capacitor)? The second reuses most of the UI, but every
   Go service the UI calls through `frontend/src/lib/api.ts` would need a
   Kotlin or TypeScript version.
5. **Android scope for the first release:** which of board, editor and Buffer
   ship first.

## 11. Security test cases

| ID | Action | Expected |
|---|---|---|
| SV-1 | Call the claim endpoint after the server is claimed | Refused |
| SV-2 | Unsigned, wrongly signed, stale or replayed request | Refused; nothing proxied |
| SV-3 | Request from a revoked device | Refused |
| SV-4 | Reuse a pairing code, or use it after 5 minutes | Refused |
| SV-5 | Proxy to a host not on the allowlist | Refused |
| SV-6 | Inspect D1 and Worker logs after proxied calls | No bodies, no tokens; tokens in D1 only as ciphertext |
| SV-7 | Kill the connection mid-handoff, in either direction | Tokens stay where they were; never in both places or neither |
| SV-8 | Two devices in multi-device mode use Buffer at the same time | Only the server refreshes; neither device ends up with a dead token |
| SV-9 | Buffer returns 429 | The server refuses calls for that account until `Retry-After` |
| SV-10 | Android: open a locked project without an active biometric unlock | Not shown; never logged |
