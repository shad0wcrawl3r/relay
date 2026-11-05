"use strict";

const assert = require("node:assert");
const test = require("node:test");
const { target } = require("../public/oauth/forward.js");

const STATE = "53682.abcdefghijklmnop";

test("forwards a code to the port in the state", () => {
  assert.strictEqual(
    target(`?code=abc&state=${STATE}`),
    `http://127.0.0.1:53682/oauth/callback?code=abc&state=${STATE}`,
  );
});

test("forwards errors", () => {
  assert.strictEqual(
    target(`?error=access_denied&state=${STATE}`),
    `http://127.0.0.1:53682/oauth/callback?state=${STATE}&error=access_denied`,
  );
});

test("drops parameters it doesn't know", () => {
  assert.ok(!target(`?code=abc&state=${STATE}&next=https://evil.example`).includes("evil"));
});

test("escapes values", () => {
  assert.ok(target(`?code=a%26x%3D1&state=${STATE}`).includes("code=a%26x%3D1&"));
});

for (const [name, search] of [
  ["no state", "?code=abc"],
  ["no code or error", `?state=${STATE}`],
  ["host in state", "?code=abc&state=evil.example.abcdefghijklmnop"],
  ["host before port", "?code=abc&state=evil.example:53682.abcdefghijklmnop"],
  ["short nonce", "?code=abc&state=53682.short"],
  ["privileged port", "?code=abc&state=1023.abcdefghijklmnop"],
  ["port too high", "?code=abc&state=70000.abcdefghijklmnop"],
  ["path in nonce", "?code=abc&state=53682.abcdefghijklmnop/../x"],
]) {
  test(`refuses ${name}`, () => assert.strictEqual(target(search), null));
}
