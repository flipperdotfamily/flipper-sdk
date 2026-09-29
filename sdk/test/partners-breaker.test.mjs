// Tests for the partner (ERC-8021) and drawdown-breaker surface of @flipperdotfamily/sdk. `pnpm test` bundles src/index.ts
// into .test-dist/sdk first; the client runs against a scripted fake public client (no chain needed).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { concat, encodeFunctionData, encodeFunctionResult, stringToHex } from "viem";
import {
  FlipperError,
  PROTOCOL_LOCKED_MESSAGE,
  RejectCode,
  createFlipperClient,
  describeError,
  flipperHouseAbi,
  isPartnerCode,
  normalizeAddresses,
  rejectReason,
  toFlipperError,
} from "../.test-dist/sdk/index.js";

const HOUSE = "0x1000000000000000000000000000000000000001";
const LENS = "0x2000000000000000000000000000000000000002";
const REGISTRY = "0x3000000000000000000000000000000000000003";
const PLAYER = "0x4000000000000000000000000000000000000004";
const TOKEN = "0x5000000000000000000000000000000000000005";
const MARKER = "80218021802180218021802180218021";

/** the registry's suffixOf, reproduced: code ‖ uint8(len) ‖ uint8(0) ‖ marker */
const suffixOf = (code) => `${stringToHex(code)}${code.length.toString(16).padStart(2, "0")}00${MARKER}`;

/** a viem-like revert error, as toFlipperError walks it */
function revert(errorName, args = []) {
  const inner = Object.assign(new Error("reverted"), { name: "ContractFunctionRevertedError", data: { errorName, args } });
  const outer = Object.assign(new Error("Execution reverted"), { shortMessage: "Execution reverted" });
  outer.walk = (fn) => (fn(outer) ? outer : fn(inner) ? inner : null);
  return outer;
}

/** A fake public client: scripted reads, and a record of every simulate call. */
function fakePublicClient({ registry = REGISTRY } = {}) {
  const calls = { read: [], simulate: [] };
  const preview = { code: 0, sellQuote: 1n, buyQuote: 1n, routeCostBps: 0n, winChanceBps: 4600n, liability: 1n, maxLiability: 10n, randomnessFee: 25_000_000_000_000n };
  return {
    calls,
    chain: { id: 31337 },
    getChainId: async () => 31337,
    getBlock: async () => ({ baseFeePerGas: 35_000_000n, timestamp: 1n }),
    getGasPrice: async () => 35_000_000n,
    estimateMaxPriorityFeePerGas: async () => 0n,
    readContract: async (a) => {
      calls.read.push(a);
      if (a.functionName === "partnerRegistry") return registry;
      if (a.functionName === "suffixOf") return suffixOf(a.args[0]);
      if (a.functionName === "locked") return true;
      if (a.functionName === "navUnits") return 1000n;
      if (a.functionName === "navAth") return 2n * 10n ** 18n;
      if (a.functionName === "lockMinTreasury") return 10n ** 20n;
      if (a.functionName === "unlocker" || a.functionName === "pendingUnlocker") return PLAYER;
      if (a.functionName === "flipPartner") return [1, 250];
      if (a.functionName === "partnerAccrued") return 42n;
      // the edge schedule's base terms now
      if (a.functionName === "currentBaseWinChanceBps") return 4500n;
      if (a.functionName === "currentFlipperPayoutBps") return 20_500n;
      if (a.functionName === "currentKellyBps") return 5000n;
      throw new Error(`unexpected read ${a.functionName}`);
    },
    simulateContract: async (a) => {
      calls.simulate.push(a);
      if (a.functionName === "previewFlip") return { result: preview };
      if (a.functionName === "settleDeferred") throw revert("ProtocolLocked");
      return { result: undefined };
    },
  };
}

const walletClient = { account: { address: PLAYER, type: "json-rpc" }, chain: { id: 31337 } };

describe("reject code 8 and the breaker's errors", () => {
  test("FlipRejected(8) reads as the lock", () => {
    assert.equal(RejectCode.LOCKED, 8);
    const r = rejectReason(8);
    assert.equal(r.key, "LOCKED");
    assert.equal(r.message, PROTOCOL_LOCKED_MESSAGE);
    assert.match(PROTOCOL_LOCKED_MESSAGE, /paused while the treasury is protected/);
    assert.match(PROTOCOL_LOCKED_MESSAGE, /settle after it reopens/);
  });
  test("ProtocolLocked and InsufficientGas map to plain English", () => {
    assert.equal(describeError(revert("ProtocolLocked")), PROTOCOL_LOCKED_MESSAGE);
    const e = toFlipperError(revert("ProtocolLocked"));
    assert.ok(e instanceof FlipperError);
    assert.equal(e.details.errorName, "ProtocolLocked");
    assert.match(describeError(revert("InsufficientGas")), /too little gas/);
    assert.equal(toFlipperError(revert("FlipRejected", [8n])).message, PROTOCOL_LOCKED_MESSAGE);
  });
});

describe("manifest keys", () => {
  test("the new contracts survive normalisation", () => {
    const keys = ["partnerRegistry", "houseModule", "ponsVerifier", "stockVerifier", "auctionConverter", "wethWrapperHook", "weth", "router", "v3Bridge"];
    const raw = Object.fromEntries(keys.map((k, i) => [k, `0x${(i + 1).toString(16).padStart(40, "a")}`]));
    const out = normalizeAddresses({ ...raw, bogus: "0x1", house: "not an address" });
    for (const k of keys) assert.ok(out[k], k);
    assert.equal(out.house, undefined);
    assert.equal(out.bogus, undefined);
  });
});

describe("partner attribution", () => {
  test("codes the registry can hold", () => {
    assert.ok(isPartnerCode("demo"));
    assert.ok(isPartnerCode("acme_casino-2"));
    for (const bad of ["", "Acme", "a.b", "x".repeat(33), null, 7]) assert.equal(isPartnerCode(bad), false, String(bad));
  });

  test("preview carries the suffix, from the player, and the suffix is fetched once", async () => {
    const pc = fakePublicClient();
    const client = createFlipperClient({ publicClient: pc, walletClient, addresses: { house: HOUSE, lens: LENS }, partner: "demo" });
    assert.equal(await client.partnerSuffix(), suffixOf("demo"));
    await client.preview(TOKEN, 10n);
    await client.preview(TOKEN, 20n);
    const sims = pc.calls.simulate.filter((c) => c.functionName === "previewFlip");
    assert.equal(sims.length, 2);
    for (const s of sims) {
      assert.equal(s.dataSuffix, suffixOf("demo"));
      assert.equal(s.account, PLAYER);
    }
    assert.equal(pc.calls.read.filter((r) => r.functionName === "suffixOf").length, 1);
    assert.equal(pc.calls.read.filter((r) => r.functionName === "partnerRegistry").length, 1);
    // what the house sees: flip's calldata, then the suffix (codes ‖ length ‖ schema 0 ‖ marker)
    const data = concat([encodeFunctionData({ abi: flipperHouseAbi, functionName: "previewFlip", args: [TOKEN, 10n] }), suffixOf("demo")]);
    assert.ok(data.endsWith(`64656d6f0400${MARKER}`), data.slice(-44)); // "demo" ‖ 4 ‖ 0 ‖ marker
  });

  test("no partner, an invalid code, or no registry: nothing is appended", async () => {
    for (const [partner, registry] of [[undefined, REGISTRY], ["Not Valid", REGISTRY], ["demo", "0x0000000000000000000000000000000000000000"]]) {
      const pc = fakePublicClient({ registry });
      const client = createFlipperClient({ publicClient: pc, walletClient, addresses: { house: HOUSE, lens: LENS }, partner });
      await client.preview(TOKEN, 10n);
      const [s] = pc.calls.simulate;
      assert.equal(s.dataSuffix, undefined, `${partner} / ${registry}`);
    }
  });

  test("house partner views", async () => {
    const pc = fakePublicClient();
    const client = createFlipperClient({ publicClient: pc, addresses: { house: HOUSE, lens: LENS } });
    assert.deepEqual(await client.flipPartner(7n), { partnerId: 1n, shareBps: 250 });
    assert.equal(await client.partnerAccrued(1n), 42n);
  });
});

describe("drawdown breaker", () => {
  test("breaker() and locked()", async () => {
    const client = createFlipperClient({ publicClient: fakePublicClient(), addresses: { house: HOUSE, lens: LENS } });
    assert.equal(await client.locked(), true);
    const b = await client.breaker();
    assert.equal(b.locked, true);
    assert.equal(b.navAth, 2n * 10n ** 18n);
    assert.equal(b.unlocker, PLAYER);
  });
  test("canSettleDeferred reports the lock", async () => {
    const client = createFlipperClient({ publicClient: fakePublicClient(), walletClient, addresses: { house: HOUSE, lens: LENS } });
    const r = await client.canSettleDeferred(3n);
    assert.equal(r.ok, false);
    assert.equal(r.locked, true);
    assert.equal(r.reason, PROTOCOL_LOCKED_MESSAGE);
  });
});

// ── Kelly-capped max stake, the older Params layouts, the ATH reset, the team stake ───────────────────────────

const PARAMS = {
  baseWinChanceBps: 4500, minWinChanceBps: 4000, flipperPayoutBps: 20500, minHouseEdgeBps: 200, maxRouteCostBps: 1000,
  lossSlippageBps: 500, maxBetBps: 500, rewardsShareBps: 5000, listingMaxRouteCostBps: 400, listingProbeBps: 100,
  callbackGasLimit: 900000, swapGasLimit: 500000, guardianCancelDelay: 604800, playerCancelDelay: 604800,
  minListingProbe: 10n ** 18n, flipperCallbackGasLimit: 250000, pendingTimeout: 86400, maxReservedBps: 3000, kellyBps: 5000,
};
/** the house ABI with its Params tuple cut to an older layout */
function olderAbi(drop) {
  return flipperHouseAbi.map((x) =>
    x.type === "function" && x.name === "params"
      ? { ...x, outputs: [{ ...x.outputs[0], components: x.outputs[0].components.filter((c) => !drop.includes(c.name)) }] }
      : x,
  );
}
const paramsData = (drop = []) => {
  const values = Object.fromEntries(Object.entries(PARAMS).filter(([k]) => !drop.includes(k)));
  return encodeFunctionResult({ abi: olderAbi(drop), functionName: "params", result: values });
};

describe("Params layouts", () => {
  for (const [label, drop, expect] of [
    ["current (kellyBps)", [], { maxReservedBps: 3000, kellyBps: 5000 }],
    ["before the Kelly cap", ["kellyBps"], { maxReservedBps: 3000, kellyBps: 0 }],
    ["before maxReservedBps", ["kellyBps", "maxReservedBps"], { maxReservedBps: 0, kellyBps: 0 }],
  ]) {
    test(label, async () => {
      const pc = { ...fakePublicClient(), call: async () => ({ data: paramsData(drop) }) };
      const p = await createFlipperClient({ publicClient: pc, addresses: { house: HOUSE, lens: LENS } }).params();
      assert.equal(p.baseWinChanceBps, 4500);
      assert.equal(p.pendingTimeout, 86400);
      assert.equal(p.maxReservedBps, expect.maxReservedBps);
      assert.equal(p.kellyBps, expect.kellyBps);
    });
  }
});

describe("maxStake: each flip's max is sized to its own edge", () => {
  // the house accepts up to CAP (its Kelly cap at this flip's odds), BET_SIZE (7) above
  const CAP = 3_000n;
  const pv = (amount) => ({ code: amount <= CAP ? 0 : 7, sellQuote: amount, buyQuote: amount, routeCostBps: 0n, winChanceBps: 4600n, liability: amount, maxLiability: CAP, randomnessFee: 1n });
  function sizingClient(partner) {
    const pc = fakePublicClient();
    pc.getBlockNumber = async () => 1n;
    pc.call = async () => ({ data: paramsData() });
    pc.readContract = ((read) => async (a) => (a.functionName === "flipper" ? PLAYER : read(a)))(pc.readContract);
    pc.simulateContract = async (a) => {
      pc.calls.simulate.push(a);
      if (a.functionName === "previewFlip") return { result: pv(a.args[1]) };
      if (a.functionName === "previews") return { result: a.args[2].map(pv) };
      throw new Error(`unexpected simulate ${a.functionName}`);
    };
    return { pc, client: createFlipperClient({ publicClient: pc, walletClient, addresses: { house: HOUSE, lens: LENS }, partner }) };
  }
  test("found by previewing (never from the house view), within the search's precision", async () => {
    const { pc, client } = sizingClient(undefined);
    const { amount, preview } = await client.maxStake(TOKEN, 100_000n);
    assert.ok(amount <= CAP && amount >= (CAP * 90n) / 100n, String(amount));
    assert.equal(preview.code, 0);
    assert.ok(pc.calls.simulate.every((c) => c.functionName === "previews"), "lens previews without a partner");
  });
  test("with a partner, every preview carries the suffix, from the player", async () => {
    const { pc, client } = sizingClient("demo");
    const { amount } = await client.maxStake(TOKEN, 100_000n);
    assert.ok(amount <= CAP && amount >= (CAP * 90n) / 100n, String(amount));
    const sims = pc.calls.simulate;
    assert.ok(sims.length > 0 && sims.every((c) => c.functionName === "previewFlip" && c.dataSuffix === suffixOf("demo") && c.account === PLAYER));
  });
});

describe("payout multiple", () => {
  test("2.05× (and 2,05× where the locale writes a decimal comma)", async () => {
    const { formatMultiple } = await import("../.test-dist/sdk/index.js");
    assert.equal(formatMultiple(20_500), "2.05×");
    assert.equal(formatMultiple(20_000), "2×");
    assert.equal(formatMultiple(20_500, "en"), "2.05×");
    assert.equal(formatMultiple(20_500, "es"), "2,05×");
    assert.equal(formatMultiple(21_000, "es-MX"), "2.1×".replace(".", Intl.NumberFormat("es-MX").format(1.5).includes(",") ? "," : "."));
  });
});

describe("breaker admin and the team stake", () => {
  test("AthOutOfBounds reads as plain English", () => {
    assert.match(describeError(revert("AthOutOfBounds", [1n, 2n, 3n])), /out of bounds.*Pass 0/);
  });
  test("teamStake(), and excess withdrawals only from the dev address", async () => {
    const LOCK = "0x6000000000000000000000000000000000000006";
    const DEV = "0x7000000000000000000000000000000000000007";
    const reads = { principal: 1000n, value: 1200n, withdrawableExcess: 200n, pendingVaultRewards: 3n, pendingHolderRewards: 4n, devAddress: DEV, pendingWithdrawal: [50n, 60n, 99n] };
    const pc = fakePublicClient();
    pc.readContract = async (a) => (a.functionName in reads ? reads[a.functionName] : Promise.reject(new Error(a.functionName)));
    const none = await createFlipperClient({ publicClient: pc, addresses: { house: HOUSE, lens: LENS } }).teamStake();
    assert.equal(none, null);
    const client = createFlipperClient({ publicClient: pc, walletClient, addresses: { house: HOUSE, lens: LENS, principalLock: LOCK } });
    assert.deepEqual(await client.teamStake(), {
      lock: LOCK, principal: 1000n, value: 1200n, withdrawableExcess: 200n, pendingVaultRewards: 3n, pendingHolderRewards: 4n,
      devAddress: DEV, pendingRequest: { shares: 50n, assets: 60n, readyAt: 99n },
      // 200 excess − 60 queued − 10 cushion (1% of the principal)
      requestableExcess: 130n,
    });
    reads.pendingWithdrawal = [0n, 0n, 0n];
    assert.equal((await client.teamStake()).pendingRequest, null);
    // the connected player isn't the dev address: a friendly error, before any transaction
    await assert.rejects(client.requestTeamExcess(10n), /Only the team's dev address/);
    await assert.rejects(client.withdrawTeamExcess(), /Only the team's dev address/);
    await assert.rejects(client.cancelTeamExcess(), /Only the team's dev address/);
    assert.equal(pc.calls.simulate.length, 0);
  });
  test("the lock's errors read as plain English", () => {
    assert.match(describeError(revert("PrincipalBreach", [1n, 2n])), /below its locked principal/);
    assert.match(describeError(revert("ExceedsExcess", [10n ** 18n, 2n * 10n ** 18n])), /withdrawable excess \(2 \$FLIPPER/);
  });
  test("principalLock survives manifest normalisation", () => {
    assert.ok(normalizeAddresses({ principalLock: "0x6000000000000000000000000000000000000006" }).principalLock);
  });
});
