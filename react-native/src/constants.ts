/** Package version (kept in sync with package.json by the release script). */
export const SDK_VERSION = "0.1.0";
/** Embed bridge protocol version this package speaks. */
export const BRIDGE_VERSION = 1;

/** Hosted embed page. Override with the `baseUrl` prop (e.g. `http://localhost:3000/embed` in development). */
export const DEFAULT_EMBED_URL = "https://flipper.family/embed";
/** Robinhood Chain, the launch chain. */
export const DEFAULT_CHAIN_ID = 4663;
/** Local Anvil fork used in development. */
export const LOCAL_CHAIN_ID = 31337;

export const DEFAULT_INITIAL_HEIGHT = 560;
export const DEFAULT_MIN_HEIGHT = 120;

/** Inbound messages longer than this are dropped. */
export const MAX_MESSAGE_LENGTH = 524_288;
/** Outbound messages queued before the embed says `ready`. */
export const MAX_QUEUE = 100;

/**
 * The only JSON-RPC methods the embed may ask the host wallet for. Reads never cross the bridge: the embed has its
 * own RPC. Hosts can narrow this list with `allowedMethods`, never widen it. No message signing (`personal_sign`,
 * `eth_signTypedData_*`): the embed never signs messages, so a compromised embed can't ask for a Permit signature.
 */
export const WALLET_METHODS = [
  "eth_accounts",
  "eth_requestAccounts",
  "eth_chainId",
  "eth_sendTransaction",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
  "wallet_watchAsset",
] as const;
export type WalletMethod = (typeof WALLET_METHODS)[number];

/**
 * Optional EIP-5792 methods the embed uses for one-confirmation native-ETH flips (wrap + approve + flip as one
 * atomic batch). Forwarded only when the host opts in with `enableBatchCalls`; otherwise they're answered with 4200
 * and the embed falls back to sequential transactions.
 */
export const BATCH_CALL_METHODS = ["wallet_getCapabilities", "wallet_sendCalls", "wallet_getCallsStatus"] as const;
export type BatchCallMethod = (typeof BATCH_CALL_METHODS)[number];

/** Every method the embed can send (packages/widget/BRIDGE.md). Nothing outside this list is ever forwarded. */
export const BRIDGE_METHODS = [...WALLET_METHODS, ...BATCH_CALL_METHODS] as const;
export type BridgeMethod = WalletMethod | BatchCallMethod;

/** The forwarded set: the seven wallet methods, plus the EIP-5792 ones when enabled, narrowed by `allowedMethods`. */
export function effectiveMethods(enableBatchCalls: boolean, allowedMethods?: readonly string[]): readonly BridgeMethod[] {
  const base: readonly BridgeMethod[] = enableBatchCalls ? BRIDGE_METHODS : WALLET_METHODS;
  return allowedMethods ? base.filter((m) => allowedMethods.includes(m)) : base;
}

/** Hosts that may be loaded over plain http, and only when `allowInsecureLocalhost` is on (default: `__DEV__`). */
export const DEBUG_HOSTS = ["localhost", "127.0.0.1", "10.0.2.2", "[::1]", "::1"] as const;

/** EIP-1193 / EIP-1474 error codes the host answers with. */
export const RpcErrorCode = {
  UserRejected: 4001,
  Unauthorized: 4100,
  UnsupportedMethod: 4200,
  Disconnected: 4900,
  ChainDisconnected: 4901,
  UnrecognizedChain: 4902,
  InvalidRequest: -32600,
  InvalidParams: -32602,
  Internal: -32603,
} as const;
