import type { WalletMethod } from "./constants";

// ── wallet ────────────────────────────────────────────────────────────────────────────────────────

export interface FlipperRequestArguments {
  method: string;
  params?: readonly unknown[] | object;
}

type Listener = (...args: any[]) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * The host app's wallet: any EIP-1193 provider (Reown AppKit, WalletConnect's EthereumProvider, a wagmi connector's
 * provider, the MetaMask SDK, Privy, a viem `WalletClient`, …) or an adapter built with `createFlipperWallet`.
 *
 * Only `request` is required. When the provider emits the EIP-1193 events `accountsChanged`, `chainChanged` and
 * `disconnect`, the widget follows them; otherwise pass `address` / `walletChainId` props.
 */
export interface FlipperWallet {
  request(args: FlipperRequestArguments): Promise<unknown>;
  on?(event: string, listener: Listener): unknown;
  removeListener?(event: string, listener: Listener): unknown;
  off?(event: string, listener: Listener): unknown;
}

/** Wallet state as the widget sees it. `chainId` is null when unknown. */
export interface FlipperWalletState {
  accounts: string[];
  chainId: number | null;
}

// ── embed configuration ──────────────────────────────────────────────────────────────────────────

export type FlipperThemeMode = "light" | "dark" | "auto";

/**
 * Custom theme tokens, passed through to the embed as `config.theme` (see the widget README for the keys). Use a
 * plain mode string for the common case.
 */
export type FlipperCustomTheme = Record<string, unknown>;

/**
 * The embed's full configuration object (`FlipperEmbedConfig` in packages/widget/BRIDGE.md). Every field is
 * optional. It is sent as the base64 `config` URL parameter on load, and as live `config` messages afterwards.
 * Unknown keys are passed through so newer embed features work without an SDK update.
 */
export interface FlipperEmbedConfig {
  chainId?: number;
  token?: string;
  tokens?: string[];
  /** "picker" (default): the user chooses the token. "single": one fixed token (`token` required), no picker */
  mode?: "picker" | "single";
  /** @deprecated use `mode: "single"` */
  hidePicker?: boolean;
  variant?: "card" | "compact";
  /** "auto" (default): the embed reports its height. "fill": it fills a view of fixed size */
  fit?: "auto" | "fill";
  /** scale on top of the fluid layout */
  size?: "sm" | "md" | "lg" | "auto";
  /** show the win chance / payout / fee line under the button (default off) */
  details?: boolean;
  /** idle headline under the coin: true = the built-in one, a string = your own (default none) */
  tagline?: string | boolean;
  theme?: FlipperThemeMode | FlipperCustomTheme;
  accent?: string;
  radius?: number;
  branding?: boolean;
  /** replaces "flipper" in the header */
  brandName?: string;
  /** https URL of a square image, at least 64 px */
  brandLogo?: string;
  /** https URL: heads face of the coin */
  coinImage?: string;
  /** https URL: tails face of the coin */
  coinImageTails?: string;
  locale?: string;
  /** string-table overrides (keys in the widget README) */
  strings?: Record<string, string>;
  partner?: string;
  /** decimal, in token units ("10") */
  minAmount?: string;
  maxAmount?: string;
  /** allowance to request (default "max") */
  approval?: "max" | "exact";
  /** allow permissionless listing of eligible tokens (default true) */
  listing?: boolean;
  /** read RPC for the chain (default: the deployment's public RPC). Host-only: sent after `ready`, never in the URL */
  rpcUrl?: string;
  /** flipper API (default: the deployment's). Host-only: sent after `ready`, never in the URL */
  apiUrl?: string;
  /** contract overrides: house, lens, flipper, v4Adapter, … Host-only: sent after `ready`, never in the URL */
  addresses?: Record<string, string>;
  [key: string]: unknown;
}

/** The embed options exposed as individual props on `<FlipperWidget>` (mirroring the embed URL parameters). */
export interface FlipperEmbedOptions {
  /** chain to flip on (default 4663, Robinhood Chain; 31337 for a local fork) */
  chain?: number;
  /** token selected at start (default $FLIPPER) */
  token?: string;
  /** allowlist for the token picker; one address means no picker */
  tokens?: readonly string[];
  /** colour mode (default "auto"), or custom theme tokens */
  theme?: FlipperThemeMode | FlipperCustomTheme;
  /** accent colour, e.g. "#ff5a1f" */
  accent?: string;
  /** card corner radius in px, 0–40 (default 24) */
  radius?: number;
  /** false removes flipper.family marks (white-label) */
  branding?: boolean;
  /** attribution id `[A-Za-z0-9._:-]{1,64}`, echoed in every event */
  partner?: string;
  /** BCP 47 tag, e.g. "en", "es" */
  locale?: string;
  /** compact layout: small inline coin, denser spacing */
  compact?: boolean;
  /**
   * "picker" (default): the user chooses among the listed tokens (`tokens` narrows the list). "single": one fixed
   * token; `token` is required (the embed shows a configuration error without it) and the picker isn't rendered.
   */
  mode?: "picker" | "single";
  /** @deprecated use `mode: "single"` (same effect; without `token` it falls back to $FLIPPER) */
  hidePicker?: boolean;
  /**
   * "auto" (default): the view takes the embed's content height (`autoHeight`). "fill": the embed fills the view,
   * whatever size you give it through `style` (a full screen, a tile); `autoHeight` then defaults to false.
   */
  fit?: "auto" | "fill";
  /**
   * Show the win chance / payout / fee line under the button. Default false: the widget only flags odds that fees
   * trim below the usual ("↓ Odds 0.9 pts below usual").
   */
  details?: boolean;
  /** A headline under the coin while idle: `true` for the built-in one, or your own text. Default none. */
  tagline?: string | boolean;
  /** everything else (brandName, brandLogo, coinImage, strings, minAmount, rpcUrl, …) */
  config?: FlipperEmbedConfig;
}

// ── events ──────────────────────────────────────────────────────────────────────────────────────
// Payloads per packages/widget/BRIDGE.md section 5. Amounts are decimal strings in the token's smallest unit.
// Every field is typed optional/nullable: the SDK passes the embed's data through without reshaping it.

export interface FlipperReadyData {
  version?: string;
  chainId?: number;
  account?: string | null;
  token?: string | null;
  variant?: string;
  partner?: string | null;
}

export interface FlipperConnectRequestData {
  reason?: "connect" | "flip" | "list";
  partner?: string | null;
}

export interface FlipperFlipRequestedData {
  flipId?: string;
  account?: string;
  token?: string;
  symbol?: string;
  decimals?: number;
  amount?: string;
  winChanceBps?: number | string;
  randomnessFee?: string;
  txHash?: string;
  approveTxHash?: string | null;
  /** the stake was native ETH, wrapped to WETH: `token` is WETH and `symbol` is "ETH" */
  native?: boolean;
  partner?: string | null;
}

export type FlipperFlipStatus = "Won" | "WonFallback" | "WinPending" | "Lost" | "LostInventory" | "Refunded";

export interface FlipperFlipSettledData {
  flipId?: string;
  account?: string;
  token?: string;
  symbol?: string;
  decimals?: number;
  amount?: string;
  outcome?: "won" | "lost" | "refunded";
  status?: FlipperFlipStatus;
  won?: boolean;
  /**
   * WinPending: stake back, winnings owed (the widget offers Retry payout). A second flip-settled with the same flipId
   * follows when they're paid, alongside `payout-resolved`.
   */
  pending?: boolean;
  /** what the player received in `payoutToken`, stake included ("0" on a loss) */
  payout?: string;
  payoutToken?: string;
  flipperPaid?: string;
  txHash?: string | null;
  requestTxHash?: string;
  /** the stake was native ETH, wrapped to WETH: `token` is WETH and `symbol` is "ETH" */
  native?: boolean;
  partner?: string | null;
}

/** A pending win (WinPending) was paid out. Sent once per flip, alongside the final flip-settled. */
export interface FlipperPayoutResolvedData {
  flipId?: string;
  account?: string;
  token?: string;
  symbol?: string;
  decimals?: number;
  /** winnings paid in `token` (the stake already came back at settlement) */
  tokenPaid?: string;
  /** $FLIPPER paid instead ("0" unless the token still couldn't be bought after the pending timeout) */
  flipperPaid?: string;
  /** "self": this widget's Retry payout paid it; "other": someone else did (usually flipper's payout worker) */
  by?: "self" | "other";
  /**
   * the stake was native ETH: `token` is WETH (the winnings are paid in WETH) and `symbol` is "ETH". False, with
   * "WETH", for a pending win the widget only learned about from an earlier session.
   */
  native?: boolean;
  /** the PendingWinResolved transaction (null if it couldn't be looked up) */
  txHash?: string | null;
  partner?: string | null;
}

export interface FlipperListingData {
  stage?: "started" | "submitted" | "listed" | "failed";
  token?: string;
  symbol?: string;
  txHash?: string | null;
  error?: string | null;
  partner?: string | null;
}

export type FlipperErrorCode =
  | "user-rejected"
  | "rejected"
  | "insufficient-funds"
  | "revert"
  | "timeout"
  | "config"
  | "network"
  | "wallet"
  | "unknown";

/**
 * Errors reported by the embed, plus the SDK's own (`context: "config"` for an invalid `baseUrl`, `code: "network"`
 * when the page fails to load). `message` is plain English and safe to show.
 */
export interface FlipperErrorData {
  code?: FlipperErrorCode | string;
  message?: string;
  context?: "config" | "wallet" | "preview" | "flip" | "listing" | string;
  partner?: string | null;
}

export interface FlipperResizeData {
  width?: number;
  height: number;
}

export interface FlipperEventDataMap {
  ready: FlipperReadyData;
  "connect-request": FlipperConnectRequestData;
  "flip-requested": FlipperFlipRequestedData;
  "flip-settled": FlipperFlipSettledData;
  "payout-resolved": FlipperPayoutResolvedData;
  listing: FlipperListingData;
  error: FlipperErrorData;
  resize: FlipperResizeData;
}
export type FlipperEventName = keyof FlipperEventDataMap;

export type KnownFlipperEvent = { [K in FlipperEventName]: { name: K; data: FlipperEventDataMap[K] } }[FlipperEventName];
/** An event this SDK version doesn't know yet (forward compatible); `rawName` is the embed's name for it. */
export interface UnknownFlipperEvent {
  name: "unknown";
  rawName: string;
  data: unknown;
}
export type FlipperEvent = KnownFlipperEvent | UnknownFlipperEvent;

/** Callbacks the bridge dispatches to. All optional. */
export interface FlipperEventHandlers {
  /** every event, including unknown ones */
  onEvent?: (event: FlipperEvent) => void;
  onReady?: (data: FlipperReadyData) => void;
  /**
   * The user tapped "Connect wallet" (or the embed asked for accounts with no wallet attached): open your wallet
   * UI. The widget updates itself once the `wallet` / `address` props change.
   */
  onConnectRequest?: (data: FlipperConnectRequestData) => void;
  onFlipRequested?: (data: FlipperFlipRequestedData) => void;
  onFlipSettled?: (data: FlipperFlipSettledData) => void;
  /** a pending win's winnings were paid (once per flip) */
  onPayoutResolved?: (data: FlipperPayoutResolvedData) => void;
  onListing?: (data: FlipperListingData) => void;
  onError?: (data: FlipperErrorData) => void;
  /** the embed's content height changed (CSS px, clamped to min/max height) */
  onResize?: (height: number) => void;
}

export type { WalletMethod };
