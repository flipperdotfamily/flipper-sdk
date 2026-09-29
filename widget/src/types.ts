import type { Eip1193Provider, FlipperAddresses, FlipperWalletClient } from "@flipperdotfamily/sdk";
import type { FlipperStrings } from "./strings";

/**
 * Any viem client that can reach the user's wallet: a `WalletClient` (its `writeContract` is used as is, so local
 * accounts sign locally) or a bare `Client` with an account (its `request` is used, like an EIP-1193 provider).
 */
export interface WalletClientLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request: (...args: any[]) => Promise<any>;
  account?: { address: string; type?: string } | undefined;
  chain?: { id: number } | undefined;
}
export type { FlipperWalletClient };

export type FlipperThemeMode = "light" | "dark" | "auto";
/** "picker": the user chooses the token (default). "single": one fixed token, no picker at all. */
export type FlipperMode = "picker" | "single";
/** "auto": width from the container, height from the content (default). "fill": fill the element's width and height. */
export type FlipperFit = "auto" | "fill";
/** A scale on top of the fluid layout: sm 0.88×, md 1×, lg 1.14×. "auto" = md. */
export type FlipperSize = "sm" | "md" | "lg" | "auto";
export type FlipperVariant = "card" | "compact" | "button";
export type FlipperDensity = "compact" | "comfortable" | "spacious";

/** Colours. Every field is optional; unset ones keep the flipper palette of the current mode. */
export interface FlipperColors {
  /** CTA, focus ring, links, selected states */
  accent: string;
  /** text on the accent (computed for contrast when only `accent` is set) */
  accentText: string;
  /** the card */
  background: string;
  /** panels inside the card (the token picker) */
  surface: string;
  /** input field */
  field: string;
  border: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  /** wins: headline, halo, payout */
  win: string;
  /** errors and rejections */
  loss: string;
}

/**
 * The typed theme. Everything here can also be set with CSS custom properties on the element
 * (`--flipper-accent`, `--flipper-radius`, …); the theme object wins over them.
 */
export interface FlipperTheme extends Partial<FlipperColors> {
  /** default "auto": follows prefers-color-scheme */
  mode?: FlipperThemeMode;
  /** card corner radius (px number or CSS length); inner controls scale from it. Default 24 */
  radius?: number | string;
  /** UI font. "inherit" uses the host page's font */
  fontFamily?: string;
  /** headline font (default: the UI font's display companion) */
  displayFontFamily?: string;
  /** numbers and amounts */
  monoFontFamily?: string;
  /** spacing scale. Default "comfortable" */
  density?: FlipperDensity;
  /** coin diameter in px. Default: scales with the widget's width, 84–124 (52 in the compact variant) */
  coinSize?: number;
  /** card box-shadow; "none" to drop it */
  shadow?: string;
  /** card border width in px (0 to drop it) */
  borderWidth?: number;
  /** max width of the card. Default 460px; "none" fills the host */
  maxWidth?: string | number;
  /** per-mode colour overrides, applied over the flat colours above */
  light?: Partial<FlipperColors>;
  dark?: Partial<FlipperColors>;
}

/** Configuration shared by the web component (as properties / attributes), the framework wrappers and the embed. */
export interface FlipperWidgetConfig {
  // ── wallet (always the host's) ─────────────────────────────────────────────────────────────────────
  /** Any EIP-1193 provider. Reads never use it: they go through the widget's own RPC. */
  provider?: Eip1193Provider | null;
  /**
   * Alternatively a viem client for the connected account: a WalletClient (wagmi's `useWalletClient().data`) or a bare
   * connector client (`getConnectorClient()`). Pass `null` while disconnected.
   */
  walletClient?: WalletClientLike | null;
  /**
   * Called when a disconnected user presses Connect (or Flip): open your wallet UI. Without it, the widget dispatches
   * a cancelable `connect-request` event and, if nothing calls `preventDefault()`, asks the provider for accounts.
   */
  onConnectRequest?: (detail: FlipperEventMap["connect-request"]) => void;

  // ── network ────────────────────────────────────────────────────────────────────────────────────────
  /** Default 4663 (Robinhood Chain), or the manifest's default. Also accepts "robinhood", "local" as an attribute. */
  chainId?: number;
  /** Read RPC. Default: the chain's public RPC. */
  rpcUrl?: string;
  /** flipper API (token list, logos). Default: the deployment's. `null` turns the API off (onchain token list). */
  apiUrl?: string | null;
  /** Manifest with the live contract addresses. Default https://flipper.family/embed/deployment.json; `null` = none. */
  deploymentUrl?: string | null;
  /**
   * Integrator code only (a property, never an attribute, embed param or URL config): accept a fetched manifest whose
   * house / lens differ from the SDK's pinned canonical deployment (`CANONICAL_DEPLOYMENTS`), i.e. your own deployment.
   */
  allowUnpinnedDeployment?: boolean;
  /** Contract overrides. With `house` and `lens`, the manifest isn't fetched. */
  addresses?: Partial<FlipperAddresses> & { multicall3?: string };

  // ── tokens ─────────────────────────────────────────────────────────────────────────────────────────
  /** Token selected at start: an address, or "ETH". Default $FLIPPER. */
  token?: string;
  /**
   * "picker" (default): the user chooses the token; `tokens` narrows the list. "single": one fixed token, `token`
   * required; the picker isn't rendered at all and the amount row shows the token as a quiet label.
   */
  mode?: FlipperMode;
  /** Allowlist of token addresses (and/or "ETH"): the picker only offers these. One entry (and no `mode`) = single. */
  tokens?: string[];
  /** @deprecated Use `mode: "single"`. Same effect; without `token` it falls back to $FLIPPER. */
  hidePicker?: boolean;
  /** Offer native ETH (flipped as WETH). Default true. */
  eth?: boolean;
  /** Permissionless listing of eligible tokens from the picker. Default true. */
  listing?: boolean;
  /** Minimum stake, decimal string in token units ("10"). */
  minAmount?: string;
  /** Maximum stake, decimal string in token units. */
  maxAmount?: string;
  /** Allowance to request when short. Default "max" (later flips skip the approval). */
  approval?: "max" | "exact";

  // ── look ───────────────────────────────────────────────────────────────────────────────────────────
  /** "card" (default), "compact", or "button" (a button that opens the card in a modal). */
  variant?: FlipperVariant;
  /** "auto" (default): height follows the content. "fill": take the element's full height (give it one). */
  fit?: FlipperFit;
  /** Scale on top of the fluid layout: "sm" | "md" | "lg" | "auto" (= md). */
  size?: FlipperSize;
  /**
   * Show the win chance, payout and randomness fee under the button. Default false: the widget stays clean and only
   * flags odds that fees trim below the usual ("↓ Odds 0.9 pts below usual").
   */
  details?: boolean;
  /**
   * A headline under the coin while idle. Default none (the coin carries the idle state). `true`: the built-in one
   * ("Double or nothing" and its payout line, `strings.tagline` / `strings.taglineSub`); a string: your own line.
   */
  tagline?: string | boolean;
  /** "light" | "dark" | "auto" or a full theme object. */
  theme?: FlipperThemeMode | FlipperTheme;
  /** Shorthand for theme.accent. */
  accent?: string;
  /** Shorthand for theme.radius (px). */
  radius?: number;
  /** false removes the flipper.family marks (footer, dolphin coin faces). Default true. */
  branding?: boolean;
  /** Your name in the header (replaces "flipper"). */
  brandName?: string;
  /** Your logo (image URL) in the header. */
  brandLogo?: string;
  /** Image for the coin's heads face (square, transparent PNG/SVG works best). */
  coinImage?: string;
  /** Image for the tails face. */
  coinImageTails?: string;
  /** Label of the trigger in the "button" variant. Default "Flip {symbol}". */
  buttonLabel?: string;
  /** Built-in string table: "en" (default) or "es". */
  locale?: string;
  /** Override any string (see `FlipperStrings`). */
  strings?: Partial<FlipperStrings>;
  /** true / false to force; default follows prefers-reduced-motion. */
  reducedMotion?: boolean;

  // ── attribution ────────────────────────────────────────────────────────────────────────────────────
  /** Your partner id (`[A-Za-z0-9._:-]{1,64}`): echoed in every event, sent as `X-Flipper-Partner` on API calls. */
  partner?: string;
}

// ── events ───────────────────────────────────────────────────────────────────────────────────────────

/** Every event's `detail` includes the partner id. Amounts are wei as decimal strings (JSON-safe). */
export interface FlipperEventMap {
  ready: { version: string; chainId: number | null; account: string | null; token: string | null; variant: FlipperVariant; partner: string | null };
  "connect-request": { reason: "connect" | "flip" | "list"; partner: string | null };
  "flip-requested": {
    flipId: string;
    account: string;
    token: string;
    symbol: string;
    decimals: number;
    amount: string;
    winChanceBps: number;
    randomnessFee: string;
    txHash: string;
    approveTxHash: string | null;
    /** the stake was native ETH, wrapped into WETH (`token`) */
    native: boolean;
    partner: string | null;
  };
  "flip-settled": {
    flipId: string;
    account: string;
    token: string;
    symbol: string;
    decimals: number;
    amount: string;
    outcome: "won" | "lost" | "refunded";
    status: "Won" | "WonFallback" | "WinPending" | "Lost" | "LostInventory" | "Refunded";
    won: boolean;
    /** WinPending: the stake is back and the winnings are owed. A second flip-settled (and a `payout-resolved`) follows when they're paid */
    pending: boolean;
    /** received in `payoutToken`, stake included ("0" on a loss) */
    payout: string;
    payoutToken: string;
    /** $FLIPPER paid on top (WonFallback, $FLIPPER bonus) */
    flipperPaid: string;
    txHash: string | null;
    requestTxHash: string;
    native: boolean;
    partner: string | null;
  };
  /** A pending win (WinPending) was paid out: once per flip, from the result view or the pending-wins banner. */
  "payout-resolved": {
    flipId: string;
    account: string;
    /** the flipped token, which the winnings are paid in (WETH for a native-ETH flip) */
    token: string;
    /** as in flip-settled: "ETH" for a native-ETH flip */
    symbol: string;
    decimals: number;
    /** winnings paid in `token` (the stake already came back at settlement) */
    tokenPaid: string;
    /** $FLIPPER paid instead: after the pending timeout, when the token still couldn't be bought ("0" otherwise) */
    flipperPaid: string;
    /** "self": this widget's Retry payout paid it; "other": someone else did (usually flipper's payout worker) */
    by: "self" | "other";
    /**
     * the stake was native ETH, wrapped into WETH (`token`). A pending win from an earlier session can't be told
     * apart from a WETH flip, so it reports false (and "WETH")
     */
    native: boolean;
    /** the PendingWinResolved transaction (null if it couldn't be looked up) */
    txHash: string | null;
    partner: string | null;
  };
  listing: {
    stage: "started" | "submitted" | "listed" | "failed";
    token: string;
    symbol: string;
    venue: "v4" | "v3" | "hookit" | null;
    txHash: string | null;
    error: string | null;
    partner: string | null;
  };
  error: {
    code: "user-rejected" | "rejected" | "insufficient-funds" | "revert" | "timeout" | "config" | "network" | "wallet" | "unknown";
    message: string;
    context: "config" | "wallet" | "preview" | "flip" | "listing";
    partner: string | null;
  };
  resize: { width: number; height: number };
}

export type FlipperEventName = keyof FlipperEventMap;
export const FLIPPER_EVENTS: readonly FlipperEventName[] = ["ready", "connect-request", "flip-requested", "flip-settled", "payout-resolved", "listing", "error", "resize"];

/** Typed listener for a widget event (the `detail` is passed first). Returns an unsubscribe function. */
export function onFlipperEvent<K extends FlipperEventName>(
  el: EventTarget,
  name: K,
  fn: (detail: FlipperEventMap[K], event: CustomEvent<FlipperEventMap[K]>) => void,
): () => void {
  const h = (e: Event) => fn((e as CustomEvent<FlipperEventMap[K]>).detail, e as CustomEvent<FlipperEventMap[K]>);
  el.addEventListener(name, h);
  return () => el.removeEventListener(name, h);
}
