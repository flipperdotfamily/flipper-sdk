import type { FlipperWidget as FlipperWidgetElement } from "@flipperdotfamily/widget/element";
import { createElement, forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useFlipperConfig } from "./context";
import { EVENT_PROPS, OPTION_KEYS, type FlipperCallbacks, type FlipperOptions } from "./options";

export type { FlipperWidgetElement };

export interface FlipperWidgetProps extends FlipperOptions, FlipperCallbacks {
  className?: string;
  style?: CSSProperties;
  id?: string;
}

// useLayoutEffect warns during SSR; nothing here runs on the server anyway
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

let loading: Promise<unknown> | undefined;
/** Loads and registers the web component once, in the browser only. */
function loadWidget(): Promise<unknown> {
  loading ??= import("@flipperdotfamily/widget").then(() => customElements.whenDefined("flipper-widget"));
  return loading;
}

/**
 * The drop-in flip UI (`<flipper-widget>`), as a React component. Renders the tag on the server and upgrades on the
 * client. Wallets come from you: pass `provider` (EIP-1193) or `walletClient` (viem / wagmi), and open your connect
 * modal in `onConnectRequest`.
 *
 * ```tsx
 * const { data: walletClient } = useWalletClient();
 * <FlipperWidget walletClient={walletClient} theme="dark" partner="acme"
 *   onConnectRequest={() => openConnectModal()} onFlipSettled={(d) => toast(d.outcome)} />
 * ```
 */
export const FlipperWidget = forwardRef<FlipperWidgetElement | null, FlipperWidgetProps>(function FlipperWidget(props, ref) {
  const defaults = useFlipperConfig();
  const el = useRef<FlipperWidgetElement | null>(null);
  const [defined, setDefined] = useState(false);
  useImperativeHandle(ref, () => el.current as FlipperWidgetElement, [defined]);

  // latest callbacks, read by stable listeners
  const cbs = useRef<FlipperCallbacks>(props);
  cbs.current = props;

  useEffect(() => {
    let alive = true;
    void loadWidget().then(() => alive && setDefined(true));
    return () => {
      alive = false;
    };
  }, []);

  // listeners and properties work on the element before it's upgraded (Lit adopts pre-set properties)
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    // connect-request is delivered through the element's onConnectRequest property (set below), not the event:
    // listening to both would call the handler twice
    const offs = Object.entries(EVENT_PROPS)
      .filter(([event]) => event !== "connect-request")
      .map(([event, prop]) => {
      const fn = (e: Event) => (cbs.current[prop as keyof FlipperCallbacks] as ((d: unknown) => void) | undefined)?.((e as CustomEvent).detail);
      node.addEventListener(event, fn);
      return () => node.removeEventListener(event, fn);
    });
    return () => offs.forEach((off) => off());
  }, []);

  // options → element properties (only the changed ones)
  const hasConnect = !!props.onConnectRequest;
  useIsoLayoutEffect(() => {
    const node = el.current as unknown as Record<string, unknown> | null;
    if (!node) return;
    for (const k of OPTION_KEYS) {
      const v = props[k] !== undefined ? props[k] : defaults[k];
      if (v !== undefined && node[k] !== v) node[k] = v;
      else if (v === undefined && k in props && node[k] !== undefined && (k === "provider" || k === "walletClient")) node[k] = null;
    }
    // the widget's own fallback (eth_requestAccounts) stays on unless the host handles connect requests
    node.onConnectRequest = hasConnect ? (d: unknown) => cbs.current.onConnectRequest?.(d as never) : undefined;
  });

  return createElement("flipper-widget", {
    ref: el,
    id: props.id,
    className: props.className,
    style: props.style,
    variant: props.variant ?? defaults.variant,
    suppressHydrationWarning: true,
  });
});
