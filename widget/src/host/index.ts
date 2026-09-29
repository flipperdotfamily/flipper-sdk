/**
 * `@flipperdotfamily/widget/host`: embed flipper as an `<iframe>` and lend it your wallet over the bridge (BRIDGE.md). Use this
 * when you'd rather not run the widget's code in your page (CSP, framework isolation), e.g.:
 *
 * ```ts
 * import { mountFlipperIframe } from "@flipperdotfamily/widget/host";
 * const embed = mountFlipperIframe({
 *   container: "#flipper",
 *   provider: window.ethereum,                  // any EIP-1193 provider
 *   params: { theme: "dark", partner: "acme" },
 *   onConnectRequest: () => openMyWalletModal(),
 *   onEvent: (name, data) => console.log(name, data),
 * });
 * // later: embed.setProvider(newProvider); embed.setConfig({ theme: "light" }); embed.destroy();
 * ```
 */
import { DEFAULT_EMBED_URL, type Eip1193Provider } from "@flipperdotfamily/sdk";
import type { FlipperEventMap, FlipperEventName } from "../types";
import {
  BRIDGE_METHODS,
  BRIDGE_VERSION,
  encodeConfigParam,
  parseBridgeMessage,
  type FlipperEmbedConfig,
  type HostToWidget,
  type WidgetToHost,
} from "../embed/protocol";

export { BRIDGE_METHODS, BRIDGE_VERSION, encodeConfigParam, parseBridgeMessage, type FlipperEmbedConfig, type HostToWidget, type WidgetToHost };

export interface MountFlipperIframeOptions {
  /** element (or selector) to put the iframe in */
  container: HTMLElement | string;
  /** the host's wallet; null / omitted = read-only until you call setProvider */
  provider?: Eip1193Provider | null;
  /** default https://flipper.family/embed */
  embedUrl?: string;
  /** URL params (see BRIDGE.md): chain, token, tokens, mode, size, details, tagline, theme, accent, radius, branding, partner, locale, compact… */
  params?: Record<string, string | number | boolean | undefined | null>;
  /** full config, sent as the base64 `config` param */
  config?: FlipperEmbedConfig;
  /** the user pressed Connect in the widget. Default: `provider.request({ method: "eth_requestAccounts" })` */
  onConnectRequest?: (data: FlipperEventMap["connect-request"]) => void;
  /** every widget event */
  onEvent?: <K extends FlipperEventName>(name: K, data: FlipperEventMap[K]) => void;
  /** size the iframe from the widget's `resize` events (default true, unless `fit` is "fill") */
  autoHeight?: boolean;
  /**
   * "auto" (default): the iframe grows with the widget. "fill": the iframe fills its container (give the container a
   * height) and the widget lays out inside it.
   */
  fit?: "auto" | "fill";
  /** accessible title of the iframe (default "flipper coin flip") */
  title?: string;
}

export interface FlipperIframe {
  iframe: HTMLIFrameElement;
  setProvider(p: Eip1193Provider | null): void;
  setConfig(c: FlipperEmbedConfig): void;
  destroy(): void;
}

type Listener = (...a: unknown[]) => void;
type Outgoing = HostToWidget extends infer T ? (T extends HostToWidget ? Omit<T, "v" | "source"> : never) : never;

export function mountFlipperIframe(opts: MountFlipperIframeOptions): FlipperIframe {
  const container = typeof opts.container === "string" ? document.querySelector<HTMLElement>(opts.container) : opts.container;
  if (!container) throw new Error("mountFlipperIframe: container not found");
  const url = new URL(opts.embedUrl ?? DEFAULT_EMBED_URL, location.href);
  for (const [k, v] of Object.entries(opts.params ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  if (opts.fit === "fill") url.searchParams.set("fit", "fill");
  // The embed ignores addresses / rpcUrl / apiUrl in its URL (a crafted link mustn't redirect funds): the host sends
  // them over the bridge once the embed is ready; everything else rides in the URL.
  const { addresses, rpcUrl, apiUrl, ...urlConfig } = opts.config ?? {};
  const bridged: FlipperEmbedConfig = {
    ...(addresses !== undefined ? { addresses } : {}),
    ...(rpcUrl !== undefined ? { rpcUrl } : {}),
    ...(apiUrl !== undefined ? { apiUrl } : {}),
  };
  if (Object.keys(urlConfig).length) url.searchParams.set("config", encodeConfigParam(urlConfig));
  const autoHeight = opts.autoHeight ?? opts.fit !== "fill";
  url.searchParams.set("hostOrigin", location.origin);
  const origin = url.origin;

  const iframe = document.createElement("iframe");
  iframe.src = url.toString();
  iframe.title = opts.title ?? "flipper coin flip";
  iframe.setAttribute("allow", "clipboard-write");
  // sandboxed: scripts and its own origin (storage, its API), and explorer links opening in a normal tab; no top
  // navigation, forms, downloads or modals
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox");
  iframe.setAttribute("loading", "eager");
  iframe.style.cssText = `display:block;width:100%;height:${opts.fit === "fill" ? "100%" : "560px"};border:0;background:transparent;color-scheme:normal;`;
  container.appendChild(iframe);

  let provider: Eip1193Provider | null = opts.provider ?? null;
  let ready = false;
  const send = (m: Outgoing) => iframe.contentWindow?.postMessage({ v: BRIDGE_VERSION, source: "flipper-host", ...m }, origin);

  const pushWallet = async () => {
    if (!ready) return;
    if (!provider) return send({ type: "wallet", accounts: [], chainId: "0x0" });
    try {
      const [accounts, chainId] = await Promise.all([provider.request({ method: "eth_accounts" }), provider.request({ method: "eth_chainId" })]);
      send({ type: "wallet", accounts: Array.isArray(accounts) ? (accounts as string[]) : [], chainId: typeof chainId === "string" ? chainId : "0x0" });
    } catch {
      send({ type: "wallet", accounts: [], chainId: "0x0" });
    }
  };
  const onAccounts: Listener = () => void pushWallet();
  const watch = (p: Eip1193Provider | null) => {
    p?.on?.("accountsChanged", onAccounts);
    p?.on?.("chainChanged", onAccounts);
    p?.on?.("disconnect", onAccounts);
  };
  const unwatch = (p: Eip1193Provider | null) => {
    p?.removeListener?.("accountsChanged", onAccounts);
    p?.removeListener?.("chainChanged", onAccounts);
    p?.removeListener?.("disconnect", onAccounts);
  };
  watch(provider);

  const onMessage = async (e: MessageEvent) => {
    if (e.source !== iframe.contentWindow || e.origin !== origin) return;
    const m = parseBridgeMessage<WidgetToHost>(e.data, "flipper");
    if (!m) return;
    if (m.type === "event") {
      if (m.name === "ready") {
        ready = true;
        if (Object.keys(bridged).length) send({ type: "config", ...bridged });
        void pushWallet();
      }
      if (m.name === "resize" && autoHeight) iframe.style.height = `${Math.ceil((m.data as FlipperEventMap["resize"]).height)}px`;
      if (m.name === "connect-request") {
        const data = m.data as FlipperEventMap["connect-request"];
        if (opts.onConnectRequest) opts.onConnectRequest(data);
        else if (provider) void provider.request({ method: "eth_requestAccounts" }).then(pushWallet, () => undefined);
      }
      opts.onEvent?.(m.name, m.data as never);
      return;
    }
    if (m.type === "rpc") {
      const { id, method, params } = m;
      if (!(BRIDGE_METHODS as readonly string[]).includes(method)) return send({ type: "rpc-error", id, error: { code: 4200, message: `${method} isn't supported.` } });
      if (!provider) return send({ type: "rpc-error", id, error: { code: 4100, message: "No wallet connected." } });
      try {
        const result = await provider.request({ method, params });
        send({ type: "rpc-result", id, result: result ?? null });
        if (method === "wallet_switchEthereumChain" || method === "eth_requestAccounts") void pushWallet();
      } catch (err) {
        const x = err as { code?: unknown; message?: unknown; data?: unknown; cause?: { code?: unknown } };
        const code = typeof x?.code === "number" ? x.code : typeof x?.cause?.code === "number" ? x.cause.code : -32603;
        send({ type: "rpc-error", id, error: { code, message: typeof x?.message === "string" ? x.message : "Request failed.", data: x?.data } });
      }
    }
  };
  window.addEventListener("message", onMessage);

  return {
    iframe,
    setProvider(p) {
      unwatch(provider);
      provider = p;
      watch(provider);
      void pushWallet();
    },
    setConfig(c) {
      send({ type: "config", ...c });
    },
    destroy() {
      window.removeEventListener("message", onMessage);
      unwatch(provider);
      iframe.remove();
    },
  };
}
