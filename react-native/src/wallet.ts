import { RpcErrorCode } from "./constants";
import { normalizeAccounts, normalizeChainId } from "./encoding";
import type { FlipperWallet, FlipperWalletState } from "./types";

/** Throw this from a wallet adapter to answer the embed with a specific EIP-1193 error. */
export class FlipperRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "FlipperRpcError";
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

export interface RpcErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}

function isJsonSerializable(value: unknown): boolean {
  try {
    return JSON.stringify(value) !== undefined;
  } catch {
    return false;
  }
}

/**
 * Maps anything a wallet throws to an `rpc-error` payload: the first integer `code` found on the error or its
 * `cause` chain (so 4001 / 4902 from viem, WalletConnect or AppKit pass through), else -32603.
 */
export function toRpcError(err: unknown): RpcErrorPayload {
  let code: number | undefined;
  let message: string | undefined;
  let data: unknown;
  let cur: unknown = err;
  for (let depth = 0; depth < 4 && cur && typeof cur === "object"; depth++) {
    const e = cur as { code?: unknown; message?: unknown; shortMessage?: unknown; data?: unknown; cause?: unknown };
    if (code === undefined && typeof e.code === "number" && Number.isInteger(e.code)) {
      code = e.code;
      if (e.data !== undefined) data = e.data;
    }
    if (message === undefined) {
      if (typeof e.shortMessage === "string" && e.shortMessage) message = e.shortMessage;
      else if (typeof e.message === "string" && e.message) message = e.message;
    }
    cur = e.cause;
  }
  if (message === undefined && typeof err === "string" && err) message = err;
  const out: RpcErrorPayload = { code: code ?? RpcErrorCode.Internal, message: message ?? "Internal error" };
  if (data !== undefined && isJsonSerializable(data)) out.data = data;
  return out;
}

/** A wallet with a plain `(method, params)` request function, e.g. a thin wrapper over a native wallet module. */
export interface FlipperWalletAdapter {
  request(method: string, params: readonly unknown[] | object): Promise<unknown>;
  /** Report account / chain changes: call the listener with the new state; return an unsubscribe function. */
  subscribe?(listener: (state: Partial<FlipperWalletState>) => void): () => void;
}

type Listener = (...args: unknown[]) => void;

/**
 * Wraps an adapter as an EIP-1193-style `FlipperWallet`. Account / chain updates from `subscribe` are re-emitted as
 * `accountsChanged` / `chainChanged` events, which the widget follows.
 */
export function createFlipperWallet(adapter: FlipperWalletAdapter): FlipperWallet {
  const listeners = new Map<string, Set<Listener>>();
  let unsubscribe: (() => void) | undefined;
  const emit = (event: string, ...args: unknown[]) => listeners.get(event)?.forEach((l) => l(...args));
  const count = () => [...listeners.values()].reduce((n, s) => n + s.size, 0);
  const on = (event: string, listener: Listener) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(listener);
    if (!unsubscribe && adapter.subscribe) {
      unsubscribe = adapter.subscribe((state) => {
        if (state.accounts !== undefined) emit("accountsChanged", state.accounts);
        if (state.chainId !== undefined && state.chainId !== null) emit("chainChanged", "0x" + state.chainId.toString(16));
      });
    }
  };
  const off = (event: string, listener: Listener) => {
    listeners.get(event)?.delete(listener);
    if (count() === 0 && unsubscribe) {
      unsubscribe();
      unsubscribe = undefined;
    }
  };
  return {
    request: ({ method, params }) => adapter.request(method, params ?? []),
    on,
    removeListener: off,
    off,
  };
}

/**
 * Follows a wallet's state: reads `eth_accounts` / `eth_chainId` once, then listens for EIP-1193 events. Returns
 * a function that stops watching. `refresh()` re-reads the state (e.g. after a chain switch through an adapter
 * that emits no events).
 */
export function watchWallet(
  wallet: FlipperWallet,
  onChange: (update: Partial<FlipperWalletState>) => void,
): { stop: () => void; refresh: () => Promise<void> } {
  let stopped = false;
  const refresh = async () => {
    const [accounts, chainId] = await Promise.allSettled([
      wallet.request({ method: "eth_accounts", params: [] }),
      wallet.request({ method: "eth_chainId", params: [] }),
    ]);
    if (stopped) return;
    const update: Partial<FlipperWalletState> = {};
    if (accounts.status === "fulfilled") update.accounts = normalizeAccounts(accounts.value);
    if (chainId.status === "fulfilled") update.chainId = normalizeChainId(chainId.value);
    if (Object.keys(update).length) onChange(update);
  };
  const onAccounts = (accounts: unknown) => !stopped && onChange({ accounts: normalizeAccounts(accounts) });
  const onChain = (chainId: unknown) => !stopped && onChange({ chainId: normalizeChainId(chainId) });
  const onConnect = () => void refresh();
  const onDisconnect = () => !stopped && onChange({ accounts: [], chainId: null });
  const subs: Array<[string, Listener]> = [
    ["accountsChanged", onAccounts as Listener],
    ["chainChanged", onChain as Listener],
    ["connect", onConnect],
    ["disconnect", onDisconnect],
  ];
  for (const [event, fn] of subs) {
    try {
      wallet.on?.(event, fn);
    } catch {
      // providers that don't support an event
    }
  }
  void refresh().catch(() => undefined);
  return {
    refresh,
    stop: () => {
      stopped = true;
      for (const [event, fn] of subs) {
        try {
          if (wallet.removeListener) wallet.removeListener(event, fn);
          else wallet.off?.(event, fn);
        } catch {
          // ignore
        }
      }
    },
  };
}
