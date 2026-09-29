import type { Component } from "svelte";
import type { FlipperEventMap, FlipperWidget as FlipperWidgetElement, FlipperWidgetConfig } from "@flipperdotfamily/widget/element";

export type { FlipperEventMap, FlipperEventName, FlipperTheme, FlipperThemeMode, FlipperVariant, FlipperWidgetConfig, FlipperStrings } from "@flipperdotfamily/widget/element";
export type { FlipperWidgetElement };

export interface FlipperWidgetProps extends Omit<FlipperWidgetConfig, "onConnectRequest"> {
  /** bind:element gives you the <flipper-widget> element (open(), close(), refresh(), client) */
  element?: FlipperWidgetElement;
  class?: string;
  style?: string;
  onReady?: (detail: FlipperEventMap["ready"]) => void;
  /** open your wallet UI; handling it stops the widget's own eth_requestAccounts fallback */
  onConnectRequest?: (detail: FlipperEventMap["connect-request"]) => void;
  onFlipRequested?: (detail: FlipperEventMap["flip-requested"]) => void;
  onFlipSettled?: (detail: FlipperEventMap["flip-settled"]) => void;
  /** a pending win (WinPending) was paid out: by this widget's Retry payout (by: "self") or someone else; once per flip */
  onPayoutResolved?: (detail: FlipperEventMap["payout-resolved"]) => void;
  onListing?: (detail: FlipperEventMap["listing"]) => void;
  onError?: (detail: FlipperEventMap["error"]) => void;
  onResize?: (detail: FlipperEventMap["resize"]) => void;
}

export declare const FlipperWidget: Component<FlipperWidgetProps, {}, "element">;
export default FlipperWidget;
