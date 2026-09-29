import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";
import { base64Utf8, normalizeAccounts, normalizeChainId, originOf, parseUrl, toHexChainId, toJsStringLiteral } from "../src/encoding";
import { decideNavigation } from "../src/navigation";
import { buildEmbedUrl, diffConfig, FlipperConfigError, hostOnlyConfigOf, liveConfigOf, validateEmbedBaseUrl } from "../src/url";

const query = (url: string) => Object.fromEntries(new URL(url).searchParams);

describe("buildEmbedUrl", () => {
  it("defaults to the hosted embed on Robinhood Chain", () => {
    const e = buildEmbedUrl();
    assert.equal(e.url, "https://flipper.family/embed?chain=4663");
    assert.equal(e.origin, "https://flipper.family");
  });

  it("encodes every option", () => {
    const e = buildEmbedUrl({
      chain: 31337,
      token: "0x00000000000000000000000000000000000000aA",
      tokens: ["0x1", "0x2"],
      theme: "dark",
      accent: "#ff5a1f",
      radius: 12.4,
      branding: false,
      partner: "acme.app",
      locale: "es",
      compact: true,
      hidePicker: false,
    });
    assert.deepEqual(query(e.url), {
      chain: "31337",
      token: "0x00000000000000000000000000000000000000aA",
      tokens: "0x1,0x2",
      theme: "dark",
      accent: "#ff5a1f",
      radius: "12",
      branding: "0",
      partner: "acme.app",
      locale: "es",
      compact: "1",
      hidePicker: "0",
    });
    assert.ok(e.url.includes("accent=%23ff5a1f"), "# is percent-encoded");
  });

  it("passes the token mode and fit", () => {
    const q = query(buildEmbedUrl({ mode: "single", token: "ETH", fit: "fill" }).url);
    assert.equal(q.mode, "single");
    assert.equal(q.token, "ETH");
    assert.equal(q.fit, "fill");
    assert.equal(query(buildEmbedUrl({ mode: "picker" }).url).mode, "picker");
    assert.deepEqual(liveConfigOf({ mode: "single", fit: "fill" }), { mode: "single", fit: "fill" });
  });

  it("passes the opt-in details and tagline", () => {
    const q = query(buildEmbedUrl({ details: true, tagline: "Double or nothing on Acme" }).url);
    assert.equal(q.details, "1");
    assert.equal(q.tagline, "Double or nothing on Acme");
    assert.equal(query(buildEmbedUrl({ tagline: true }).url).tagline, "1");
    assert.equal(query(buildEmbedUrl({}).url).details, undefined);
    assert.deepEqual(liveConfigOf({ details: false, tagline: true }), { details: false, tagline: true });
  });

  it("puts extra config and custom theme tokens in base64 `config`", () => {
    const config = { brandName: "Açme ✓ 🪙", strings: { flip: "Lanzar" }, minAmount: "10" };
    const theme = { mode: "dark", colors: { accent: "#123456" } };
    const e = buildEmbedUrl({ config, theme });
    const q = query(e.url);
    assert.equal(q.theme, undefined, "an object theme doesn't go in ?theme=");
    assert.match(q.config!, /^[A-Za-z0-9+/]+={0,2}$/);
    assert.deepEqual(JSON.parse(Buffer.from(q.config!, "base64").toString("utf8")), { ...config, theme });
  });

  it("leaves rpcUrl / apiUrl / addresses out of the URL (the embed only takes them from a config message)", () => {
    const network = { rpcUrl: "https://rpc.example", apiUrl: "https://api.example", addresses: { house: "0x01", lens: "0x02" } };
    const q = query(buildEmbedUrl({ config: { brandName: "Acme", ...network } }).url);
    assert.deepEqual(JSON.parse(Buffer.from(q.config!, "base64").toString("utf8")), { brandName: "Acme" });
    assert.equal(query(buildEmbedUrl({ config: network }).url).config, undefined, "no empty config param");
    assert.deepEqual(hostOnlyConfigOf({ config: { brandName: "Acme", ...network } }), network);
    assert.deepEqual(hostOnlyConfigOf({ config: { brandName: "Acme" } }), {});
    assert.deepEqual(hostOnlyConfigOf({}), {});
  });

  it("keeps the base URL's own params and hash, replacing ones it sets", () => {
    const e = buildEmbedUrl({ baseUrl: "https://flipper.family/embed?utm=x&chain=1#top", chain: 31337, partner: "p" });
    assert.equal(e.url, "https://flipper.family/embed?utm=x&chain=31337&partner=p#top");
  });

  it("allows http only for loopback hosts, and only when asked", () => {
    for (const base of ["http://localhost:3000/embed", "http://127.0.0.1:3000/embed", "http://10.0.2.2:3000/embed", "http://[::1]:3000/embed"]) {
      assert.throws(() => buildEmbedUrl({ baseUrl: base }), FlipperConfigError);
      assert.ok(buildEmbedUrl({ baseUrl: base, allowInsecureLocalhost: true }).url.startsWith(base));
    }
    assert.equal(validateEmbedBaseUrl("http://localhost:3000/embed", true), "http://localhost:3000");
  });

  it("rejects insecure, credentialed and non-web URLs", () => {
    for (const base of [
      "http://flipper.family/embed",
      "http://192.168.1.10:3000/embed",
      "http://localhost.evil.example/embed",
      "https://user:pass@flipper.family/embed",
      "https://flipper.family@evil.example/embed",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,hi",
      "ftp://flipper.family/embed",
      "flipper.family/embed",
      "",
    ]) {
      assert.throws(() => buildEmbedUrl({ baseUrl: base, allowInsecureLocalhost: true }), FlipperConfigError, base);
    }
  });
});

describe("live config", () => {
  it("maps props to FlipperEmbedConfig names and leaves identity fields out", () => {
    assert.deepEqual(
      liveConfigOf({ chain: 1, partner: "x", compact: true, theme: "light", tokens: ["0x1"], config: { brandName: "A", chainId: 5, partner: "y" } }),
      { brandName: "A", theme: "light", variant: "compact", tokens: ["0x1"] },
    );
    assert.deepEqual(liveConfigOf({ compact: false }), { variant: "card" });
  });

  it("diffs by value", () => {
    assert.equal(diffConfig({ theme: "dark", tokens: ["0x1"] }, { theme: "dark", tokens: ["0x1"] }), null);
    assert.deepEqual(diffConfig({ theme: "dark", tokens: ["0x1"] }, { theme: "light", tokens: ["0x1", "0x2"], accent: "#fff" }), {
      theme: "light",
      tokens: ["0x1", "0x2"],
      accent: "#fff",
    });
  });
});

describe("encoding", () => {
  it("makes JS string literals that survive U+2028 / U+2029 and quotes", () => {
    const tricky = `a"b'c\\d</script>` + String.fromCharCode(0x2028) + "x" + String.fromCharCode(0x2029) + "\n🪙";
    const literal = toJsStringLiteral(tricky);
    assert.ok(!literal.includes(String.fromCharCode(0x2028)) && !literal.includes(String.fromCharCode(0x2029)));
    assert.equal(vm.runInNewContext(literal), tricky);
  });

  it("base64-encodes UTF-8 like Buffer", () => {
    for (const s of ["", "f", "fo", "foo", "hello world", "Açme ✓ 🪙", String.fromCharCode(0xd800) + "x"]) {
      assert.equal(base64Utf8(s), Buffer.from(s, "utf8").toString("base64"), JSON.stringify(s));
    }
  });

  it("normalizes chain ids", () => {
    assert.equal(normalizeChainId(4663), 4663);
    assert.equal(normalizeChainId("4663"), 4663);
    assert.equal(normalizeChainId("0x1237"), 4663);
    assert.equal(normalizeChainId("0X1237"), 4663);
    assert.equal(normalizeChainId("eip155:4663"), 4663);
    assert.equal(normalizeChainId("eip155:0x7a69"), 31337);
    assert.equal(normalizeChainId(4663n), 4663);
    for (const bad of [0, -1, 1.5, "", "abc", "solana:5eykt", "0x", null, undefined, {}, Number.NaN]) assert.equal(normalizeChainId(bad), null);
    assert.equal(toHexChainId(4663), "0x1237");
    assert.equal(toHexChainId(31337), "0x7a69");
  });

  it("normalizes account lists", () => {
    assert.deepEqual(normalizeAccounts(["0x1", 2, "", "0x2"]), ["0x1", "0x2"]);
    assert.deepEqual(normalizeAccounts("0x1"), ["0x1"]);
    assert.deepEqual(normalizeAccounts(null), []);
  });

  it("parses origins without the URL polyfill", () => {
    assert.equal(originOf("https://flipper.family/embed?x=1"), "https://flipper.family");
    assert.equal(originOf("HTTPS://FLIPPER.FAMILY:443/"), "https://flipper.family");
    assert.equal(originOf("http://localhost:80/x"), "http://localhost");
    assert.equal(originOf("http://localhost:3000"), "http://localhost:3000");
    assert.equal(originOf("http://[::1]:3000/embed"), "http://[::1]:3000");
    assert.equal(originOf("https://a.b@evil.example/"), "https://evil.example");
    assert.equal(originOf("https://flipper.family\\@evil.example/"), "https://flipper.family");
    assert.equal(originOf("about:blank"), null);
    assert.equal(originOf("mailto:a@b.c"), null);
    assert.equal(originOf("not a url"), null);
    assert.equal(parseUrl("https://u:p@h/")!.hasUserInfo, true);
  });
});

describe("navigation policy", () => {
  const O = "https://flipper.family";
  it("keeps the embed origin inside the widget", () => {
    assert.equal(decideNavigation("https://flipper.family/embed?chain=1", O, true), "allow");
    assert.equal(decideNavigation("https://flipper.family/assets/x.js", O, false), "allow");
  });
  it("opens other web links and mail/phone links externally", () => {
    assert.equal(decideNavigation("https://robinhoodchain.blockscout.com/tx/0x1", O, true), "open-external");
    assert.equal(decideNavigation("http://example.com", O, true), "open-external");
    assert.equal(decideNavigation("mailto:hi@flipper.family", O, true), "open-external");
    assert.equal(decideNavigation("https://flipper.family.evil.example/", O, true), "open-external");
  });
  it("blocks other schemes and foreign sub-frames", () => {
    for (const url of ["javascript:alert(1)", "file:///x", "data:text/html,x", "intent://x#Intent;end", "wc:abc@2", "metamask://x", "about:blank"])
      assert.equal(decideNavigation(url, O, true), "block", url);
    assert.equal(decideNavigation("https://ads.example/frame", O, false), "block");
    assert.equal(decideNavigation("about:blank", O, false), "allow");
    assert.equal(decideNavigation("about:srcdoc", O, false), "allow");
    assert.equal(decideNavigation("https://user@flipper.family/", O, true), "open-external");
  });
});
