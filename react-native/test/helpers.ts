import vm from "node:vm";
import { FlipperBridgeCore, type BridgeHandlers, type FlipperBridgeOptions } from "../src/bridge";
import type { FlipperWallet } from "../src/types";

export const ORIGIN = "https://flipper.family";
export const PAGE = "https://flipper.family/embed?chain=4663";
export const ACCOUNT = "0xAbC0000000000000000000000000000000000001";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Msg = Record<string, any>;

/** Decodes the JS the bridge injects by running it against a capturing FlipperBridge.receive. */
export function decodeInjected(js: string): Msg[] {
  const out: Msg[] = [];
  const sandbox: Msg = {
    JSON,
    location: { origin: ORIGIN },
    postMessage: () => {
      throw new Error("fallback path used");
    },
  };
  sandbox.window = sandbox;
  sandbox.FlipperBridge = { receive: (m: string) => out.push(JSON.parse(m)) };
  vm.runInNewContext(js, sandbox);
  return out;
}

export class MockProvider implements FlipperWallet {
  accounts: string[] = [ACCOUNT];
  chainId = "0x1237";
  calls: Array<{ method: string; params: unknown }> = [];
  /** method -> result or thrown error */
  responses = new Map<string, unknown>();
  failures = new Map<string, unknown>();
  private listeners = new Map<string, Set<(...a: unknown[]) => void>>();
  /** unresolved requests (for in-flight tests) */
  hold = new Set<string>();
  held: Array<() => void> = [];

  async request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
    this.calls.push({ method, params });
    if (this.hold.has(method)) await new Promise<void>((r) => this.held.push(r));
    if (this.failures.has(method)) throw this.failures.get(method);
    if (this.responses.has(method)) return this.responses.get(method);
    switch (method) {
      case "eth_accounts":
      case "eth_requestAccounts":
        return this.accounts;
      case "eth_chainId":
        return this.chainId;
      case "eth_sendTransaction":
        return "0x" + "ab".repeat(32);
      default:
        return null;
    }
  }
  on(event: string, fn: (...a: unknown[]) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
  }
  removeListener(event: string, fn: (...a: unknown[]) => void) {
    this.listeners.get(event)?.delete(fn);
  }
  emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach((fn) => fn(...args));
  }
  listenerCount(): number {
    return [...this.listeners.values()].reduce((n, s) => n + s.size, 0);
  }
  release() {
    this.held.splice(0).forEach((r) => r());
  }
}

export interface Harness {
  bridge: FlipperBridgeCore;
  sent: Msg[];
  calls: Array<[string, unknown]>;
  logs: string[];
  wallet: { current: FlipperWallet | null };
  /** post a raw message as the page would */
  post(message: unknown, source?: { url?: string | null; isMainFrame?: boolean }): void;
  rpc(id: string | number, method: string, params?: unknown): void;
  event(name: string, data?: unknown): void;
  last(type: string): Msg | undefined;
  byId(id: string | number): Msg | undefined;
}

export function harness(opts: Partial<FlipperBridgeOptions> & { wallet?: FlipperWallet | null; throwIn?: keyof BridgeHandlers } = {}): Harness {
  const sent: Msg[] = [];
  const calls: Array<[string, unknown]> = [];
  const logs: string[] = [];
  const wallet = { current: opts.wallet === undefined ? new MockProvider() : opts.wallet };
  const rec =
    (name: keyof BridgeHandlers) =>
    (arg: unknown, ...rest: unknown[]) => {
      calls.push([name, rest.length ? [arg, ...rest] : arg]);
      if (opts.throwIn === name) throw new Error("host handler bug");
    };
  const handlers: BridgeHandlers = {
    onEvent: rec("onEvent"),
    onReady: rec("onReady"),
    onConnectRequest: rec("onConnectRequest"),
    onFlipRequested: rec("onFlipRequested"),
    onFlipSettled: rec("onFlipSettled"),
    onPayoutResolved: rec("onPayoutResolved"),
    onListing: rec("onListing"),
    onError: rec("onError"),
    onResize: rec("onResize"),
    onRpcSettled: rec("onRpcSettled") as BridgeHandlers["onRpcSettled"],
  };
  const bridge = new FlipperBridgeCore({
    embedOrigin: ORIGIN,
    chainId: 4663,
    inject: (js) => sent.push(...decodeInjected(js)),
    getWallet: () => wallet.current,
    handlers: () => handlers,
    log: (m) => logs.push(m),
    ...opts,
  });
  const post: Harness["post"] = (message, source = { url: PAGE }) =>
    bridge.handleMessage(typeof message === "string" ? message : JSON.stringify(message), source);
  return {
    bridge,
    sent,
    calls,
    logs,
    wallet,
    post,
    rpc: (id, method, params = []) => post({ v: 1, source: "flipper", type: "rpc", id, method, params }),
    event: (name, data) => post({ v: 1, source: "flipper", type: "event", name, data }),
    last: (type) => [...sent].reverse().find((m) => m.type === type),
    byId: (id) => sent.find((m) => (m.type === "rpc-result" || m.type === "rpc-error") && m.id === id),
  };
}

export const tick = () => new Promise((r) => setTimeout(r, 1));
