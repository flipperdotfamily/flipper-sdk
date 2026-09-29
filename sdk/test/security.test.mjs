// Off-chain stress-test fixes in @flipperdotfamily/sdk: W2 (add-chain RPC), W5 (URL schemes), W6 (pinned deployments),
// W9 (prototype-keyed lookups). `pnpm test` bundles src/index.ts into .test-dist/sdk first.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  CANONICAL_DEPLOYMENTS,
  DeploymentError,
  PUBLIC_RPC_URLS,
  fetchDeploymentManifest,
  flipperChain,
  parseChainId,
  resolveDeployment,
  safeHttpUrl,
  switchWalletChain,
} from "../.test-dist/sdk/index.js";

const HOUSE = "0x1000000000000000000000000000000000000001";
const LENS = "0x2000000000000000000000000000000000000002";
const EVIL = "0x6666666666666666666666666666666666666666";
let n = 0;
/** a manifest served by a fake fetch, at a fresh URL each time (the fetcher caches per URL) */
function served(deployments, def = 4663) {
  const url = `https://example.test/manifest-${++n}.json`;
  const fetch = async () => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify({ v: 1, default: def, deployments })) });
  return { url, fetch };
}
const dep = (chainId, extra = {}) => ({ chainId, name: "Robinhood Chain", rpcUrl: "https://rpc.example", addresses: { house: HOUSE, lens: LENS }, ...extra });
/** runs fn with CANONICAL_DEPLOYMENTS[chainId] set to pin (undefined = unpinned), then restores the release's pin */
async function withPin(chainId, pin, fn) {
  const had = Object.hasOwn(CANONICAL_DEPLOYMENTS, chainId), saved = CANONICAL_DEPLOYMENTS[chainId];
  if (pin) CANONICAL_DEPLOYMENTS[chainId] = pin;
  else delete CANONICAL_DEPLOYMENTS[chainId];
  try {
    return await fn();
  } finally {
    if (had) CANONICAL_DEPLOYMENTS[chainId] = saved;
    else delete CANONICAL_DEPLOYMENTS[chainId];
  }
}

describe("W9: lookups keyed by user input", () => {
  test("chain aliases are own keys only", () => {
    for (const bad of ["__proto__", "constructor", "toString", "hasOwnProperty"]) assert.equal(parseChainId(bad), undefined, bad);
    assert.equal(parseChainId("robinhood"), 4663);
    assert.equal(parseChainId("0x1237"), 4663);
  });
});

describe("W5: URL schemes", () => {
  test("safeHttpUrl", () => {
    for (const ok of ["https://explorer.example", "http://localhost:8545", "http://127.0.0.1:3000/x", "http://[::1]:1"]) assert.equal(safeHttpUrl(ok), ok);
    for (const bad of ["javascript:alert(1)//", "data:text/html,x", "http://evil.example", "ftp://x", "//x", "", null, 3, "https://" + "a".repeat(3000)]) {
      assert.equal(safeHttpUrl(bad), undefined, String(bad).slice(0, 40));
    }
  });
  test("a fetched manifest loses unsafe endpoints and links", async () => {
    const { url, fetch } = served({ 4663: dep(4663, { rpcUrl: "javascript:x", apiUrl: "http://evil.example", explorerUrl: "javascript:alert(document.domain)//" }) });
    const m = await fetchDeploymentManifest(url, { fetch });
    const d = m.deployments["4663"];
    assert.equal(d.explorerUrl, undefined);
    assert.equal(d.apiUrl, undefined);
    assert.equal(d.rpcUrl, undefined);
    // resolveDeployment then falls back to the chain's public RPC
    const r = await withPin(4663, undefined, () => resolveDeployment({ chainId: 4663, deploymentUrl: url, fetch }));
    assert.equal(r.rpcUrl, PUBLIC_RPC_URLS[4663]);
  });
  test("flipperChain never links a non-https explorer", () => {
    const c = flipperChain({ chainId: 4663, name: "Robinhood Chain", rpcUrl: "https://rpc.example", explorerUrl: "javascript:alert(1)//" });
    assert.equal(c.blockExplorers, undefined);
  });
});

describe("W6: pinned canonical deployments", () => {
  test("a manifest that disagrees with the pin is refused, unless the integrator opts out", async () => {
    await withPin(4663, { house: HOUSE, lens: LENS }, async () => {
      const good = served({ 4663: dep(4663) });
      assert.equal((await resolveDeployment({ chainId: 4663, deploymentUrl: good.url, fetch: good.fetch })).addresses.house, HOUSE);

      const bad = served({ 4663: dep(4663, { addresses: { house: EVIL, lens: LENS } }) });
      await assert.rejects(resolveDeployment({ chainId: 4663, deploymentUrl: bad.url, fetch: bad.fetch }), (e) => e instanceof DeploymentError && /isn't flipper's canonical house/.test(e.message));

      const badLens = served({ 4663: dep(4663, { addresses: { house: HOUSE, lens: EVIL } }) });
      await assert.rejects(resolveDeployment({ chainId: 4663, deploymentUrl: badLens.url, fetch: badLens.fetch }), /canonical lens/);

      const own = await resolveDeployment({ chainId: 4663, deploymentUrl: bad.url, fetch: bad.fetch, allowUnpinnedDeployment: true });
      assert.equal(own.addresses.house.toLowerCase(), EVIL);
    });
  });
  test("the local fork (31337) is never pinned; only Robinhood Chain is (at release, by contracts/script/pin-sdk.py)", async () => {
    assert.ok(Object.keys(CANONICAL_DEPLOYMENTS).every((k) => k === "4663"));
    const local = served({ 31337: dep(31337, { name: "Local", addresses: { house: EVIL, lens: EVIL } }) }, 31337);
    assert.equal((await resolveDeployment({ chainId: 31337, deploymentUrl: local.url, fetch: local.fetch })).addresses.house.toLowerCase(), EVIL);
  });
});

describe("W2: wallet_addEthereumChain uses the hard-coded public RPC", () => {
  function wallet() {
    const calls = [];
    let switched = false;
    return {
      calls,
      request: async ({ method, params }) => {
        calls.push({ method, params });
        if (method === "wallet_switchEthereumChain" && !switched) {
          switched = true;
          throw Object.assign(new Error("Unrecognized chain"), { code: 4902 });
        }
        return null;
      },
    };
  }
  test("an overridden read RPC never reaches the wallet", async () => {
    const w = wallet();
    const chain = flipperChain({ chainId: 4663, name: "Robinhood Chain", rpcUrl: "https://evil.example/rpc", explorerUrl: "https://evil.example" });
    await switchWalletChain(w, chain);
    const add = w.calls.find((c) => c.method === "wallet_addEthereumChain");
    assert.deepEqual(add.params[0].rpcUrls, ["https://rpc.mainnet.chain.robinhood.com"]);
    assert.deepEqual(add.params[0].blockExplorerUrls, ["https://robinhoodchain.blockscout.com"]);
    assert.equal(add.params[0].chainId, "0x1237");
  });
  test("a chain without a hard-coded RPC isn't added at all", async () => {
    const w = wallet();
    const chain = flipperChain({ chainId: 999_999, name: "Some chain", rpcUrl: "https://evil.example/rpc" });
    await assert.rejects(switchWalletChain(w, chain), /Add Some chain/);
    assert.equal(w.calls.filter((c) => c.method === "wallet_addEthereumChain").length, 0);
  });
});
