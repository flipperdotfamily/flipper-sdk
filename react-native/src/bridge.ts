import { BRIDGE_VERSION, DEFAULT_MIN_HEIGHT, MAX_MESSAGE_LENGTH, RpcErrorCode, effectiveMethods } from "./constants";
import { originOf, toHexChainId } from "./encoding";
import { buildReceiveScript } from "./scripts";
import type {
  FlipperEmbedConfig,
  FlipperEvent,
  FlipperEventHandlers,
  FlipperEventName,
  FlipperWallet,
  FlipperWalletState,
} from "./types";
import { toRpcError, type RpcErrorPayload } from "./wallet";

export interface BridgeHandlers extends FlipperEventHandlers {
  /** an RPC finished (used by the widget to re-read wallet state after a connect / chain switch) */
  onRpcSettled?: (method: string, ok: boolean) => void;
}

export interface FlipperBridgeOptions {
  /** scheme://host[:port] of the embed; messages from anywhere else are dropped */
  embedOrigin: string;
  /** chain the widget is configured for (answers `eth_chainId` and fills `wallet.chainId` without a wallet) */
  chainId: number;
  /** runs JavaScript in the embed page (WebView `injectJavaScript`) */
  inject: (js: string) => void;
  /** the host wallet at the time of each request */
  getWallet: () => FlipperWallet | null | undefined;
  /** also forward the optional EIP-5792 methods (wallet_getCapabilities / wallet_sendCalls / wallet_getCallsStatus) */
  enableBatchCalls?: boolean;
  /** narrows the RPC allowlist (never widens it beyond the bridge's methods) */
  allowedMethods?: readonly string[];
  /**
   * Config the embed only accepts from its host, never from its URL (`rpcUrl`, `apiUrl`, `addresses`; see
   * `hostOnlyConfigOf`). Sent in a `config` message after every `ready`, under any live config changes, and kept
   * across `pageStarted({ keepConfig: false })`.
   */
  hostConfig?: FlipperEmbedConfig;
  /** read on every dispatch, so callers can pass the latest props */
  handlers?: () => BridgeHandlers;
  minHeight?: number;
  maxHeight?: number;
  /** debug logging for dropped / rejected messages */
  log?: (message: string, detail?: unknown) => void;
}

export interface MessageSource {
  /** URL of the page (or frame) that sent the message */
  url?: string | null;
  /** false when the platform knows the message came from a sub-frame */
  isMainFrame?: boolean;
}

type RpcId = string | number;

const KNOWN_EVENTS: ReadonlySet<string> = new Set<FlipperEventName>([
  "ready",
  "connect-request",
  "flip-requested",
  "flip-settled",
  "payout-resolved",
  "listing",
  "error",
  "resize",
]);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Host side of the embed bridge (protocol v1), independent of any WebView: feed it the strings the page posts,
 * and it answers through `inject`. `<FlipperWidget>` wraps one of these; you only need it directly to build your own
 * WebView integration.
 */
export class FlipperBridgeCore {
  private opts: FlipperBridgeOptions;
  private ready = false;
  /** bumps on every page (re)load: answers to requests from an earlier page are discarded */
  private generation = 0;
  private inflight = new Set<string>();
  private wallet: FlipperWalletState = { accounts: [], chainId: null };
  private lastWalletJson: string | null = null;
  /** config changes since the page was loaded; re-sent after every `ready` (a reload keeps them) */
  private liveConfig: FlipperEmbedConfig = {};
  private disposed = false;

  constructor(options: FlipperBridgeOptions) {
    this.opts = options;
  }

  get isReady(): boolean {
    return this.ready;
  }

  update(options: Partial<FlipperBridgeOptions>): void {
    const chainChanged = options.chainId !== undefined && options.chainId !== this.opts.chainId;
    this.opts = { ...this.opts, ...options };
    if (chainChanged) this.pushWallet();
  }

  /**
   * A new top-level page load started (first load, reload or navigation): stop talking to the old page and wait for
   * the next `ready`. `keepConfig: false` also forgets live config changes (the new URL already carries them);
   * `hostConfig` is always re-sent, since no URL carries it.
   */
  pageStarted({ keepConfig = true }: { keepConfig?: boolean } = {}): void {
    this.ready = false;
    this.generation++;
    this.inflight.clear();
    this.lastWalletJson = null;
    if (!keepConfig) this.liveConfig = {};
  }

  /** Current wallet state from the host. Sent to the embed now if it's ready, else on `ready`. */
  setWalletState(state: FlipperWalletState): void {
    this.wallet = { accounts: [...state.accounts], chainId: state.chainId };
    this.pushWallet();
  }

  /** Live config update (`FlipperEmbedConfig` fields). Queued until `ready`; merged with earlier updates. */
  sendConfig(partial: FlipperEmbedConfig): void {
    if (!Object.keys(partial).length) return;
    this.liveConfig = { ...this.liveConfig, ...partial };
    if (this.ready) this.post({ type: "config", ...partial });
  }

  dispose(): void {
    this.disposed = true;
    this.ready = false;
    this.inflight.clear();
  }

  /** Handles one message posted by the page (`window.FlipperHost.postMessage`). */
  handleMessage(raw: unknown, source: MessageSource): void {
    if (this.disposed) return;
    if (source.isMainFrame === false) return this.drop("message from a sub-frame");
    const from = originOf(source.url);
    if (from !== this.opts.embedOrigin) return this.drop("message from another origin", source.url);

    let msg: unknown = raw;
    if (typeof raw === "string") {
      if (raw.length > MAX_MESSAGE_LENGTH) return this.drop("message too large");
      try {
        msg = JSON.parse(raw);
      } catch {
        return this.drop("message is not JSON");
      }
    }
    if (!isRecord(msg) || msg.v !== BRIDGE_VERSION || msg.source !== "flipper") return this.drop("not a flipper v1 message");

    if (msg.type === "rpc") void this.handleRpc(msg);
    else if (msg.type === "event") this.handleEvent(msg);
    else this.drop("unknown message type", msg.type);
  }

  // ── RPC ───────────────────────────────────────────────────────────────────────────────────────

  private allowed(method: string): boolean {
    return (effectiveMethods(!!this.opts.enableBatchCalls, this.opts.allowedMethods) as readonly string[]).includes(method);
  }

  private async handleRpc(msg: Record<string, unknown>): Promise<void> {
    const id = msg.id;
    if (!(typeof id === "string" || (typeof id === "number" && Number.isFinite(id)))) return this.drop("rpc without a valid id");
    const key = `${typeof id}:${String(id)}`;
    if (this.inflight.has(key)) return this.replyError(id, { code: RpcErrorCode.InvalidRequest, message: "Duplicate request id" });

    const method = msg.method;
    if (typeof method !== "string" || !method) return this.replyError(id, { code: RpcErrorCode.InvalidRequest, message: "Invalid request" });
    let params: unknown = msg.params;
    if (params === undefined || params === null) params = [];
    if (typeof params !== "object") return this.replyError(id, { code: RpcErrorCode.InvalidParams, message: "Invalid params" });
    if (!this.allowed(method)) return this.replyError(id, { code: RpcErrorCode.UnsupportedMethod, message: `Unsupported method: ${method}` });

    const gen = this.generation;
    this.inflight.add(key);
    let ok = false;
    try {
      const result = await this.execute(method, params as readonly unknown[] | object);
      ok = true;
      if (gen === this.generation && !this.disposed) this.post({ type: "rpc-result", id, result: result === undefined ? null : result });
    } catch (err) {
      if (gen === this.generation && !this.disposed) this.replyError(id, toRpcError(err));
    } finally {
      if (gen === this.generation) this.inflight.delete(key);
    }
    if (gen === this.generation && !this.disposed) this.call("onRpcSettled", method, ok);
  }

  private async execute(method: string, params: readonly unknown[] | object): Promise<unknown> {
    const wallet = this.opts.getWallet();
    if (!wallet) {
      switch (method) {
        case "eth_accounts":
          return [];
        case "eth_chainId":
          return toHexChainId(this.opts.chainId);
        case "eth_requestAccounts":
          this.call("onConnectRequest", { reason: "connect", partner: null });
          throw { code: RpcErrorCode.Unauthorized, message: "No wallet connected. The host app was asked to connect one." };
        default:
          throw { code: RpcErrorCode.Unauthorized, message: "No wallet connected." };
      }
    }
    return wallet.request({ method, params });
  }

  private replyError(id: RpcId, error: RpcErrorPayload): void {
    this.post({ type: "rpc-error", id, error });
  }

  // ── events ────────────────────────────────────────────────────────────────────────────────────

  private handleEvent(msg: Record<string, unknown>): void {
    const name = msg.name;
    if (typeof name !== "string" || !name) return this.drop("event without a name");
    const data = msg.data === undefined ? {} : msg.data;
    const event: FlipperEvent = KNOWN_EVENTS.has(name)
      ? ({ name, data } as FlipperEvent)
      : { name: "unknown", rawName: name, data };

    if (name === "ready") {
      this.ready = true;
      this.lastWalletJson = null;
      this.pushWallet();
      const config = { ...this.opts.hostConfig, ...this.liveConfig };
      if (Object.keys(config).length) this.post({ type: "config", ...config });
    }

    this.call("onEvent", event);
    const d = (isRecord(data) ? data : {}) as never;
    switch (name) {
      case "ready":
        return this.call("onReady", d);
      case "connect-request":
        return this.call("onConnectRequest", d);
      case "flip-requested":
        return this.call("onFlipRequested", d);
      case "flip-settled":
        return this.call("onFlipSettled", d);
      case "payout-resolved":
        return this.call("onPayoutResolved", d);
      case "listing":
        return this.call("onListing", d);
      case "error":
        return this.call("onError", d);
      case "resize": {
        const h = isRecord(data) ? data.height : undefined;
        if (typeof h !== "number" || !Number.isFinite(h) || h <= 0) return;
        const min = this.opts.minHeight ?? DEFAULT_MIN_HEIGHT;
        const max = this.opts.maxHeight ?? Number.POSITIVE_INFINITY;
        return this.call("onResize", Math.min(max, Math.max(min, Math.ceil(h))));
      }
    }
  }

  // ── plumbing ──────────────────────────────────────────────────────────────────────────────────

  private pushWallet(): void {
    if (!this.ready) return;
    const message = {
      type: "wallet",
      accounts: this.wallet.accounts,
      chainId: toHexChainId(this.wallet.chainId ?? this.opts.chainId),
    };
    const json = JSON.stringify(message);
    if (json === this.lastWalletJson) return;
    this.lastWalletJson = json;
    this.post(message);
  }

  private post(message: Record<string, unknown>): void {
    if (this.disposed) return;
    let js: string;
    try {
      js = buildReceiveScript({ v: BRIDGE_VERSION, source: "flipper-host", ...message });
    } catch (err) {
      // e.g. a wallet result that isn't JSON-serializable (bigint): answer with an error instead
      if ((message.type === "rpc-result" || message.type === "rpc-error") && message.id !== undefined) {
        js = buildReceiveScript({
          v: BRIDGE_VERSION,
          source: "flipper-host",
          type: "rpc-error",
          id: message.id,
          error: { code: RpcErrorCode.Internal, message: "The wallet returned a value that can't be serialized." },
        });
      } else {
        this.opts.log?.("flipper: could not serialize message", err);
        return;
      }
    }
    try {
      this.opts.inject(js);
    } catch (err) {
      this.opts.log?.("flipper: injectJavaScript failed", err);
    }
  }

  private call<K extends keyof BridgeHandlers>(key: K, ...args: Parameters<NonNullable<BridgeHandlers[K]>>): void {
    const fn = this.opts.handlers?.()[key] as ((...a: unknown[]) => void) | undefined;
    if (!fn) return;
    try {
      fn(...args);
    } catch (err) {
      this.opts.log?.(`flipper: ${String(key)} handler threw`, err);
    }
  }

  private drop(reason: string, detail?: unknown): void {
    this.opts.log?.(`flipper: dropped ${reason}`, detail);
  }
}
