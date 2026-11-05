"use strict";

// Buffer requires one fixed https redirect URI, so it sends users here and this
// page hands the result to the Relay instance waiting on 127.0.0.1. The port
// travels in the OAuth state as "<port>.<nonce>". Only the loopback address is
// ever a destination, and the code is useless without Relay's PKCE verifier.
const STATE = /^([0-9]{4,5})\.[A-Za-z0-9_-]{16,128}$/;
const FORWARDED = ["code", "state", "error", "error_description"];

function target(search) {
  const params = new URLSearchParams(search);
  const match = STATE.exec(params.get("state") ?? "");
  if (!match || !(params.has("code") || params.has("error"))) return null;
  const port = Number(match[1]);
  if (port < 1024 || port > 65535) return null;
  const forwarded = new URLSearchParams();
  for (const name of FORWARDED) {
    if (params.has(name)) forwarded.set(name, params.get(name));
  }
  return `http://127.0.0.1:${port}/oauth/callback?${forwarded}`;
}

if (typeof document !== "undefined") {
  const say = (title, message) => {
    document.getElementById("title").textContent = title;
    document.getElementById("message").textContent = message;
  };
  const destination = window.top === window.self ? target(window.location.search) : null;
  // Drop the code from the address bar and history before leaving.
  window.history.replaceState(null, "", window.location.pathname);
  if (destination) {
    window.location.replace(destination);
    setTimeout(() => say("Check Relay", "You can close this tab. If sign-in didn't finish, make sure Relay is open and try again."), 4000);
  } else {
    say("Nothing to do here", "This page only finishes sign-in from Relay. Start again from Relay's settings.");
  }
}

if (typeof module !== "undefined") module.exports = { target };
