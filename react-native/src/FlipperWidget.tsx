import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ComponentType, type RefAttributes } from "react";
import { Linking, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { WebView as RNWebView, type WebViewMessageEvent, type WebViewProps } from "react-native-webview";
import type {
  ShouldStartLoadRequest,
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
  WebViewOpenWindowEvent,
} from "react-native-webview/lib/WebViewTypes";
import { FlipperBridgeCore, type BridgeHandlers } from "./bridge";
import { DEFAULT_CHAIN_ID, DEFAULT_EMBED_URL, DEFAULT_INITIAL_HEIGHT, DEFAULT_MIN_HEIGHT, SDK_VERSION, type BridgeMethod } from "./constants";
import { normalizeAccounts, normalizeChainId } from "./encoding";
import { decideNavigation } from "./navigation";
import { FLIPPER_HOST_SCRIPT } from "./scripts";
import type { FlipperEmbedConfig, FlipperEmbedOptions, FlipperEventHandlers, FlipperWallet, FlipperWalletState } from "./types";
import { buildEmbedUrl, diffConfig, FlipperConfigError, hostOnlyConfigOf, liveConfigOf, type EmbedUrl } from "./url";
import { watchWallet } from "./wallet";

/** The WebView methods the widget uses. */
interface WebViewHandle {
  injectJavaScript(script: string): void;
  reload(): void;
}
// react-native-webview 14.0.x declares `class WebView<P = undefined>`, whose props collapse to `never` under
// strictNullChecks; 13.x used `P = {}`. A narrow component type works with both.
const WebView = RNWebView as unknown as ComponentType<WebViewProps & RefAttributes<WebViewHandle>>;

declare const __DEV__: boolean | undefined;
const isDev = typeof __DEV__ !== "undefined" && !!__DEV__;

/** WebView props the widget controls for security or bridging; `webViewProps` can't override them. */
type ManagedWebViewProp =
  | "source"
  | "onMessage"
  | "injectedJavaScript"
  | "injectedJavaScriptBeforeContentLoaded"
  | "injectedJavaScriptForMainFrameOnly"
  | "injectedJavaScriptBeforeContentLoadedForMainFrameOnly"
  | "onShouldStartLoadWithRequest"
  | "onOpenWindow"
  | "originWhitelist"
  | "javaScriptEnabled"
  | "allowFileAccess"
  | "allowFileAccessFromFileURLs"
  | "allowUniversalAccessFromFileURLs"
  | "allowingReadAccessToURL"
  | "mixedContentMode"
  | "javaScriptCanOpenWindowsAutomatically"
  | "setSupportMultipleWindows"
  | "geolocationEnabled"
  | "mediaCapturePermissionGrantType"
  | "webviewDebuggingEnabled"
  | "onLoadStart"
  | "onContentProcessDidTerminate"
  | "onRenderProcessGone";

export interface FlipperWidgetProps extends FlipperEmbedOptions, FlipperEventHandlers {
  /**
   * The host app's wallet: any EIP-1193 provider (Reown AppKit `useProvider().provider`, WalletConnect
   * EthereumProvider, a wagmi connector provider, MetaMask SDK, a viem WalletClient, …) or `createFlipperWallet(…)`.
   * `null` / omitted = no wallet: the widget is read-only and "Connect" calls `onConnectRequest`.
   */
  wallet?: FlipperWallet | null;
  /**
   * The connected address, when your wallet library exposes state through hooks (e.g. AppKit's `useAccount()`)
   * rather than EIP-1193 events. Overrides what the provider reports; `null` = disconnected.
   */
  address?: string | null;
  /** All connected accounts, active first (alternative to `address`). */
  accounts?: readonly string[];
  /** The wallet's current chain (number, hex, or CAIP-2 "eip155:4663"); overrides the provider's `chainChanged`. */
  walletChainId?: number | string | null;

  /** default https://flipper.family/embed */
  baseUrl?: string;
  /** allow http://localhost / 127.0.0.1 / 10.0.2.2 embed URLs (default `__DEV__`) */
  allowInsecureLocalhost?: boolean;
  /**
   * Also forward the optional EIP-5792 methods (`wallet_getCapabilities`, `wallet_sendCalls`,
   * `wallet_getCallsStatus`), so wallets that support atomic batches can confirm a native-ETH flip (wrap + approve +
   * flip) once. Default false: they're answered with 4200 and the embed sends the transactions one by one.
   */
  enableBatchCalls?: boolean;
  /** narrow the wallet methods the embed may call (default: the seven wallet methods, plus the batch ones if enabled) */
  allowedMethods?: readonly BridgeMethod[];

  /**
   * size the view to the embed's content (default true, or false with `fit="fill"`); set false and give `style` a
   * height to scroll inside
   */
  autoHeight?: boolean;
  /** height before the first `resize` (default 560) */
  initialHeight?: number;
  /** default 120 */
  minHeight?: number;
  maxHeight?: number;

  /** container style (width, margins, a fixed height with `autoHeight={false}`, …) */
  style?: StyleProp<ViewStyle>;
  /** open links outside the embed (default `Linking.openURL`) */
  onOpenExternalUrl?: (url: string) => void;
  /** extra WebView props (e.g. `testID`, `renderLoading`); security-related props are fixed by the widget */
  webViewProps?: Omit<Partial<WebViewProps>, ManagedWebViewProp>;
  /** log dropped messages and bridge errors to the console (default `__DEV__`) */
  debug?: boolean;
}

export interface FlipperWidgetHandle {
  /** Reload the embed (live config changes are re-applied after it loads). */
  reload(): void;
  /** Send a live config update (`FlipperEmbedConfig` fields: theme, accent, token, strings, …). */
  setConfig(partial: FlipperEmbedConfig): void;
  /** Re-read the wallet's accounts / chain and push them to the embed. */
  refreshWallet(): void;
}

function openExternally(url: string, custom?: (url: string) => void) {
  if (custom) custom(url);
  else Linking.openURL(url).catch(() => undefined);
}

/**
 * The flipper.family flip widget: the hosted embed in a WebView, wired to your app's wallet over the embed bridge.
 *
 * ```tsx
 * <FlipperWidget
 *   wallet={provider}
 *   address={address}
 *   walletChainId={chainId}
 *   theme="dark"
 *   accent="#ff5a1f"
 *   partner="acme"
 *   onConnectRequest={() => open()}
 *   onFlipSettled={(f) => console.log(f.outcome)}
 * />
 * ```
 */
export const FlipperWidget = forwardRef<FlipperWidgetHandle, FlipperWidgetProps>(function FlipperWidget(props, ref) {
  const {
    wallet,
    address,
    accounts: accountsProp,
    walletChainId,
    chain = DEFAULT_CHAIN_ID,
    partner,
    baseUrl = DEFAULT_EMBED_URL,
    allowInsecureLocalhost = isDev,
    enableBatchCalls = false,
    allowedMethods,
    autoHeight = props.fit !== "fill",
    initialHeight = DEFAULT_INITIAL_HEIGHT,
    minHeight = DEFAULT_MIN_HEIGHT,
    maxHeight,
    style,
    webViewProps,
    debug = isDev,
  } = props;

  const latest = useRef(props);
  latest.current = props;
  const webRef = useRef<WebViewHandle>(null);
  const [height, setHeight] = useState(initialHeight);
  const [reloadCount, setReloadCount] = useState(0);

  // ── URL: rebuilt only when its identity (baseUrl / chain / partner) changes ──────────────────
  // Other config props are applied live (config messages), diffed against what the page was loaded with.
  const { embed, loaded } = useMemo(() => {
    const loaded = { current: liveConfigOf(latest.current) };
    try {
      return { embed: buildEmbedUrl({ ...latest.current, chain, partner, baseUrl, allowInsecureLocalhost }) as EmbedUrl | FlipperConfigError, loaded };
    } catch (err) {
      return { embed: err instanceof FlipperConfigError ? err : new FlipperConfigError(String(err)), loaded };
    }
  }, [baseUrl, chain, partner, allowInsecureLocalhost]);
  const embedOk = !(embed instanceof FlipperConfigError);

  useEffect(() => {
    if (embed instanceof FlipperConfigError) latest.current.onError?.({ code: "config", context: "config", message: embed.message });
  }, [embed]);

  // ── bridge ────────────────────────────────────────────────────────────────────────────────────
  const walletRef = useRef(wallet);
  walletRef.current = wallet;
  const log = useCallback((message: string, detail?: unknown) => {
    if (latest.current.debug ?? isDev) console.warn(message, detail ?? "");
  }, []);

  const watcher = useRef<ReturnType<typeof watchWallet> | null>(null);
  const handlers = useCallback(
    (): BridgeHandlers => {
      const p = latest.current;
      return {
        onEvent: p.onEvent,
        onReady: p.onReady,
        onConnectRequest: p.onConnectRequest,
        onFlipRequested: p.onFlipRequested,
        onFlipSettled: p.onFlipSettled,
        onPayoutResolved: p.onPayoutResolved,
        onListing: p.onListing,
        onError: p.onError,
        onResize: (h) => {
          if (latest.current.autoHeight ?? latest.current.fit !== "fill") setHeight(h);
          latest.current.onResize?.(h);
        },
        onRpcSettled: (method, ok) => {
          if (ok && (method === "eth_requestAccounts" || method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain"))
            void watcher.current?.refresh().catch(() => undefined);
        },
      };
    },
    [],
  );

  const bridge = useMemo(
    () =>
      new FlipperBridgeCore({
        embedOrigin: embedOk ? embed.origin : "",
        chainId: chain,
        inject: (js) => webRef.current?.injectJavaScript(js),
        getWallet: () => walletRef.current,
        enableBatchCalls,
        allowedMethods,
        // rpcUrl / apiUrl / addresses: the embed ignores them in its URL, so they go in a config message after ready
        hostConfig: hostOnlyConfigOf(latest.current),
        handlers,
        minHeight,
        maxHeight,
        log,
      }),
    // a new bridge per page identity; everything else is updated in place below
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [embed],
  );
  useEffect(() => () => bridge.dispose(), [bridge]);
  useEffect(() => {
    bridge.update({ chainId: chain, enableBatchCalls, allowedMethods, minHeight, maxHeight });
  }, [bridge, chain, enableBatchCalls, allowedMethods, minHeight, maxHeight]);

  // ── wallet state: provider events, overridden by explicit props ──────────────────────────────
  const [providerState, setProviderState] = useState<FlipperWalletState>({ accounts: [], chainId: null });
  useEffect(() => {
    setProviderState({ accounts: [], chainId: null });
    if (!wallet) {
      watcher.current = null;
      return;
    }
    const w = watchWallet(wallet, (update) => setProviderState((s) => ({ ...s, ...update })));
    watcher.current = w;
    return () => {
      w.stop();
      if (watcher.current === w) watcher.current = null;
    };
  }, [wallet]);

  const overrideAccounts = accountsProp !== undefined ? normalizeAccounts(accountsProp) : address !== undefined ? normalizeAccounts(address) : undefined;
  // Without a wallet the embed is read-only: an address alone would show "connected" but every RPC would fail.
  const effAccounts = wallet ? (overrideAccounts ?? providerState.accounts) : [];
  const effChain = !wallet ? null : walletChainId !== undefined ? normalizeChainId(walletChainId) : providerState.chainId;
  const walletKey = JSON.stringify([effAccounts, effChain]);
  useEffect(() => {
    bridge.setWalletState({ accounts: effAccounts, chainId: effChain });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, walletKey]);

  // ── live config: diff the props against what the page was loaded with ───────────────────────
  const liveConfig = liveConfigOf(props);
  const liveKey = JSON.stringify(liveConfig);
  useEffect(() => {
    const changed = diffConfig(loaded.current, liveConfig);
    if (changed) {
      loaded.current = { ...loaded.current, ...changed };
      bridge.sendConfig(changed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, loaded, liveKey]);

  useImperativeHandle(
    ref,
    () => ({
      reload: () => {
        bridge.pageStarted();
        setReloadCount((n) => n + 1);
      },
      setConfig: (partial) => bridge.sendConfig(partial),
      refreshWallet: () => void watcher.current?.refresh().catch(() => undefined),
    }),
    [bridge],
  );

  // ── navigation policy ─────────────────────────────────────────────────────────────────────────
  const onShouldStartLoadWithRequest = useCallback(
    (req: ShouldStartLoadRequest): boolean => {
      if (!embedOk) return false;
      const decision = decideNavigation(req.url, embed.origin, req.isTopFrame !== false);
      if (decision === "open-external") openExternally(req.url, latest.current.onOpenExternalUrl);
      return decision === "allow";
    },
    [embed, embedOk],
  );
  // target=_blank / window.open: never a second WebView; external targets go to the system browser
  const onOpenWindow = useCallback(
    (e: WebViewOpenWindowEvent) => {
      const url = e.nativeEvent.targetUrl;
      if (embedOk && decideNavigation(url, embed.origin, true) === "open-external") openExternally(url, latest.current.onOpenExternalUrl);
    },
    [embed, embedOk],
  );

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => bridge.handleMessage(e.nativeEvent.data, { url: e.nativeEvent.url }),
    [bridge],
  );

  if (!embedOk) return <View style={[styles.container, autoHeight && { height: minHeight }, style]} />;

  return (
    <View style={[styles.container, autoHeight && { height }, style]}>
      <WebView
        applicationNameForUserAgent={`FlipperReactNative/${SDK_VERSION}`}
        {...webViewProps}
        key={`${embed.url}#${reloadCount}`}
        ref={webRef}
        source={{ uri: embed.url }}
        style={[styles.webView, webViewProps?.style]}
        containerStyle={[styles.webView, webViewProps?.containerStyle]}
        // bridge
        injectedJavaScriptBeforeContentLoaded={FLIPPER_HOST_SCRIPT}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly
        injectedJavaScript={FLIPPER_HOST_SCRIPT}
        injectedJavaScriptForMainFrameOnly
        onMessage={onMessage}
        onLoadStart={() => bridge.pageStarted()}
        // navigation: every URL goes through onShouldStartLoadWithRequest (none are auto-opened by the WebView)
        originWhitelist={["*"]}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        setSupportMultipleWindows
        onOpenWindow={onOpenWindow}
        javaScriptCanOpenWindowsAutomatically={false}
        // hardening
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
        geolocationEnabled={false}
        mediaCapturePermissionGrantType="deny"
        allowsLinkPreview={false}
        allowsBackForwardNavigationGestures={false}
        setBuiltInZoomControls={false}
        setDisplayZoomControls={false}
        textZoom={100}
        webviewDebuggingEnabled={debug}
        // layout
        scrollEnabled={!autoHeight}
        nestedScrollEnabled
        bounces={false}
        overScrollMode="never"
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={!autoHeight}
        // recover from a killed web process
        onContentProcessDidTerminate={() => webRef.current?.reload()}
        onRenderProcessGone={() => setReloadCount((n) => n + 1)}
        onError={(e: WebViewErrorEvent) => {
          latest.current.onError?.({ code: "network", context: "config", message: e.nativeEvent.description || "The widget failed to load." });
          webViewProps?.onError?.(e);
        }}
        onHttpError={(e: WebViewHttpErrorEvent) => {
          latest.current.onError?.({
            code: "network",
            context: "config",
            message: `The widget failed to load (HTTP ${e.nativeEvent.statusCode}).`,
          });
          webViewProps?.onHttpError?.(e);
        }}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: { width: "100%", backgroundColor: "transparent", overflow: "hidden" },
  webView: { flex: 1, backgroundColor: "transparent" },
});
