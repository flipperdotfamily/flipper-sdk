// End to end: the injected FlipperHost script + the embed stub page (running in a vm "WebView") + FlipperBridgeCore
// + watchWallet, wired the way <FlipperWidget> wires them.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FlipperBridgeCore } from "../src/bridge";
import { FLIPPER_HOST_SCRIPT } from "../src/scripts";
import type { FlipperEvent, FlipperWallet } from "../src/types";
import { createFlipperWallet, watchWallet } from "../src/wallet";
import { FakeWebView, flush } from "./fakeWebView";
import { ACCOUNT, MockProvider, PAGE } from "./helpers";

function mount(wallet: FlipperWallet | null, opts: { url?: string; pageScript?: string; enableBatchCalls?: boolean } = {}) {
  const events: FlipperEvent[] = [];
  const heights: number[] = [];
  const connects: unknown[] = [];
  let web: FakeWebView;
  const bridge = new FlipperBridgeCore({
    embedOrigin: "https://flipper.family",
    chainId: 4663,
    enableBatchCalls: opts.enableBatchCalls,
    inject: (js) => web.injectJavaScript(js),
    getWallet: () => wallet,
    handlers: () => ({
      onEvent: (e) => events.push(e),
      onResize: (h) => heights.push(h),
      onConnectRequest: (d) => connects.push(d),
    }),
  });
  web = new FakeWebView({
    url: opts.url ?? PAGE,
    pageScript: opts.pageScript,
    injectedJavaScriptBeforeContentLoaded: FLIPPER_HOST_SCRIPT,
    injectedJavaScript: FLIPPER_HOST_SCRIPT,
    onMessage: (e) => bridge.handleMessage(e.nativeEvent.data, { url: e.nativeEvent.url }),
    onLoadStart: () => bridge.pageStarted(),
  });
  const state = { accounts: [] as string[], chainId: null as number | null };
  const watcher = wallet ? watchWallet(wallet, (u) => bridge.setWalletState(Object.assign(state, u))) : null;
  web.load();
  return { bridge, web, events, heights, connects, watcher };
}

describe("widget flow (fake WebView + embed stub)", () => {
  it("injects a frozen FlipperHost before the page runs, idempotently", async () => {
    const { web } = mount(new MockProvider());
    assert.equal(typeof web.window.FlipperHost.postMessage, "function");
    assert.equal(web.eval("Object.isFrozen(window.FlipperHost)"), true);
    web.eval("window.FlipperHost = { postMessage: function () { window.hijacked = true; } }");
    web.eval("window.FlipperHost.postMessage('{}')");
    assert.equal(web.window.hijacked, undefined, "the page can't replace FlipperHost");
    await flush();
  });

  it("ready -> wallet state, resize -> height, events -> host", async () => {
    const wallet = new MockProvider();
    const { web, events, heights } = mount(wallet);
    await flush();
    assert.deepEqual(
      events.map((e) => e.name),
      ["ready", "resize"],
    );
    assert.deepEqual(heights, [489]);
    const w = web.stub.lastOf("wallet");
    assert.deepEqual({ accounts: w.accounts, chainId: w.chainId }, { accounts: [ACCOUNT], chainId: "0x1237" });
  });

  it("routes a transaction from the page to the host wallet and back", async () => {
    const wallet = new MockProvider();
    const { web } = mount(wallet);
    await flush();
    const tx = { from: ACCOUNT, to: "0x0000000000000000000000000000000000000002", data: "0xdeadbeef", value: "0x0" };
    const hash = await web.stub.rpc("eth_sendTransaction", [tx]);
    assert.equal(hash, "0x" + "ab".repeat(32));
    assert.deepEqual(wallet.calls.find((c) => c.method === "eth_sendTransaction")!.params, [tx]);
  });

  it("passes wallet errors (e.g. 4001, 4902) through to the page", async () => {
    const wallet = new MockProvider();
    wallet.failures.set("wallet_switchEthereumChain", { code: 4902, message: "Unrecognized chain" });
    const { web } = mount(wallet);
    await flush();
    await assert.rejects(web.stub.rpc("wallet_switchEthereumChain", [{ chainId: "0x1237" }]), (e: { code: number }) => e.code === 4902);
    await assert.rejects(web.stub.rpc("eth_sign", ["0x1", "0x2"]), (e: { code: number }) => e.code === 4200);
    await assert.rejects(web.stub.rpc("personal_sign", ["0x00", ACCOUNT]), (e: { code: number }) => e.code === 4200);
    await assert.rejects(web.stub.rpc("eth_signTypedData_v4", [ACCOUNT, "{}"]), (e: { code: number }) => e.code === 4200);
    assert.equal(wallet.calls.some((c) => c.method.includes("sign")), false);
  });

  it("EIP-5792 batch calls: 4200 by default (the embed then falls back), forwarded when enabled", async () => {
    const wallet = new MockProvider();
    wallet.responses.set("wallet_sendCalls", { id: "0xbatch" });
    const off = mount(wallet);
    await flush();
    await assert.rejects(off.web.stub.rpc("wallet_sendCalls", [{ calls: [] }]), (e: { code: number }) => e.code === 4200);
    const on = mount(wallet, { enableBatchCalls: true });
    await flush();
    const res = await on.web.stub.rpc("wallet_sendCalls", [{ calls: [] }]);
    assert.equal(res.id, "0xbatch");
  });

  it("follows EIP-1193 accountsChanged / chainChanged / disconnect", async () => {
    const wallet = new MockProvider();
    const { web, watcher } = mount(wallet);
    await flush();
    wallet.emit("chainChanged", "0x1");
    await flush();
    assert.equal(web.stub.lastOf("wallet").chainId, "0x1");
    wallet.emit("accountsChanged", ["0x00000000000000000000000000000000000000B2"]);
    await flush();
    assert.deepEqual(web.stub.lastOf("wallet").accounts, ["0x00000000000000000000000000000000000000B2"]);
    wallet.emit("disconnect", { code: 4900 });
    await flush();
    assert.deepEqual(
      (({ accounts, chainId }) => ({ accounts, chainId }))(web.stub.lastOf("wallet")),
      { accounts: [], chainId: "0x1237" },
    );
    watcher!.stop();
    assert.equal(wallet.listenerCount(), 0);
  });

  it("no wallet: read-only, and Connect asks the host", async () => {
    const { web, connects } = mount(null);
    await flush();
    assert.deepEqual(web.stub.lastOf("wallet").accounts, []);
    assert.deepEqual(await web.stub.rpc("eth_accounts"), []);
    await assert.rejects(web.stub.rpc("eth_requestAccounts"), (e: { code: number }) => e.code === 4100);
    web.stub.emit("connect-request", { reason: "connect", partner: null });
    await flush();
    assert.equal(connects.length, 2);
  });

  it("delivers strings containing U+2028 / U+2029 intact", async () => {
    const weird = "tx" + String.fromCharCode(0x2028) + String.fromCharCode(0x2029) + "\"'\\";
    const wallet = new MockProvider();
    wallet.responses.set("eth_sendTransaction", weird);
    const { web } = mount(wallet);
    await flush();
    const tx = { from: ACCOUNT, to: "0x0000000000000000000000000000000000000002", data: "0x" };
    assert.equal(await web.stub.rpc("eth_sendTransaction", [tx]), weird);
  });

  it("works through window.postMessage when FlipperBridge isn't defined", async () => {
    // a page that only listens for message events
    const page = `
      window.got = [];
      window.addEventListener("message", function (e) { window.got.push(typeof e.data === "string" ? JSON.parse(e.data) : e.data); });
      setTimeout(function () { window.FlipperHost.postMessage(JSON.stringify({ v: 1, source: "flipper", type: "event", name: "ready", data: {} })); }, 0);`;
    const { web } = mount(new MockProvider(), { pageScript: page });
    await flush(10);
    assert.equal(web.window.got[0].type, "wallet");
  });

  it("ignores a page on another origin (e.g. after a redirect)", async () => {
    const wallet = new MockProvider();
    const { web, events } = mount(wallet, { url: "https://evil.example/embed" });
    await flush();
    assert.equal(events.length, 0);
    assert.equal(web.injected.length, 0);
    assert.equal(wallet.calls.filter((c) => c.method !== "eth_accounts" && c.method !== "eth_chainId").length, 0);
  });

  it("a reload waits for the new ready and re-sends state", async () => {
    const wallet = new MockProvider();
    const { web, bridge } = mount(wallet);
    await flush();
    bridge.sendConfig({ theme: "light" });
    await flush();
    web.load(); // reload: new page, onLoadStart -> pageStarted
    await flush();
    const types = Array.from(web.stub.received as Array<{ type: string }>, (m) => m.type);
    assert.deepEqual(types, ["wallet", "config"]);
  });
});

describe("createFlipperWallet", () => {
  it("adapts (method, params) wallets and their state callbacks", async () => {
    const seen: Array<[string, unknown]> = [];
    let push: ((s: { accounts?: string[]; chainId?: number | null }) => void) | undefined;
    let unsubscribed = false;
    const wallet = createFlipperWallet({
      request: async (method, params) => {
        seen.push([method, params]);
        return method === "eth_accounts" ? [ACCOUNT] : method === "eth_chainId" ? "0x1237" : "ok";
      },
      subscribe: (listener) => {
        push = listener;
        return () => {
          unsubscribed = true;
        };
      },
    });
    const { web, watcher } = mount(wallet);
    await flush();
    const asset = { type: "ERC20", options: { address: "0x0000000000000000000000000000000000000009", symbol: "FLIPPER", decimals: 18 } };
    assert.equal(await web.stub.rpc("wallet_watchAsset", asset), "ok");
    assert.deepEqual(seen.at(-1), ["wallet_watchAsset", asset]);
    push!({ chainId: 31337 });
    await flush();
    assert.equal(web.stub.lastOf("wallet").chainId, "0x7a69");
    push!({ accounts: [] });
    await flush();
    assert.deepEqual(web.stub.lastOf("wallet").accounts, []);
    watcher!.stop();
    assert.equal(unsubscribed, true);
  });
});
