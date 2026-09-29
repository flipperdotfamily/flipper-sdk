/**
 * The showcase kit: served at /_showcase/kit.js by the examples showcase (dev.sh), never part of an example's own
 * bundle. Every demo site loads it at runtime with a dynamic import; outside the showcase that import fails and the
 * site falls back to production defaults.
 *
 * - `loadStack()` reads the running stack: /stack.json (written by the showcase server from dev.sh's env), then the
 *   web app's /embed/deployment.json for the chain id, RPC, API and addresses. Nothing is hard-coded, so the
 *   showcase follows whichever dev chain is running.
 * - On a local fork only, it also creates the **dev wallet**: an EIP-1193 provider over a viem local account (an
 *   anvil test key) and announces it through EIP-6963, so every site's normal wallet discovery lists it as
 *   "Dev wallet (local fork)". It signs locally and sends raw transactions to the fork; nothing leaves the machine.
 */
import { createWalletClient, defineChain, http, numberToHex, type Chain, type Hex } from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";

export interface ShowcaseToken {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  logo: string | null;
  section: string;
}

export interface ShowcaseStack {
  /** served by the showcase (false: production defaults) */
  showcase: boolean;
  webUrl: string;
  deploymentUrl: string;
  embedUrl: string;
  /** the widget's CDN build (the local build in the showcase) */
  widgetScriptUrl: string;
  chainId: number | undefined;
  chainName: string;
  rpcUrl: string | undefined;
  apiUrl: string | undefined;
  nativeSymbol: string;
  addresses: Record<string, `0x${string}`>;
  /** the RPC is on this machine: a dev fork */
  local: boolean;
  /** the dev wallet's address when it's available (local forks only) */
  devWallet: { address: `0x${string}`; label: string } | null;
  /** listed tokens from the flipper API, by symbol (case-insensitive); missing ones are left out */
  findTokens(symbols: string[]): Promise<ShowcaseToken[]>;
  /** every listed token, in the API's order */
  listTokens(): Promise<ShowcaseToken[]>;
}

export const DEV_WALLET_RDNS = "family.flipper.devwallet";
export const DEV_WALLET_NAME = "Dev wallet (local fork)";

const PRODUCTION = {
  webUrl: "https://flipper.family",
  deploymentUrl: "https://flipper.family/embed/deployment.json",
  embedUrl: "https://flipper.family/embed",
  widgetScriptUrl: "https://cdn.jsdelivr.net/npm/@flipperdotfamily/widget@0/dist/cdn/flipper-widget.js",
};

interface StackFile {
  webUrl?: string;
  deploymentUrl?: string;
  embedUrl?: string;
  widgetScriptUrl?: string;
  devWallet?: { privateKey: Hex; label?: string } | null;
}

interface Deployment {
  chainId: number;
  name?: string;
  rpcUrl?: string;
  apiUrl?: string;
  nativeSymbol?: string;
  explorerUrl?: string;
  addresses?: Record<string, `0x${string}`>;
}

const isLoopback = (url: string | undefined) => {
  try {
    return !!url && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

let loading: Promise<ShowcaseStack> | undefined;

/** The running stack (memoised: every caller on the page shares one dev wallet). */
export function loadStack(): Promise<ShowcaseStack> {
  return (loading ??= load());
}

async function load(): Promise<ShowcaseStack> {
  let file: StackFile = {};
  let showcase = false;
  try {
    const r = await fetch("/stack.json", { cache: "no-store" });
    if (r.ok) {
      file = (await r.json()) as StackFile;
      showcase = true;
    }
  } catch {
    /* not served by the showcase */
  }
  const s = { ...PRODUCTION, ...stripUndefined(file) };
  let d: Deployment | undefined;
  try {
    const m = (await (await fetch(s.deploymentUrl, { cache: "no-store" })).json()) as { default?: number; deployments?: Record<string, Deployment> };
    d = m.deployments?.[String(m.default)] ?? Object.values(m.deployments ?? {})[0];
  } catch {
    /* the web app isn't up: the widget will say so itself */
  }
  const local = isLoopback(d?.rpcUrl);
  const chain = d?.rpcUrl
    ? defineChain({
        id: d.chainId,
        name: d.name ?? `Chain ${d.chainId}`,
        nativeCurrency: { name: "Ether", symbol: d.nativeSymbol ?? "ETH", decimals: 18 },
        rpcUrls: { default: { http: [d.rpcUrl] } },
      })
    : undefined;

  let devWallet: ShowcaseStack["devWallet"] = null;
  if (local && chain && file.devWallet?.privateKey) {
    const provider = createDevWallet(file.devWallet.privateKey, chain);
    announce(provider);
    devWallet = { address: provider.address, label: file.devWallet.label ?? "anvil test key" };
  }

  let tokenList: Promise<ShowcaseToken[]> | undefined;
  const apiUrl = d?.apiUrl;
  const listed = () =>
    (tokenList ??= apiUrl
      ? fetch(`${apiUrl.replace(/\/$/, "")}/v1/tokens?limit=200`)
          .then((r) => r.json() as Promise<{ tokens: ShowcaseToken[] }>)
          .then((j) => j.tokens.filter((t) => t.section === "listed"))
          .catch(() => [])
      : Promise.resolve([]));

  return {
    showcase,
    webUrl: s.webUrl,
    deploymentUrl: s.deploymentUrl,
    embedUrl: s.embedUrl,
    widgetScriptUrl: s.widgetScriptUrl,
    chainId: d?.chainId,
    chainName: d?.name ?? "flipper",
    rpcUrl: d?.rpcUrl,
    apiUrl,
    nativeSymbol: d?.nativeSymbol ?? "ETH",
    addresses: d?.addresses ?? {},
    local,
    devWallet,
    async findTokens(symbols) {
      const all = await listed();
      return symbols.flatMap((sym) => all.find((t) => t.symbol.toLowerCase() === sym.toLowerCase()) ?? []);
    },
    listTokens: listed,
  };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>;
}

// ── the dev wallet ────────────────────────────────────────────────────────────────────────────────────

type Listener = (...args: unknown[]) => void;
interface DevProvider {
  isFlipperDevWallet: true;
  address: `0x${string}`;
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on(event: string, fn: Listener): DevProvider;
  removeListener(event: string, fn: Listener): DevProvider;
}

const rpcError = (code: number, message: string) => Object.assign(new Error(message), { code });
const big = (v: unknown) => (typeof v === "string" || typeof v === "number" ? BigInt(v) : undefined);

function createDevWallet(privateKey: Hex, chain: Chain): DevProvider {
  const account = privateKeyToAccount(privateKey, { nonceManager });
  const client = createWalletClient({ account, chain, transport: http(chain.rpcUrls.default.http[0]) });
  const chainHex = numberToHex(chain.id);
  const storeKey = `flipper-dev-wallet:${chain.id}`;
  const listeners = new Map<string, Set<Listener>>();
  const emit = (event: string, ...args: unknown[]) => listeners.get(event)?.forEach((fn) => fn(...args));
  let connected = false;
  try {
    connected = localStorage.getItem(storeKey) === "1";
  } catch {
    /* storage blocked: start disconnected */
  }
  const setConnected = (on: boolean) => {
    connected = on;
    try {
      localStorage.setItem(storeKey, on ? "1" : "0");
    } catch {
      /* ignore */
    }
  };
  const connect = () => {
    if (!connected) {
      setConnected(true);
      emit("connect", { chainId: chainHex });
      emit("accountsChanged", [account.address]);
    }
    return [account.address];
  };
  const requireConnected = () => {
    if (!connected) throw rpcError(4100, "The dev wallet isn't connected to this site.");
  };

  const provider: DevProvider = {
    isFlipperDevWallet: true,
    address: account.address,
    async request({ method, params }) {
      const p = (Array.isArray(params) ? params : []) as unknown[];
      switch (method) {
        case "eth_requestAccounts":
          return connect();
        case "eth_accounts":
          return connected ? [account.address] : [];
        case "eth_chainId":
          return chainHex;
        case "net_version":
          return String(chain.id);
        case "wallet_requestPermissions":
          connect();
          return [{ parentCapability: "eth_accounts" }];
        case "wallet_getPermissions":
          return connected ? [{ parentCapability: "eth_accounts" }] : [];
        case "wallet_revokePermissions":
          setConnected(false);
          emit("accountsChanged", []);
          emit("disconnect", rpcError(4900, "Disconnected"));
          return null;
        case "wallet_switchEthereumChain": {
          const want = (p[0] as { chainId?: string } | undefined)?.chainId;
          if (want && BigInt(want) === BigInt(chain.id)) return null;
          throw rpcError(4902, `The dev wallet only knows ${chain.name} (chain ${chain.id}).`);
        }
        case "wallet_addEthereumChain":
        case "wallet_watchAsset":
          return null;
        case "eth_sendTransaction": {
          requireConnected();
          const tx = (p[0] ?? {}) as Record<string, string | undefined>;
          return client.sendTransaction({
            to: tx.to as `0x${string}` | undefined,
            data: tx.data as Hex | undefined,
            value: big(tx.value),
            gas: big(tx.gas),
            maxFeePerGas: big(tx.maxFeePerGas),
            maxPriorityFeePerGas: big(tx.maxPriorityFeePerGas),
          } as Parameters<typeof client.sendTransaction>[0]);
        }
        case "personal_sign":
          requireConnected();
          return account.signMessage({ message: { raw: p[0] as Hex } });
        case "eth_signTypedData_v4": {
          requireConnected();
          const td = (typeof p[1] === "string" ? JSON.parse(p[1]) : p[1]) as {
            domain: Record<string, unknown>;
            types: Record<string, { name: string; type: string }[]>;
            primaryType: string;
            message: Record<string, unknown>;
          };
          const { EIP712Domain: _drop, ...types } = td.types;
          return account.signTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: td.message } as never);
        }
        // EIP-5792 batches: not supported, so dapps fall back to one transaction at a time
        case "wallet_getCapabilities":
        case "wallet_sendCalls":
        case "wallet_getCallsStatus":
        case "wallet_showCallsStatus":
          throw rpcError(4200, `${method} isn't supported by the dev wallet.`);
        default:
          // reads (eth_call, eth_getBalance, receipts, …) go straight to the fork
          return client.request({ method, params } as never);
      }
    },
    on(event, fn) {
      (listeners.get(event) ?? listeners.set(event, new Set()).get(event)!).add(fn);
      return provider;
    },
    removeListener(event, fn) {
      listeners.get(event)?.delete(fn);
      return provider;
    },
  };
  return provider;
}

const ICON =
  "data:image/svg+xml;base64," +
  btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#1d2330"/><path d="M18 22h14a10 10 0 0 1 0 20H18z" fill="none" stroke="#4cc2ff" stroke-width="5"/><circle cx="46" cy="44" r="6" fill="#ffb020"/></svg>`,
  );

/** EIP-6963: every site's wallet discovery (wagmi, the vanilla page, the Angular service…) lists the dev wallet. */
function announce(provider: DevProvider) {
  const detail = Object.freeze({
    info: Object.freeze({ uuid: crypto.randomUUID(), name: DEV_WALLET_NAME, icon: ICON, rdns: DEV_WALLET_RDNS }),
    provider,
  });
  const send = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  window.addEventListener("eip6963:requestProvider", send);
  send();
}
