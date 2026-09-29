// Off-chain stress-test fixes in the embed: W1 (URL config can't redirect funds), W7/W8 (a standalone link can't
// reskin the page), W9 (prototype-keyed lookups). `pnpm test` bundles the pure modules into .test-dist first.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { configFromParams, encodeConfigParam, isSafeColor, sanitizeConfig, sanitizeTheme } from "../.test-dist/embed/sanitize.js";
import { BRIDGE_METHODS } from "../.test-dist/embed/protocol.js";
import { en, es, stringsFor } from "../.test-dist/strings.js";

const EVIL = "0x6666666666666666666666666666666666666666";
const hostile = {
  addresses: { house: EVIL, lens: EVIL, router: EVIL },
  rpcUrl: "https://evil.example/rpc",
  apiUrl: "https://evil.example/api",
  strings: { connect: "Claim your airdrop", __proto__: { polluted: true } },
  brandName: "Official flipper support",
  brandLogo: "https://evil.example/logo.png",
  coinImage: "https://evil.example/coin.png",
  coinImageTails: "https://evil.example/tails.png",
  tagline: "Verify your wallet to continue",
  theme: { mode: "dark", background: "url(https://evil.example/overlay.png)", accent: "#ff5a1f", text: "expression(alert(1))", fontFamily: "x;}@import url(evil)", light: { border: "red" } },
  accent: "red; background:url(x)",
  token: "0x1000000000000000000000000000000000000001",
  chainId: 4663,
  approval: "max",
};
const search = (cfg, extra = "") => `?config=${encodeConfigParam(cfg)}${extra}`;

describe("W1: the URL never decides where funds or approvals go", () => {
  for (const standalone of [true, false]) {
    test(`URL config drops addresses, rpcUrl, apiUrl (${standalone ? "standalone" : "hosted"})`, () => {
      const cfg = configFromParams(search(hostile), { standalone });
      assert.equal(cfg.addresses, undefined);
      assert.equal(cfg.rpcUrl, undefined);
      assert.equal(cfg.apiUrl, undefined);
      assert.equal(cfg.token, hostile.token);
      assert.equal(cfg.chainId, 4663);
      assert.equal(cfg.approval, "max"); // max approvals stay the default; the spender is always the genuine house
    });
  }
  test("a standalone page ignores network fields from bridged config too", () => {
    const out = sanitizeConfig(hostile, { from: "host", standalone: true });
    assert.equal(out.addresses, undefined);
    assert.equal(out.rpcUrl, undefined);
  });
  test("a real host (iframe parent / native bridge) may set them over the bridge", () => {
    const out = sanitizeConfig({ rpcUrl: "https://rpc.partner.example", addresses: { house: EVIL } }, { from: "host", standalone: false });
    assert.equal(out.rpcUrl, "https://rpc.partner.example");
    assert.deepEqual(out.addresses, { house: EVIL });
    assert.equal(sanitizeConfig({ rpcUrl: "javascript:x" }, { from: "host", standalone: false }).rpcUrl, undefined);
  });
});

describe("W7/W8: a standalone link can't reskin the page", () => {
  test("branding, copy and custom tagline text are dropped; only theme mode and plain colours stay", () => {
    const cfg = configFromParams(search(hostile, "&tagline=Send+your+seed+phrase"), { standalone: true });
    for (const k of ["strings", "brandName", "brandLogo", "coinImage", "coinImageTails"]) assert.equal(cfg[k], undefined, k);
    assert.equal(cfg.tagline, undefined);
    assert.deepEqual(cfg.theme, { mode: "dark", accent: "#ff5a1f", light: { border: "red" } });
    assert.equal(cfg.accent, undefined);
    assert.equal(configFromParams("?tagline=1", { standalone: true }).tagline, true);
  });
  test("a hosted embed keeps the host's branding (it's the host's page)", () => {
    const cfg = configFromParams(search({ brandName: "Acme", strings: { connect: "Log in" }, tagline: "Flip it" }), { standalone: false });
    assert.equal(cfg.brandName, "Acme");
    assert.deepEqual(cfg.strings, { connect: "Log in" });
    assert.equal(cfg.tagline, "Flip it");
  });
  test("colour tokens: plain colours only", () => {
    for (const ok of ["#fff", "#4cc2ff", "#4cc2ff80", "rgb(1, 2, 3)", "rgba(1,2,3,.5)", "hsl(200 100% 50%)", "oklch(0.7 0.1 240)", "red", "transparent"]) {
      assert.ok(isSafeColor(ok), ok);
    }
    for (const bad of ["url(x)", "red; background:url(x)", "expression(alert(1))", "@import url(x)", "var(--x)", "rgb(1,2,3) url(x)", "\"red\"", "red}", "\\72 ed", "", "a".repeat(80)]) {
      assert.equal(isSafeColor(bad), false, bad);
    }
    assert.equal(sanitizeTheme({ background: "url(x)", mode: "light" }).background, undefined);
  });
  test("the accent param is a plain colour or nothing", () => {
    assert.equal(configFromParams("?accent=ff5a1f", { standalone: true }).accent, "#ff5a1f");
    assert.equal(configFromParams("?accent=" + encodeURIComponent("red;background:url(x)"), { standalone: true }).accent, undefined);
  });
});

describe("W4: the bridge never forwards message signing", () => {
  test("no personal_sign / eth_sign / eth_signTypedData*", () => {
    for (const m of BRIDGE_METHODS) assert.doesNotMatch(m, /sign(?!.*Chain)/i, m);
    for (const m of ["personal_sign", "eth_sign", "eth_signTypedData_v4"]) assert.equal(BRIDGE_METHODS.includes(m), false, m);
  });
  test("transactions, batch calls, reads and chain add/switch stay", () => {
    for (const m of ["eth_sendTransaction", "wallet_sendCalls", "eth_accounts", "eth_chainId", "wallet_switchEthereumChain", "wallet_addEthereumChain"])
      assert.equal(BRIDGE_METHODS.includes(m), true, m);
  });
});

describe("W9: prototype-keyed lookups", () => {
  test("locale=__proto__ / constructor fall back to English", () => {
    for (const l of ["__proto__", "constructor", "toString", "__proto__-x"]) assert.equal(stringsFor(l), en, l);
    assert.equal(stringsFor("es-MX"), es);
  });
  test("string overrides only replace known keys", () => {
    const s = stringsFor("en", JSON.parse('{"connect":"Log in","__proto__":{"x":1},"constructor":"x","nope":"y"}'));
    assert.equal(s.connect, "Log in");
    assert.equal(Object.prototype.hasOwnProperty.call(s, "nope"), false);
    assert.equal(({}).x, undefined);
  });
});
