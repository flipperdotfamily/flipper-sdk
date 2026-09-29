/**
 * The hosted embed's runtime (flipper.family/embed): reads the URL params, mounts `<flipper-widget>` full-bleed, and
 * borrows the host's wallet over the bridge (packages/widget/BRIDGE.md). Hosts never import this; they load the page.
 */
import type { Eip1193Provider, FlipperDeploymentManifest } from "@flipperdotfamily/sdk";
import { defineFlipperWidget } from "../define";
import type { FlipperWidget } from "../element";
import { FLIPPER_EVENTS, type FlipperEventMap, type FlipperEventName } from "../types";
import { BRIDGE_METHODS, BRIDGE_VERSION, parseBridgeMessage, type FlipperEmbedConfig, type HostToWidget, type RpcErrorBody, type WidgetToHost } from "./protocol";
import { configFromParams, sanitizeConfig } from "./sanitize";

export * from "./protocol";
export { configFromParams, isSafeColor, sanitizeConfig, sanitizeTheme, type ConfigSource } from "./sanitize";

type Listener = (...args: unknown[]) => void;
interface NativeWindow {
  FlipperHost?: { postMessage(json: string): void };
  webkit?: { messageHandlers?: { FlipperHost?: { postMessage(json: string): void } } };
  ReactNativeWebView?: { postMessage(json: string): void };
  FlipperBridge?: { version: number; receive(message: unknown): void };
  ethereum?: Eip1193Provider;
}

export interface EmbedOptions {
  /** where to mount (default document.body) */
  mount?: HTMLElement;
  /** query string to read (default location.search) */
  search?: string;
  /** deployments the page knows (inlined by the server); default: read `<script id="flipper-deployment">` */
  deployments?: FlipperDeploymentManifest | null;
}

class BridgeError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

/** Applies a config to the element's properties. */
export function applyConfig(el: FlipperWidget, c: FlipperEmbedConfig) {
  const w = el as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(c)) {
    if (v === undefined) continue;
    if (k === "addresses") w.addresses = v;
    else if (k in el || k === "variant") w[k] = v;
  }
}

/**
 * EIP-1193 provider that forwards wallet methods to the host over the bridge. eth_accounts / eth_chainId are answered
 * from the host's last `wallet` message; accountsChanged / chainChanged fire when it changes.
 */
export class BridgeProvider implements Eip1193Provider {
  private seq = 0;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer?: ReturnType<typeof setTimeout> }>();
  private listeners = new Map<string, Set<Listener>>();
  accounts: string[] = [];
  chainId?: string;
  gotWallet = false;
  /** eth_accounts / eth_chainId are answered locally until the embed decides to ask the host (see startEmbed) */
  probing = false;

  constructor(private post: (m: WidgetToHost) => void) {}

  async request({ method, params }: { method: string; params?: readonly unknown[] | object }): Promise<unknown> {
    if (method === "eth_accounts" && (this.gotWallet || !this.probing)) return this.accounts;
    if (method === "eth_chainId" && ((this.gotWallet && this.chainId) || !this.probing)) return this.chainId ?? "0x0";
    if (!(BRIDGE_METHODS as readonly string[]).includes(method)) throw new BridgeError(`The embed doesn't forward ${method} to its host.`, 4200);
    const id = `f${++this.seq}`;
    const list = params === undefined ? [] : Array.isArray(params) ? [...params] : [params];
    const probe = (method === "eth_accounts" || method === "eth_chainId") && !this.gotWallet;
    return new Promise((resolve, reject) => {
      const entry: { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer?: ReturnType<typeof setTimeout> } = { resolve, reject };
      // boot-time probes shouldn't hang forever on a host that only pushes `wallet`
      if (probe) entry.timer = setTimeout(() => this.settle(id, undefined, { code: 4900, message: "The host didn't answer." }), 10_000);
      this.pending.set(id, entry);
      this.post({ v: BRIDGE_VERSION, source: "flipper", type: "rpc", id, method: method as never, params: list });
    }).then((result) => {
      if (method === "eth_chainId" && typeof result === "string") this.chainId = result;
      if (method === "wallet_switchEthereumChain") {
        const want = (list[0] as { chainId?: string } | undefined)?.chainId;
        if (want && want !== this.chainId) this.setWallet(this.accounts, want);
      }
      if ((method === "eth_requestAccounts" || method === "eth_accounts") && Array.isArray(result)) this.setWallet(result as string[], this.chainId);
      return result;
    });
  }

  settle(id: string, result: unknown, error?: RpcErrorBody) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (error) p.reject(new BridgeError(typeof error.message === "string" ? error.message : "Request failed.", Number(error.code) || -32603, error.data));
    else p.resolve(result);
  }

  setWallet(accounts: string[], chainId: string | undefined) {
    const acc = accounts.filter((a) => typeof a === "string");
    const accChanged = acc.join() !== this.accounts.join();
    const chainChanged = !!chainId && chainId !== this.chainId;
    this.accounts = acc;
    if (chainId) this.chainId = chainId;
    this.gotWallet = true;
    if (chainChanged) this.fire("chainChanged", chainId);
    if (accChanged) this.fire(acc.length ? "accountsChanged" : "disconnect", acc.length ? acc : undefined);
    if (accChanged && !acc.length) this.fire("accountsChanged", []);
  }

  on(event: string, fn: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
  }
  removeListener(event: string, fn: Listener) {
    this.listeners.get(event)?.delete(fn);
  }
  private fire(event: string, v: unknown) {
    for (const fn of this.listeners.get(event) ?? []) {
      try {
        fn(v);
      } catch {
        /* a listener's problem */
      }
    }
  }
}

function readInlineDeployments(): FlipperDeploymentManifest | null {
  const el = typeof document !== "undefined" ? document.getElementById("flipper-deployment") : null;
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent) as FlipperDeploymentManifest;
  } catch {
    return null;
  }
}

/** Boots the embed page. Returns the element and the bridge (for tests). */
export function startEmbed(opts: EmbedOptions = {}) {
  defineFlipperWidget();
  const w = window as unknown as NativeWindow & Window;
  const framed = window.parent !== window;
  const hasHost = () => !!(w.FlipperHost || w.webkit?.messageHandlers?.FlipperHost || w.ReactNativeWebView || framed);
  // a link opened directly (no iframe parent, no native bridge): the URL may only set what's safe for anyone to set
  const standalone = !hasHost();
  const cfg = configFromParams(opts.search ?? location.search, { standalone });
  const hostOrigin = framed ? cfg.hostOrigin : undefined;
  const post = (m: WidgetToHost) => {
    const json = JSON.stringify(m);
    if (w.FlipperHost?.postMessage) return w.FlipperHost.postMessage(json);
    if (w.webkit?.messageHandlers?.FlipperHost?.postMessage) return w.webkit.messageHandlers.FlipperHost.postMessage(json);
    if (w.ReactNativeWebView?.postMessage) return w.ReactNativeWebView.postMessage(json);
    if (framed) return window.parent.postMessage(m, hostOrigin ?? "*");
  };
  const bridge = new BridgeProvider(post);
  document.documentElement.toggleAttribute("data-standalone", standalone);

  // ── the element ──────────────────────────────────────────────────────────────────────────────────────
  const el = document.createElement("flipper-widget") as FlipperWidget;
  el.style.setProperty("--flipper-max-width", standalone ? "460px" : "none");
  const manifest = opts.deployments === undefined ? readInlineDeployments() : opts.deployments;
  const chainId = cfg.chainId ?? manifest?.default;
  const dep = manifest && chainId !== undefined ? manifest.deployments[String(chainId)] : undefined;
  if (dep) {
    el.chainId = dep.chainId;
    el.rpcUrl = dep.rpcUrl;
    el.apiUrl = dep.apiUrl ?? null;
    el.addresses = { ...dep.addresses } as never;
  } else if (chainId !== undefined) {
    el.chainId = chainId;
  }
  el.deploymentUrl = manifest ? null : undefined;
  const { connect, hostOrigin: _ho, ...widgetCfg } = cfg;
  applyConfig(el, widgetCfg);
  if (!("theme" in widgetCfg)) el.theme = "auto";
  // fit=fill: the page, and the widget, take the frame's full height (a fixed-height iframe or WebView)
  const syncFill = () => document.documentElement.toggleAttribute("data-fill", el.fit === "fill");
  syncFill();

  // the wallet: the host's over the bridge; standalone in a wallet's in-app browser, its injected provider
  el.provider = standalone && w.ethereum ? w.ethereum : bridge;

  // ── widget → host ────────────────────────────────────────────────────────────────────────────────────
  for (const name of FLIPPER_EVENTS) {
    el.addEventListener(name, (e: Event) => {
      const detail = (e as CustomEvent).detail as FlipperEventMap[FlipperEventName];
      if (name === "connect-request" && !standalone && connect === "event") e.preventDefault();
      post({ v: BRIDGE_VERSION, source: "flipper", type: "event", name, data: detail } as WidgetToHost);
      if (name === "ready" && !standalone) {
        // hosts push `wallet` after `ready`; if one hasn't within 1.5 s, ask (some hosts only forward RPCs)
        setTimeout(() => {
          if (bridge.gotWallet) return;
          bridge.probing = true;
          void Promise.all([bridge.request({ method: "eth_accounts" }), bridge.request({ method: "eth_chainId" })])
            .then(([accounts, chain]) => {
              if (!bridge.gotWallet) bridge.setWallet(Array.isArray(accounts) ? (accounts as string[]) : [], typeof chain === "string" ? chain : undefined);
            })
            .catch(() => undefined);
        }, 1_500);
      }
    });
  }

  // ── host → widget ────────────────────────────────────────────────────────────────────────────────────
  const receive = (raw: unknown) => {
    const m = parseBridgeMessage<HostToWidget>(raw, "flipper-host");
    if (!m) return;
    switch (m.type) {
      case "rpc-result":
        bridge.settle(String(m.id), m.result);
        break;
      case "rpc-error":
        bridge.settle(String(m.id), undefined, m.error ?? { code: -32603, message: "Request failed." });
        break;
      case "wallet":
        bridge.setWallet(Array.isArray(m.accounts) ? m.accounts : [], typeof m.chainId === "string" ? m.chainId : undefined);
        break;
      case "config": {
        const { v: _v, source: _s, type: _t, ...rest } = m;
        // a host (iframe parent, native app) may also set the network fields; a standalone page has none to trust
        applyConfig(el, sanitizeConfig(rest, { from: "host", standalone }));
        syncFill();
        break;
      }
    }
  };
  const onMessage = (e: Event) => {
    const ev = e as MessageEvent;
    if (framed) {
      if (ev.source !== window.parent) return;
      if (hostOrigin && ev.origin !== hostOrigin) return;
    } else if (ev.source && ev.source !== window) {
      return; // e.g. a window.opener: only the page itself or native code may talk to a top-level embed
    }
    receive(ev.data);
  };
  window.addEventListener("message", onMessage);
  document.addEventListener("message", onMessage);
  w.FlipperBridge = { version: BRIDGE_VERSION, receive };

  (opts.mount ?? document.body).appendChild(el);
  return { element: el, bridge, standalone };
}
