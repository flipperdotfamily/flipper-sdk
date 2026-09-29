import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BATCH_CALL_METHODS, BRIDGE_METHODS, WALLET_METHODS } from "../src/constants";
import { FlipperRpcError } from "../src/wallet";
import { ACCOUNT, MockProvider, PAGE, harness, tick } from "./helpers";

describe("inbound filtering", () => {
  it("drops messages with the wrong source or version", async () => {
    const h = harness();
    h.post({ v: 1, source: "flipper-host", type: "rpc", id: "a", method: "eth_accounts", params: [] });
    h.post({ v: 2, source: "flipper", type: "rpc", id: "b", method: "eth_accounts", params: [] });
    h.post({ v: "1", source: "flipper", type: "rpc", id: "c", method: "eth_accounts", params: [] });
    h.post({ source: "flipper", type: "event", name: "ready" });
    await tick();
    assert.equal(h.sent.length, 0);
    assert.equal(h.calls.length, 0);
  });

  it("drops non-JSON, non-object and oversized payloads", async () => {
    const h = harness();
    h.post("not json {");
    h.post("[1,2,3]");
    h.post("null");
    h.post(JSON.stringify({ v: 1, source: "flipper", type: "event", name: "ready", data: { pad: "x".repeat(600_000) } }));
    await tick();
    assert.equal(h.sent.length, 0);
    assert.equal(h.calls.length, 0);
  });

  it("drops messages from another origin, a sub-frame, or without a URL", async () => {
    const h = harness();
    const msg = { v: 1, source: "flipper", type: "event", name: "ready", data: {} };
    h.post(msg, { url: "https://evil.example/embed" });
    h.post(msg, { url: "https://flipper.family.evil.example/embed" });
    h.post(msg, { url: "http://flipper.family/embed" });
    h.post(msg, { url: "https://flipper.family:8443/embed" });
    h.post(msg, { url: PAGE, isMainFrame: false });
    h.post(msg, { url: null });
    h.post(msg, {});
    await tick();
    assert.equal(h.calls.length, 0);
    assert.equal(h.sent.length, 0);
    assert.ok(h.logs.some((l) => l.includes("another origin")));
    assert.ok(h.logs.some((l) => l.includes("sub-frame")));
  });

  it("accepts the embed origin regardless of path, query, case or default port", async () => {
    const h = harness();
    h.event("ready", {});
    h.post({ v: 1, source: "flipper", type: "event", name: "listing", data: {} }, { url: "HTTPS://Flipper.Family:443/other?x=1#y" });
    await tick();
    assert.deepEqual(
      h.calls.filter(([n]) => n !== "onEvent").map(([n]) => n),
      ["onReady", "onListing"],
    );
  });

  it("ignores unknown message types", async () => {
    const h = harness();
    h.post({ v: 1, source: "flipper", type: "telemetry", payload: 1 });
    await tick();
    assert.equal(h.sent.length + h.calls.length, 0);
  });
});

describe("RPC routing", () => {
  it("forwards allowlisted methods to the wallet and answers with the same id (string and number)", async () => {
    const wallet = new MockProvider();
    const h = harness({ wallet });
    const tx = { from: ACCOUNT, to: "0x0000000000000000000000000000000000000002", data: "0x" };
    h.rpc("f7", "eth_sendTransaction", [tx]);
    h.rpc(42, "eth_chainId");
    await tick();
    assert.deepEqual(wallet.calls[0], { method: "eth_sendTransaction", params: [tx] });
    assert.deepEqual(h.byId("f7"), { v: 1, source: "flipper-host", type: "rpc-result", id: "f7", result: "0x" + "ab".repeat(32) });
    assert.deepEqual(h.byId(42), { v: 1, source: "flipper-host", type: "rpc-result", id: 42, result: "0x1237" });
    assert.equal(h.byId("42"), undefined, "number ids stay numbers");
  });

  it("answers undefined results with null", async () => {
    const wallet = new MockProvider();
    wallet.responses.set("wallet_switchEthereumChain", undefined);
    const h = harness({ wallet });
    h.rpc("s", "wallet_switchEthereumChain", [{ chainId: "0x1237" }]);
    await tick();
    assert.equal(h.byId("s")!.type, "rpc-result");
    assert.equal(h.byId("s")!.result, null);
  });

  it("accepts every bridge method and nothing else", async () => {
    const wallet = new MockProvider();
    const h = harness({ wallet });
    WALLET_METHODS.forEach((m, i) => h.rpc(`ok${i}`, m));
    const denied = ["eth_sign", "eth_signTransaction", "eth_getBalance", "eth_call", "wallet_sendCalls", "ETH_ACCOUNTS", "eth_sendTransaction "];
    denied.forEach((m, i) => h.rpc(`no${i}`, m));
    await tick();
    WALLET_METHODS.forEach((_, i) => assert.equal(h.byId(`ok${i}`)!.type, "rpc-result"));
    denied.forEach((m, i) => assert.deepEqual(h.byId(`no${i}`)!.error, { code: 4200, message: `Unsupported method: ${m}` }));
    assert.equal(wallet.calls.length, WALLET_METHODS.length);
    assert.equal(WALLET_METHODS.length, 7);
  });

  it("refuses message signing (personal_sign, eth_signTypedData_v4) like eth_sign, even if allowedMethods lists it", async () => {
    const wallet = new MockProvider();
    const signing = ["eth_sign", "personal_sign", "eth_signTypedData_v4"];
    const plain = harness({ wallet });
    const opted = harness({ wallet, enableBatchCalls: true, allowedMethods: signing });
    signing.forEach((m, i) => {
      const params = m === "eth_signTypedData_v4" ? [ACCOUNT, "{}"] : ["0x00", ACCOUNT];
      plain.rpc(`a${i}`, m, params);
      opted.rpc(`b${i}`, m, params);
    });
    await tick();
    signing.forEach((m, i) => {
      assert.deepEqual(plain.byId(`a${i}`)!.error, { code: 4200, message: `Unsupported method: ${m}` });
      assert.deepEqual(opted.byId(`b${i}`)!.error, { code: 4200, message: `Unsupported method: ${m}` });
    });
    assert.equal(wallet.calls.length, 0);
    for (const m of signing) assert.equal((BRIDGE_METHODS as readonly string[]).includes(m), false);
  });

  it("narrows the allowlist with allowedMethods (never widens it)", async () => {
    const wallet = new MockProvider();
    const h = harness({ wallet, allowedMethods: ["eth_accounts", "eth_sendTransaction", "eth_sign"] });
    h.rpc(1, "eth_accounts");
    h.rpc(2, "wallet_watchAsset", { type: "ERC20", options: { address: "0x0000000000000000000000000000000000000009", symbol: "FLIPPER", decimals: 18 } });
    h.rpc(3, "eth_sign", [ACCOUNT, "0x00"]);
    await tick();
    assert.equal(h.byId(1)!.type, "rpc-result");
    assert.equal(h.byId(2)!.error.code, 4200);
    assert.equal(h.byId(3)!.error.code, 4200);
    assert.deepEqual(wallet.calls.map((c) => c.method), ["eth_accounts"]);
  });

  it("answers the EIP-5792 batch methods with 4200 by default", async () => {
    const wallet = new MockProvider();
    const h = harness({ wallet });
    BATCH_CALL_METHODS.forEach((m, i) => h.rpc(`b${i}`, m, [{}]));
    await tick();
    BATCH_CALL_METHODS.forEach((m, i) => assert.deepEqual(h.byId(`b${i}`)!.error, { code: 4200, message: `Unsupported method: ${m}` }));
    assert.equal(wallet.calls.length, 0);
  });

  it("forwards the batch methods with enableBatchCalls, and nothing beyond the embed's 10", async () => {
    const wallet = new MockProvider();
    wallet.responses.set("wallet_getCapabilities", { "0x1237": { atomic: { status: "supported" } } });
    wallet.responses.set("wallet_sendCalls", { id: "0xbatch" });
    const h = harness({ wallet, enableBatchCalls: true });
    BRIDGE_METHODS.forEach((m, i) => h.rpc(`ok${i}`, m, [{}]));
    h.rpc("no", "eth_sign", [ACCOUNT, "0x00"]);
    await tick();
    BRIDGE_METHODS.forEach((_, i) => assert.equal(h.byId(`ok${i}`)!.type, "rpc-result"));
    assert.deepEqual(h.byId(`ok${BRIDGE_METHODS.indexOf("wallet_sendCalls")}`)!.result, { id: "0xbatch" });
    assert.equal(h.byId("no")!.error.code, 4200);
    assert.equal(wallet.calls.length, 10);
  });

  it("allowedMethods narrows the batch set too, and can't add batch methods without the flag", async () => {
    const wallet = new MockProvider();
    const narrowed = harness({ wallet, enableBatchCalls: true, allowedMethods: ["eth_sendTransaction", "wallet_getCapabilities"] });
    narrowed.rpc(1, "wallet_getCapabilities", [ACCOUNT]);
    narrowed.rpc(2, "wallet_sendCalls", [{}]);
    const noFlag = harness({ wallet, allowedMethods: ["eth_sendTransaction", "wallet_sendCalls"] });
    noFlag.rpc(3, "wallet_sendCalls", [{}]);
    noFlag.rpc(4, "eth_sendTransaction", [{}]);
    await tick();
    assert.equal(narrowed.byId(1)!.type, "rpc-result");
    assert.equal(narrowed.byId(2)!.error.code, 4200);
    assert.equal(noFlag.byId(3)!.error.code, 4200);
    assert.equal(noFlag.byId(4)!.type, "rpc-result");
    assert.deepEqual(wallet.calls.map((c) => c.method), ["wallet_getCapabilities", "eth_sendTransaction"]);
  });

  it("the batch methods get 4100 without a wallet, once enabled", async () => {
    const h = harness({ wallet: null, enableBatchCalls: true });
    h.rpc(1, "wallet_getCapabilities", [ACCOUNT]);
    await tick();
    assert.deepEqual(h.byId(1)!.error, { code: 4100, message: "No wallet connected." });
  });

  it("validates id, method and params", async () => {
    const h = harness();
    h.post({ v: 1, source: "flipper", type: "rpc", method: "eth_accounts" });
    h.post({ v: 1, source: "flipper", type: "rpc", id: { x: 1 }, method: "eth_accounts" });
    h.post({ v: 1, source: "flipper", type: "rpc", id: null, method: "eth_accounts" });
    h.post({ v: 1, source: "flipper", type: "rpc", id: "m", params: [] });
    h.post({ v: 1, source: "flipper", type: "rpc", id: "p", method: "eth_accounts", params: "0x1" });
    h.post({ v: 1, source: "flipper", type: "rpc", id: "n", method: "eth_accounts", params: null });
    await tick();
    assert.equal(h.sent.length, 3, "messages without a usable id get no answer");
    assert.equal(h.byId("m")!.error.code, -32600);
    assert.equal(h.byId("p")!.error.code, -32602);
    assert.equal(h.byId("n")!.type, "rpc-result");
  });

  it("rejects a duplicate in-flight id but still answers the original", async () => {
    const wallet = new MockProvider();
    wallet.hold.add("eth_sendTransaction");
    const h = harness({ wallet });
    h.rpc("dup", "eth_sendTransaction", [{}]);
    h.rpc("dup", "eth_sendTransaction", [{}]);
    await tick();
    assert.equal(h.sent.length, 1);
    assert.deepEqual(h.sent[0]!.error, { code: -32600, message: "Duplicate request id" });
    wallet.release();
    await tick();
    assert.equal(h.sent.length, 2);
    assert.equal(h.sent[1]!.type, "rpc-result");
    assert.equal(wallet.calls.filter((c) => c.method === "eth_sendTransaction").length, 1);
    // the id can be reused once answered
    wallet.hold.clear();
    h.rpc("dup", "eth_chainId");
    await tick();
    assert.equal(h.sent[2]!.type, "rpc-result");
  });

  it("maps wallet errors to rpc-error (code, message, data)", async () => {
    const wallet = new MockProvider();
    const h = harness({ wallet });
    wallet.failures.set("eth_sendTransaction", { code: 4001, message: "User rejected the request." });
    h.rpc(1, "eth_sendTransaction", [{}]);
    await tick();
    assert.deepEqual(h.byId(1)!.error, { code: 4001, message: "User rejected the request." });

    wallet.failures.set("eth_requestAccounts", new FlipperRpcError(4100, "Locked", { reason: "locked" }));
    h.rpc(2, "eth_requestAccounts", []);
    await tick();
    assert.deepEqual(h.byId(2)!.error, { code: 4100, message: "Locked", data: { reason: "locked" } });

    wallet.failures.set("eth_chainId", new Error("boom"));
    h.rpc(3, "eth_chainId", []);
    await tick();
    assert.deepEqual(h.byId(3)!.error, { code: -32603, message: "boom" });

    // viem-style wrapper: the code lives on the cause; shortMessage preferred
    const wrapped = Object.assign(new Error("long\nmultiline details"), {
      shortMessage: "Unrecognized chain ID",
      cause: { code: 4902, message: "Unrecognized chain ID 0x1237" },
    });
    wallet.failures.set("wallet_switchEthereumChain", wrapped);
    h.rpc(4, "wallet_switchEthereumChain", [{ chainId: "0x1237" }]);
    await tick();
    assert.deepEqual(h.byId(4)!.error, { code: 4902, message: "Unrecognized chain ID" });

    wallet.failures.set("wallet_watchAsset", "plain string rejection");
    h.rpc(5, "wallet_watchAsset", [{}]);
    await tick();
    assert.deepEqual(h.byId(5)!.error, { code: -32603, message: "plain string rejection" });

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    wallet.failures.set("wallet_addEthereumChain", { code: 4001, message: "no", data: cyclic });
    h.rpc(6, "wallet_addEthereumChain", [{}]);
    await tick();
    assert.deepEqual(h.byId(6)!.error, { code: 4001, message: "no" }, "unserializable data is dropped");
  });

  it("answers with -32603 when the wallet result can't be serialized", async () => {
    const wallet = new MockProvider();
    wallet.responses.set("eth_sendTransaction", { gas: 1n });
    const h = harness({ wallet });
    h.rpc("big", "eth_sendTransaction", [{}]);
    await tick();
    assert.equal(h.byId("big")!.type, "rpc-error");
    assert.equal(h.byId("big")!.error.code, -32603);
  });

  it("without a wallet: read-only answers, connect request, 4100 for the rest", async () => {
    const h = harness({ wallet: null });
    h.rpc(1, "eth_accounts");
    h.rpc(2, "eth_chainId");
    h.rpc(3, "eth_requestAccounts");
    h.rpc(4, "eth_sendTransaction", [{}]);
    await tick();
    assert.deepEqual(h.byId(1)!.result, []);
    assert.equal(h.byId(2)!.result, "0x1237");
    assert.equal(h.byId(3)!.error.code, 4100);
    assert.match(h.byId(3)!.error.message, /asked to connect/);
    assert.deepEqual(h.byId(4)!.error, { code: 4100, message: "No wallet connected." });
    assert.deepEqual(h.calls.find(([n]) => n === "onConnectRequest"), ["onConnectRequest", { reason: "connect", partner: null }]);
  });

  it("uses the wallet present at request time", async () => {
    const h = harness({ wallet: null });
    h.rpc(1, "eth_accounts");
    await tick();
    h.wallet.current = new MockProvider();
    h.rpc(2, "eth_accounts");
    await tick();
    assert.deepEqual(h.byId(1)!.result, []);
    assert.deepEqual(h.byId(2)!.result, [ACCOUNT]);
  });

  it("discards answers to requests from a previous page load", async () => {
    const wallet = new MockProvider();
    wallet.hold.add("eth_sendTransaction");
    const h = harness({ wallet });
    h.rpc("old", "eth_sendTransaction", [{}]);
    await tick();
    h.bridge.pageStarted();
    wallet.release();
    await tick();
    assert.equal(h.byId("old"), undefined);
    assert.equal(h.calls.some(([n]) => n === "onRpcSettled"), false);
  });

  it("reports settled RPCs to the host (for wallet state refreshes)", async () => {
    const wallet = new MockProvider();
    wallet.failures.set("wallet_addEthereumChain", { code: 4001, message: "no" });
    const h = harness({ wallet });
    h.rpc(1, "wallet_switchEthereumChain", [{ chainId: "0x1237" }]);
    h.rpc(2, "wallet_addEthereumChain", [{}]);
    await tick();
    const settled = h.calls.filter(([n]) => n === "onRpcSettled").map(([, a]) => a);
    assert.deepEqual(settled, [
      ["wallet_switchEthereumChain", true],
      ["wallet_addEthereumChain", false],
    ]);
  });
});

describe("wallet state and config", () => {
  it("queues wallet state until ready, then sends it; configured chain when disconnected", async () => {
    const h = harness();
    h.bridge.setWalletState({ accounts: [], chainId: null });
    assert.equal(h.sent.length, 0);
    h.event("ready", { version: "1" });
    assert.deepEqual(h.last("wallet"), { v: 1, source: "flipper-host", type: "wallet", accounts: [], chainId: "0x1237" });

    h.bridge.setWalletState({ accounts: [ACCOUNT], chainId: 1 });
    assert.deepEqual(h.last("wallet"), { v: 1, source: "flipper-host", type: "wallet", accounts: [ACCOUNT], chainId: "0x1" });
    const count = h.sent.length;
    h.bridge.setWalletState({ accounts: [ACCOUNT], chainId: 1 });
    assert.equal(h.sent.length, count, "identical state is not re-sent");
  });

  it("coalesces wallet changes before ready into one message", () => {
    const h = harness();
    h.bridge.setWalletState({ accounts: ["0x1"], chainId: 1 });
    h.bridge.setWalletState({ accounts: ["0x2"], chainId: 10 });
    h.bridge.setWalletState({ accounts: [ACCOUNT], chainId: 4663 });
    h.event("ready", {});
    const wallets = h.sent.filter((m) => m.type === "wallet");
    assert.equal(wallets.length, 1);
    assert.deepEqual(wallets[0]!.accounts, [ACCOUNT]);
    assert.equal(wallets[0]!.chainId, "0x1237");
  });

  it("sends hostConfig (rpcUrl / apiUrl / addresses) after every ready, under live changes, even after keepConfig: false", () => {
    const hostConfig = { rpcUrl: "https://rpc.example", addresses: { house: "0x01", lens: "0x02" } };
    const h = harness({ hostConfig });
    h.bridge.setWalletState({ accounts: [ACCOUNT], chainId: 4663 });
    h.event("ready", {});
    assert.deepEqual(h.last("config"), { v: 1, source: "flipper-host", type: "config", ...hostConfig });
    h.bridge.sendConfig({ rpcUrl: "https://rpc2.example", theme: "dark" });
    h.bridge.pageStarted();
    h.event("ready", {});
    assert.deepEqual(h.last("config"), {
      v: 1,
      source: "flipper-host",
      type: "config",
      rpcUrl: "https://rpc2.example",
      addresses: hostConfig.addresses,
      theme: "dark",
    });
    h.bridge.pageStarted({ keepConfig: false });
    h.event("ready", {});
    assert.deepEqual(h.last("config"), { v: 1, source: "flipper-host", type: "config", ...hostConfig }, "no URL carries it");
  });

  it("re-sends wallet state and live config after every ready (reloads)", () => {
    const h = harness();
    h.bridge.setWalletState({ accounts: [ACCOUNT], chainId: 4663 });
    h.bridge.sendConfig({ theme: "light" });
    h.bridge.sendConfig({ accent: "#ff5a1f", theme: "dark" });
    assert.equal(h.sent.length, 0);
    h.event("ready", {});
    assert.deepEqual(h.last("config"), { v: 1, source: "flipper-host", type: "config", theme: "dark", accent: "#ff5a1f" });
    h.bridge.sendConfig({ token: "0x0000000000000000000000000000000000000009" });
    assert.deepEqual(h.last("config"), { v: 1, source: "flipper-host", type: "config", token: "0x0000000000000000000000000000000000000009" });

    h.bridge.pageStarted();
    const before = h.sent.length;
    h.bridge.setWalletState({ accounts: [ACCOUNT], chainId: 1 });
    assert.equal(h.sent.length, before, "nothing is sent to a page that isn't ready");
    h.event("ready", {});
    const after = h.sent.slice(before);
    assert.deepEqual(after.map((m) => m.type), ["wallet", "config"]);
    assert.deepEqual(after[1], {
      v: 1,
      source: "flipper-host",
      type: "config",
      theme: "dark",
      accent: "#ff5a1f",
      token: "0x0000000000000000000000000000000000000009",
    });

    h.bridge.pageStarted({ keepConfig: false });
    h.event("ready", {});
    assert.equal(h.sent.slice(-1)[0]!.type, "wallet", "a fresh URL carries the config itself");
  });

  it("uses the new configured chain when it changes", () => {
    const h = harness();
    h.event("ready", {});
    h.bridge.update({ chainId: 31337 });
    assert.equal(h.last("wallet")!.chainId, "0x7a69");
  });
});

describe("events", () => {
  it("dispatches typed callbacks with the embed's data, plus onEvent for everything", () => {
    const h = harness();
    const settled = {
      flipId: "12",
      account: ACCOUNT,
      token: "0x0000000000000000000000000000000000000009",
      outcome: "won",
      status: "Won",
      won: true,
      pending: false,
      payout: "200",
      native: false,
      partner: "acme",
    };
    const requested = { flipId: "12", txHash: "0x1", symbol: "ETH", native: true };
    const resolved = {
      flipId: "12",
      account: ACCOUNT,
      token: "0x0000000000000000000000000000000000000009",
      symbol: "ETH",
      decimals: 18,
      tokenPaid: "100",
      flipperPaid: "0",
      by: "other",
      native: true,
      txHash: "0x2",
      partner: "acme",
    };
    h.event("ready", { version: "0.1.0", chainId: 4663, account: null, token: null, variant: "card", partner: "acme" });
    h.event("connect-request", { reason: "flip", partner: "acme" });
    h.event("flip-requested", requested);
    h.event("flip-settled", settled);
    h.event("payout-resolved", resolved);
    h.event("listing", { stage: "listed", token: "0x9" });
    h.event("error", { code: "user-rejected", message: "You rejected the request.", context: "flip" });
    h.event("resize", { width: 360, height: 512.2 });
    h.event("brand-new-event", { x: 1 });
    const typed = h.calls.filter(([n]) => n !== "onEvent");
    assert.deepEqual(
      typed.map(([n]) => n),
      ["onReady", "onConnectRequest", "onFlipRequested", "onFlipSettled", "onPayoutResolved", "onListing", "onError", "onResize"],
    );
    assert.deepEqual(typed.find(([n]) => n === "onFlipRequested")![1], requested);
    assert.deepEqual(typed.find(([n]) => n === "onFlipSettled")![1], settled);
    assert.deepEqual(typed.find(([n]) => n === "onPayoutResolved")![1], resolved);
    assert.equal(typed.find(([n]) => n === "onResize")![1], 513);
    const all = h.calls.filter(([n]) => n === "onEvent").map(([, e]) => e as { name: string; rawName?: string });
    assert.equal(all.length, 9);
    assert.deepEqual(all[8], { name: "unknown", rawName: "brand-new-event", data: { x: 1 } });
  });

  it("clamps resize to min/max and ignores invalid heights", () => {
    const h = harness({ minHeight: 200, maxHeight: 700 });
    for (const height of [50, 5000, 480, -1, 0, Number.NaN, "600", null]) h.event("resize", { height });
    h.event("resize");
    const sizes = h.calls.filter(([n]) => n === "onResize").map(([, v]) => v);
    assert.deepEqual(sizes, [200, 700, 480]);
  });

  it("survives a host callback that throws", async () => {
    const h = harness({ throwIn: "onReady" });
    h.event("ready", {});
    h.rpc(1, "eth_accounts");
    await tick();
    assert.equal(h.byId(1)!.type, "rpc-result");
    assert.equal(h.last("wallet")!.type, "wallet");
    assert.ok(h.logs.some((l) => l.includes("onReady handler threw")));
  });

  it("stops after dispose", async () => {
    const h = harness();
    h.bridge.dispose();
    h.event("ready", {});
    h.rpc(1, "eth_accounts");
    await tick();
    assert.equal(h.sent.length + h.calls.length, 0);
  });
});
