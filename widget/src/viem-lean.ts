/**
 * Lean viem clients for the CDN bundle: `createPublicClient` / `createWalletClient` decorate every action viem has
 * (ENS, signature verification with secp256k1, …), which a browser widget never uses. These carry only the actions
 * @flipperdotfamily/sdk calls, so the rest tree-shakes away (about 20 KB gzipped).
 */
import type { Eip1193Provider, FlipperPublicClient, FlipperWalletClient } from "@flipperdotfamily/sdk";
import { createClient, custom, type Address, type Chain, type Transport } from "viem";
import {
  call,
  estimateContractGas,
  estimateGas,
  estimateMaxPriorityFeePerGas,
  getBalance,
  getBlock,
  getBlockNumber,
  getChainId,
  getContractEvents,
  getGasPrice,
  getLogs,
  getTransaction,
  getTransactionReceipt,
  multicall,
  readContract,
  sendTransaction,
  simulateContract,
  waitForTransactionReceipt,
  writeContract,
} from "viem/actions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export function leanPublicClient(chain: Chain, transport: Transport, pollingInterval: number): FlipperPublicClient {
  return createClient({ chain, transport, pollingInterval, batch: { multicall: false } }).extend(((c: Any) => ({
    call: (a: Any) => call(c, a),
    estimateContractGas: (a: Any) => estimateContractGas(c, a),
    estimateGas: (a: Any) => estimateGas(c, a),
    estimateMaxPriorityFeePerGas: (a?: Any) => estimateMaxPriorityFeePerGas(c, a),
    getBalance: (a: Any) => getBalance(c, a),
    getBlock: (a?: Any) => getBlock(c, a),
    getBlockNumber: (a?: Any) => getBlockNumber(c, a),
    getChainId: () => getChainId(c),
    getContractEvents: (a: Any) => getContractEvents(c, a),
    getGasPrice: () => getGasPrice(c),
    getLogs: (a?: Any) => getLogs(c, a),
    getTransaction: (a: Any) => getTransaction(c, a),
    getTransactionReceipt: (a: Any) => getTransactionReceipt(c, a),
    multicall: (a: Any) => multicall(c, a),
    readContract: (a: Any) => readContract(c, a),
    simulateContract: (a: Any) => simulateContract(c, a),
    waitForTransactionReceipt: (a: Any) => waitForTransactionReceipt(c, a),
  })) as Any) as unknown as FlipperPublicClient;
}

export function leanWalletClient(provider: Eip1193Provider, chain: Chain, account: Address): FlipperWalletClient {
  return createClient({ chain, account, transport: custom(provider as Parameters<typeof custom>[0]) }).extend(((c: Any) => ({
    getChainId: () => getChainId(c),
    sendTransaction: (a: Any) => sendTransaction(c, a),
    writeContract: (a: Any) => writeContract(c, a),
  })) as Any) as unknown as FlipperWalletClient;
}
