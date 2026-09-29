import type { FlipperEventMap, FlipperWidgetConfig } from "@flipperdotfamily/widget/element";

/** Every widget option the wrapper forwards to the element as a property. */
export const OPTION_KEYS = [
  "provider",
  "walletClient",
  "chainId",
  "rpcUrl",
  "apiUrl",
  "deploymentUrl",
  "addresses",
  "token",
  "tokens",
  "mode",
  "hidePicker",
  "eth",
  "listing",
  "minAmount",
  "maxAmount",
  "approval",
  "variant",
  "fit",
  "size",
  "details",
  "tagline",
  "theme",
  "accent",
  "radius",
  "branding",
  "brandName",
  "brandLogo",
  "coinImage",
  "coinImageTails",
  "buttonLabel",
  "locale",
  "strings",
  "reducedMotion",
  "partner",
] as const satisfies readonly (keyof FlipperWidgetConfig)[];

export type FlipperOptions = Omit<FlipperWidgetConfig, "onConnectRequest">;

/** DOM event → callback prop. */
export const EVENT_PROPS = {
  ready: "onReady",
  "connect-request": "onConnectRequest",
  "flip-requested": "onFlipRequested",
  "flip-settled": "onFlipSettled",
  "payout-resolved": "onPayoutResolved",
  listing: "onListing",
  error: "onError",
  resize: "onResize",
} as const satisfies Record<keyof FlipperEventMap, string>;

export interface FlipperCallbacks {
  onReady?: (detail: FlipperEventMap["ready"]) => void;
  /** The user wants to connect: open your wallet UI. Handling it stops the widget's own `eth_requestAccounts` fallback. */
  onConnectRequest?: (detail: FlipperEventMap["connect-request"]) => void;
  onFlipRequested?: (detail: FlipperEventMap["flip-requested"]) => void;
  onFlipSettled?: (detail: FlipperEventMap["flip-settled"]) => void;
  /** A pending win (WinPending) was paid out, by this widget's Retry payout (`by: "self"`) or someone else. Once per flip. */
  onPayoutResolved?: (detail: FlipperEventMap["payout-resolved"]) => void;
  onListing?: (detail: FlipperEventMap["listing"]) => void;
  onError?: (detail: FlipperEventMap["error"]) => void;
  onResize?: (detail: FlipperEventMap["resize"]) => void;
}
