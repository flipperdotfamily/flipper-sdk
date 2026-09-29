// The randomness fee a flip sends (liveness report L-3): exact when the adapter's fee is flat (Dice, Pyth Entropy),
// padded only when it moves with the gas price (Chainlink VRF). `pnpm test` bundles src/index.ts into .test-dist/sdk.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decodeFunctionData, encodeFunctionResult } from "viem";
import { createFlipperClient, flipperHouseAbi, paddedRandomnessFee } from "../.test-dist/sdk/index.js";

const HOUSE = "0x1000000000000000000000000000000000000001";
const LENS = "0x2000000000000000000000000000000000000002";
const PLAYER = "0x4000000000000000000000000000000000000004";
const TOKEN = "0x5000000000000000000000000000000000000005";
const FLAT_FEE = 25_000_000_000_000n;

/** a viem-like revert error, as toFlipperError walks it */
function revert(errorName, args = []) {
  const inner = Object.assign(new Error("reverted"), { name: "ContractFunctionRevertedError", data: { errorName, args } });
  const outer = Object.assign(new Error("Execution reverted"), { shortMessage: "Execution reverted" });
  outer.walk = (fn) => (fn(outer) ? outer : fn(inner) ? inner : null);
  return outer;
}

/**
 * A fake public client whose house quotes `feeAt(gasPrice)` for randomnessFeeFor (eth_call at an explicit gas price),
 * previews at `feeAt(quote price)`, and records the value of every simulated flip (then refuses it, ending the flow).
 */
function fakePublicClient(feeAt, { failProbe = false } = {}) {
  const calls = { fee: [], flipValues: [], quotePrice: undefined };
  return {
    calls,
    chain: { id: 31337 },
    getChainId: async () => 31337,
    getBlock: async () => ({ baseFeePerGas: 30_000_000n, timestamp: 1n }),
    getGasPrice: async () => 30_000_000n,
    estimateMaxPriorityFeePerGas: async () => 0n,
    call: async ({ data, gasPrice }) => {
      const { functionName } = decodeFunctionData({ abi: flipperHouseAbi, data });
      assert.equal(functionName, "randomnessFeeFor");
      calls.fee.push(gasPrice);
      if (failProbe) throw new Error("node refused the call");
      return { data: encodeFunctionResult({ abi: flipperHouseAbi, functionName: "randomnessFeeFor", result: feeAt(gasPrice) }) };
    },
    readContract: async (a) => {
      if (a.functionName === "allowance") return 10n ** 30n;
      if (a.functionName === "partnerRegistry") return "0x0000000000000000000000000000000000000000";
      throw new Error(`unexpected read ${a.functionName}`);
    },
    simulateContract: async (a) => {
      if (a.functionName === "previewFlip") {
        calls.quotePrice = a.gasPrice;
        const fee = feeAt(a.gasPrice);
        return { result: { code: 0, sellQuote: 1n, buyQuote: 1n, routeCostBps: 0n, winChanceBps: 4600n, liability: 1n, maxLiability: 10n, randomnessFee: fee } };
      }
      if (a.functionName === "flip") {
        calls.flipValues.push(a.value);
        throw revert("Expired");
      }
      throw new Error(`unexpected simulate ${a.functionName}`);
    },
  };
}

const walletClient = { account: { address: PLAYER, type: "json-rpc" }, chain: { id: 31337 } };
const flat = () => FLAT_FEE;
const gasPriced = (gasPrice) => gasPrice * 1_000_000n; // Chainlink-style: the callback priced at tx.gasprice
const fees = { maxFeePerGas: 50_000_000n, maxPriorityFeePerGas: 0n };

describe("randomness fee to send (L-3)", () => {
  test("a flat fee (Dice, Pyth) is sent exactly, and the probe runs once per client", async () => {
    const pc = fakePublicClient(flat);
    const client = createFlipperClient({ publicClient: pc, addresses: { house: HOUSE, lens: LENS } });
    assert.equal(await client.randomnessFeeIsGasPriced(TOKEN, fees), false);
    assert.equal(await client.randomnessFeeToSend(TOKEN, FLAT_FEE, fees), FLAT_FEE);
    assert.equal(await client.randomnessFeeToSend(TOKEN, undefined, fees), FLAT_FEE, "quotes the fee itself without one");
    const probes = pc.calls.fee.length;
    await client.randomnessFeeToSend(TOKEN, FLAT_FEE, fees);
    assert.equal(pc.calls.fee.length, probes, "cached: no new quotes");
    // the probe quoted two different gas prices
    assert.ok(new Set(pc.calls.fee.slice(0, 2)).size === 2, String(pc.calls.fee));
  });

  test("a gas-priced fee (Chainlink VRF) is padded", async () => {
    const pc = fakePublicClient(gasPriced);
    const client = createFlipperClient({ publicClient: pc, addresses: { house: HOUSE, lens: LENS } });
    assert.equal(await client.randomnessFeeIsGasPriced(TOKEN, fees), true);
    const quoted = gasPriced(fees.maxFeePerGas);
    assert.equal(await client.randomnessFeeToSend(TOKEN, quoted, fees), paddedRandomnessFee(quoted));
    assert.ok(paddedRandomnessFee(quoted) > quoted);
  });

  test("a failed probe pads (the safe side) and is tried again next time", async () => {
    const pc = fakePublicClient(flat, { failProbe: true });
    const client = createFlipperClient({ publicClient: pc, addresses: { house: HOUSE, lens: LENS } });
    assert.equal(await client.randomnessFeeIsGasPriced(TOKEN, fees), true);
    assert.equal(await client.randomnessFeeToSend(TOKEN, FLAT_FEE, fees), paddedRandomnessFee(FLAT_FEE));
    const before = pc.calls.fee.length;
    await client.randomnessFeeIsGasPriced(TOKEN, fees);
    assert.ok(pc.calls.fee.length > before, "not cached after a failure");
  });

  test("flip() sends the exact fee to a flat-fee house", async () => {
    const pc = fakePublicClient(flat);
    const client = createFlipperClient({ publicClient: pc, walletClient, addresses: { house: HOUSE, lens: LENS } });
    await assert.rejects(client.flip({ token: TOKEN, amount: 10n }));
    assert.deepEqual(pc.calls.flipValues, [FLAT_FEE]);
  });

  test("flip() pads the fee to a gas-priced house", async () => {
    const pc = fakePublicClient(gasPriced);
    const client = createFlipperClient({ publicClient: pc, walletClient, addresses: { house: HOUSE, lens: LENS } });
    await assert.rejects(client.flip({ token: TOKEN, amount: 10n }));
    // the preview's fee at the quote price, padded by 1.2
    const quoted = gasPriced(pc.calls.quotePrice);
    assert.ok(quoted > 0n);
    assert.deepEqual(pc.calls.flipValues, [paddedRandomnessFee(quoted)]);
  });
});
