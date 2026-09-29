// Flip limits (reject codes 2 and 9, minLiability / minStake), the claimable-ETH refund, the lens surplus and the
// team stake's MAX cushion. `pnpm test` bundles src/index.ts into .test-dist/sdk; the client runs against fakes.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decodeFunctionData, encodeFunctionResult, maxUint256, zeroAddress } from "viem";
import {
  BELOW_MIN_SIZE_MESSAGE,
  DEFAULT_MAX_OPEN_PER_PLAYER,
  RejectCode,
  TEAM_EXCESS_CUSHION_BPS,
  TOO_MANY_OPEN_MESSAGE,
  createFlipperClient,
  describeError,
  estimateMinStake,
  flipperHouseAbi,
  rejectReason,
  teamExcessMax,
  toFlipperError,
} from "../.test-dist/sdk/index.js";

const HOUSE = "0x1000000000000000000000000000000000000001";
const LENS = "0x2000000000000000000000000000000000000002";
const LOCK = "0x3000000000000000000000000000000000000003";
const PLAYER = "0x4000000000000000000000000000000000000004";
const TOKEN = "0x5000000000000000000000000000000000000005";
const FLIPPER = "0x6000000000000000000000000000000000000006";
const E18 = 10n ** 18n;
const MIN_LIABILITY = 50_000n * E18;

/** the edge schedule's views (a house from before it has none) */
const EDGE_VIEWS = ["currentBaseWinChanceBps", "currentFlipperPayoutBps", "currentKellyBps", "edgeProgress", "edgeSchedule"];

function revert(errorName, args = []) {
  const inner = Object.assign(new Error("reverted"), { name: "ContractFunctionRevertedError", data: { errorName, args } });
  const outer = Object.assign(new Error("Execution reverted"), { shortMessage: "Execution reverted" });
  outer.walk = (fn) => (fn(outer) ? outer : fn(inner) ? inner : null);
  return outer;
}

/**
 * A fake public client. `liabilityOf(amount)` prices a TOKEN preview's liability; `reads` overrides contract reads by
 * function name (a function, or a value); `old: true` makes the new house views revert, like a house from before them.
 */
function fakePublicClient({ liabilityOf = (a) => a * 2n, reads = {}, old = false } = {}) {
  const calls = { read: [], simulate: [] };
  const base = {
    currentBaseWinChanceBps: 4500n,
    currentFlipperPayoutBps: 20_500n,
    currentKellyBps: 5000n,
    maxOpenPerPlayer: 0,
    minLiability: MIN_LIABILITY,
    openFlips: 3n,
    flipper: FLIPPER,
    partnerRegistry: zeroAddress,
    decimals: 18,
    name: "Token",
    symbol: "TKN",
    claimables: (a) => a.args[2].map((t) => (t === zeroAddress ? 7n : 1n)),
    claimable: (a) => (a.args[1] === zeroAddress ? 7n : 0n),
    surplus: 0n,
    devAddress: PLAYER,
    principal: 1_000_000n * E18,
    value: 1_030_000n * E18,
    withdrawableExcess: 30_000n * E18,
    pendingVaultRewards: 0n,
    pendingHolderRewards: 0n,
    pendingWithdrawal: [0n, 0n, 0n],
    ...reads,
  };
  return {
    calls,
    chain: { id: 31337 },
    getChainId: async () => 31337,
    getBlock: async () => ({ baseFeePerGas: 30_000_000n, timestamp: 1n }),
    getGasPrice: async () => 30_000_000n,
    estimateMaxPriorityFeePerGas: async () => 0n,
    // params() is a raw eth_call (it also decodes an older, shorter tuple)
    call: async ({ data }) => {
      const { functionName } = decodeFunctionData({ abi: flipperHouseAbi, data });
      assert.equal(functionName, "params");
      const fields = flipperHouseAbi.find((x) => x.name === "params").outputs[0].components;
      const params = Object.fromEntries(fields.map((f) => [f.name, f.name === "flipperPayoutBps" ? 20_500n : 0n]));
      return { data: encodeFunctionResult({ abi: flipperHouseAbi, functionName: "params", result: params }) };
    },
    readContract: async (a) => {
      calls.read.push(a);
      if (old && ["maxOpenPerPlayer", "minLiability", "openFlips", ...EDGE_VIEWS].includes(a.functionName)) throw revert(undefined);
      if (!(a.functionName in base)) throw new Error(`unexpected read ${a.functionName}`);
      const v = base[a.functionName];
      return typeof v === "function" ? v(a) : v;
    },
    simulateContract: async (a) => {
      calls.simulate.push(a);
      if (a.functionName === "previewFlip") {
        const liability = liabilityOf(a.args[1]);
        const code = liability === 0n ? RejectCode.QUOTE : liability < MIN_LIABILITY ? RejectCode.AMOUNT : RejectCode.OK;
        return { result: { code, sellQuote: 1n, buyQuote: 1n, routeCostBps: 0n, winChanceBps: 4600n, liability, maxLiability: 10n ** 30n, randomnessFee: 1n } };
      }
      if (a.functionName === "requestExcess") throw revert("PrincipalBreach", [0n, 0n]);
      throw new Error(`unexpected simulate ${a.functionName}`);
    },
  };
}

const walletClient = { account: { address: PLAYER, type: "json-rpc" }, chain: { id: 31337 } };
const make = (pc, extra = {}) => createFlipperClient({ publicClient: pc, addresses: { house: HOUSE, lens: LENS, flipper: FLIPPER, principalLock: LOCK }, ...extra });

describe("reject codes 2 and 9", () => {
  test("code 9: too many flips in progress", () => {
    assert.equal(RejectCode.TOO_MANY_OPEN, 9);
    const r = rejectReason(9);
    assert.equal(r.key, "TOO_MANY_OPEN");
    assert.equal(r.message, TOO_MANY_OPEN_MESSAGE);
    assert.equal(TOO_MANY_OPEN_MESSAGE, "You have too many flips in progress. Wait for one to land.");
    assert.equal(describeError(revert("FlipRejected", [9n])), TOO_MANY_OPEN_MESSAGE);
    const e = toFlipperError(revert("FlipRejected", [9n]));
    assert.equal(e.kind, "rejected");
    assert.equal(e.details.code, 9);
  });

  test("code 2: zero reads as 'enter an amount', anything else as below the minimum", () => {
    assert.equal(rejectReason(2, { amount: 0n }).title, "Enter an amount");
    const r = rejectReason(2, { amount: 5n });
    assert.equal(r.key, "BELOW_MIN");
    assert.equal(r.message, BELOW_MIN_SIZE_MESSAGE);
    assert.equal(BELOW_MIN_SIZE_MESSAGE, "This flip is below the minimum size.");
    assert.equal(rejectReason(2).key, "BELOW_MIN", "a flip that reverts with code 2 had a stake");
    const named = rejectReason(2, { amount: 5n, minStake: 24_391n * E18, decimals: 18, symbol: "FLIPPER" });
    assert.match(named.message, /^This flip is below the minimum size\. The minimum is 24,391 FLIPPER\.$/);
    assert.equal(describeError(revert("FlipRejected", [2n])), BELOW_MIN_SIZE_MESSAGE);
  });
});

describe("flip limits", () => {
  test("maxOpenPerPlayer 0 reads as the default; minLiability and openFlips come through", async () => {
    const client = make(fakePublicClient());
    assert.deepEqual(await client.flipLimits(), { maxOpenPerPlayer: DEFAULT_MAX_OPEN_PER_PLAYER, minLiability: MIN_LIABILITY });
    assert.equal(DEFAULT_MAX_OPEN_PER_PLAYER, 4);
    assert.equal(await client.openFlips(PLAYER), 3);
    const custom = make(fakePublicClient({ reads: { maxOpenPerPlayer: 2 } }));
    assert.equal((await custom.flipLimits()).maxOpenPerPlayer, 2);
  });

  test("a house from before the limits: the default cap, no floor, nothing open", async () => {
    const client = make(fakePublicClient({ old: true }));
    assert.deepEqual(await client.flipLimits(), { maxOpenPerPlayer: DEFAULT_MAX_OPEN_PER_PLAYER, minLiability: 0n });
    assert.equal(await client.openFlips(PLAYER), 0);
    assert.equal(await client.minStake(TOKEN), 0n);
  });

  test("previews run from the connected player, so code 9 shows before the flip", async () => {
    const pc = fakePublicClient();
    const client = make(pc, { walletClient });
    await client.preview(TOKEN, 10n ** 24n);
    const sim = pc.calls.simulate.find((c) => c.functionName === "previewFlip");
    assert.equal(sim.account, PLAYER);
    assert.equal(sim.stateOverride?.[0]?.address, PLAYER, "the balance override follows the sender");
  });
});

describe("minStake", () => {
  const fees = { maxFeePerGas: 50_000_000n, maxPriorityFeePerGas: 0n };

  test("estimateMinStake extrapolates and rounds up", () => {
    assert.equal(estimateMinStake(10n, 4n, 10n), 25n);
    assert.equal(estimateMinStake(10n, 3n, 10n), 34n);
    assert.equal(estimateMinStake(10n, 0n, 10n), 0n);
  });

  for (const [name, liabilityOf] of [
    ["linear", (a) => (a * 3n) / 2n],
    ["convex (price impact)", (a) => (a * 3n) / 2n + (a * a) / (10n ** 24n)],
    ["worth more than the floor at one token", (a) => a * 100_000n],
  ]) {
    test(`a route-priced token (${name}) clears the floor, and a bit less doesn't`, async () => {
      const pc = fakePublicClient({ liabilityOf });
      const client = make(pc, { walletClient });
      const m = await client.minStake(TOKEN, fees);
      assert.ok(m > 0n);
      assert.ok(liabilityOf(m) >= MIN_LIABILITY, `${m}`);
      const lower = (m * 99n) / 100n;
      assert.ok(liabilityOf(lower) < MIN_LIABILITY, `${lower} is also accepted: not near the minimum`);
      assert.ok(pc.calls.simulate.length <= 4, `${pc.calls.simulate.length} previews`);
    });
  }

  test("$FLIPPER is exact: liability = stake × (2.05× − 1×) = 1.05 × stake", async () => {
    const m = await make(fakePublicClient()).minStake(FLIPPER, fees);
    // the house's own rounding: liability = ceil(stake × (20500 − 10000) / 10000)
    const liability = (s) => (s * 10_500n + 9_999n) / 10_000n;
    assert.equal(m, (MIN_LIABILITY * 10_000n + 10_499n) / 10_500n); // ≈ 47,619 $FLIPPER
    assert.ok(liability(m) >= MIN_LIABILITY);
    assert.ok(liability(m - 10n ** 15n) < MIN_LIABILITY);
  });

  test("an unpriceable token: null; no floor: 0n", async () => {
    assert.equal(await make(fakePublicClient({ liabilityOf: () => 0n })).minStake(TOKEN, fees), null);
    assert.equal(await make(fakePublicClient({ reads: { minLiability: 0n } })).minStake(TOKEN, fees), 0n);
  });
});

describe("claimable ETH (a fee refund the house couldn't push)", () => {
  test("claimables lists ETH last, flagged native; { eth: false } leaves it out", async () => {
    const pc = fakePublicClient();
    const client = make(pc);
    const all = await client.claimables(PLAYER, [TOKEN]);
    assert.deepEqual(all, [
      { token: TOKEN, amount: 1n },
      { token: zeroAddress, amount: 7n, native: true },
    ]);
    const lensCall = pc.calls.read.find((r) => r.functionName === "claimables");
    assert.deepEqual(lensCall.args[2], [TOKEN, zeroAddress]);
    assert.deepEqual(await client.claimables(PLAYER, [TOKEN], { eth: false }), [{ token: TOKEN, amount: 1n }]);
    assert.deepEqual(await client.claimables(PLAYER, []), [{ token: zeroAddress, amount: 7n, native: true }], "ETH even with no tokens");
    assert.equal(await client.claimableEth(PLAYER), 7n);
  });

  test("surplus reads the lens", async () => {
    const pc = fakePublicClient({ reads: { surplus: -3n } });
    assert.equal(await make(pc).surplus(zeroAddress), -3n);
    const call = pc.calls.read.find((r) => r.functionName === "surplus");
    assert.deepEqual(call.args, [HOUSE, zeroAddress]);
    assert.equal(call.address, LENS);
  });
});

describe("team stake: MAX leaves a 1% cushion", () => {
  test("teamExcessMax: excess − queued − 1% × principal, never negative", () => {
    assert.equal(TEAM_EXCESS_CUSHION_BPS, 100n);
    assert.equal(teamExcessMax(1_000n, 30n, 0n), 20n);
    assert.equal(teamExcessMax(1_000n, 30n, 5n), 15n);
    assert.equal(teamExcessMax(1_000n, 8n, 0n), 0n);
    assert.equal(teamExcessMax(1_000n, 30n, 0n, 0n), 30n);
  });

  test("teamStake reports requestableExcess", async () => {
    const stake = await make(fakePublicClient({ reads: { pendingWithdrawal: [1n, 5_000n * E18, 99n] } })).teamStake();
    // 30,000 excess − 5,000 queued − 10,000 cushion (1% of 1,000,000)
    assert.equal(stake.requestableExcess, 15_000n * E18);
  });

  test("requestTeamExcess('max') and maxUint256 request the cushioned amount", async () => {
    for (const amount of ["max", maxUint256]) {
      const pc = fakePublicClient();
      await assert.rejects(make(pc, { walletClient }).requestTeamExcess(amount));
      const sim = pc.calls.simulate.find((c) => c.functionName === "requestExcess");
      assert.deepEqual(sim.args, [20_000n * E18], String(amount));
    }
  });

  test("cushionBps: 0n with maxUint256 sends the contract's own 'everything'; an explicit amount is sent as is", async () => {
    let pc = fakePublicClient();
    await assert.rejects(make(pc, { walletClient }).requestTeamExcess(maxUint256, { cushionBps: 0n }));
    assert.deepEqual(pc.calls.simulate.find((c) => c.functionName === "requestExcess").args, [maxUint256]);
    pc = fakePublicClient();
    await assert.rejects(make(pc, { walletClient }).requestTeamExcess(123n));
    assert.deepEqual(pc.calls.simulate.find((c) => c.functionName === "requestExcess").args, [123n]);
  });

  test("nothing above the cushion: a plain error before anything is sent", async () => {
    const pc = fakePublicClient({ reads: { withdrawableExcess: 9_000n * E18 } });
    await assert.rejects(make(pc, { walletClient }).requestTeamExcess("max"), /nothing to withdraw yet/);
    assert.equal(pc.calls.simulate.length, 0);
  });

  test("PrincipalBreach suggests leaving a cushion", () => {
    assert.match(describeError(revert("PrincipalBreach", [0n, 0n])), /leaving a cushion/);
  });
});

describe("the edge schedule: base terms now, and its progress", () => {
  const ETH = E18;
  // halfway from 10 to 350 ETH: 46.25% and 2.025×
  const progressReads = {
    currentBaseWinChanceBps: 4625n,
    currentFlipperPayoutBps: 20_250n,
    currentKellyBps: 4000n,
    edgeProgress: [150n * ETH, 180n * ETH, 10n * ETH, 350n * ETH, 4625n, 20_250n],
    edgeSchedule: [10n * ETH, 350n * ETH, 4500, 4750, 20_500, 20_000],
  };

  test("baseTerms reads the current views", async () => {
    assert.deepEqual(await make(fakePublicClient({ reads: progressReads })).baseTerms(), {
      baseWinChanceBps: 4625,
      flipperPayoutBps: 20_250,
      kellyBps: 4000,
      scheduled: true,
    });
  });

  test("a house from before the schedule answers from params()", async () => {
    const terms = await make(fakePublicClient({ old: true })).baseTerms();
    assert.deepEqual(terms, { baseWinChanceBps: 0, flipperPayoutBps: 20_500, kellyBps: 0, scheduled: false });
    assert.equal(await make(fakePublicClient({ old: true })).edgeProgress(), null);
  });

  test("minStake prices $FLIPPER at the payout now", async () => {
    // 2.0×: liability = stake × 1.0, so the minimum stake is the minimum liability
    const m = await make(fakePublicClient({ reads: { currentFlipperPayoutBps: 20_000n } })).minStake(FLIPPER, { maxFeePerGas: 1n, maxPriorityFeePerGas: 0n });
    assert.equal(m, MIN_LIABILITY);
  });

  test("edgeProgress: the ratcheted high, the endpoints, progress and the edges", async () => {
    const e = await make(fakePublicClient({ reads: progressReads })).edgeProgress();
    assert.equal(e.buybackHigh, 180n * ETH);
    assert.equal(e.netBuybackEth, 150n * ETH);
    assert.equal(e.progress, 0.5);
    assert.deepEqual([e.winStartBps, e.winEndBps, e.payoutStartBps, e.payoutEndBps], [4500, 4750, 20_500, 20_000]);
    assert.equal(e.tokenEdgeBps, 750); // 1 − 2 × 46.25%
    assert.equal(e.flipperEdgeBps, 634); // 1 − 46.25% × 2.025, rounded as the house rounds it
    const before = await make(fakePublicClient({ reads: { ...progressReads, edgeProgress: [-2n * ETH, 3n * ETH, 10n * ETH, 350n * ETH, 4500n, 20_500n] } })).edgeProgress();
    assert.equal(before.progress, 0);
    const off = await make(fakePublicClient({ reads: { ...progressReads, edgeProgress: [0n, 0n, 0n, 0n, 4500n, 20_500n] } })).edgeProgress();
    assert.equal(off, null, "toEth 0: the schedule is off");
  });

  test("formatting never shows more than the house gives", async () => {
    const { formatMultiple, formatWinChance, houseEdgeBps } = await import("../.test-dist/sdk/index.js");
    assert.equal(formatWinChance(4500), "45%");
    assert.equal(formatWinChance(4625), "46.25%");
    assert.equal(formatWinChance(4650), "46.5%");
    assert.equal(formatMultiple(20_389), "2.038×");
    assert.equal(formatMultiple(20_250), "2.025×");
    assert.equal(formatMultiple(21_000), "2.1×");
    assert.equal(formatMultiple(20_000), "2×");
    assert.equal(houseEdgeBps(4500, 20_500), 775);
    assert.equal(houseEdgeBps(4750, 20_000), 500);
    assert.equal(houseEdgeBps(4500, 20_000), 1000);
  });
});
