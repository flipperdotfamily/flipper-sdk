import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/widgets.dart';
import 'package:url_launcher/url_launcher.dart' show LaunchMode, launchUrl;
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart'
    show AndroidWebViewController, MixedContentMode;
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart'
    show
        WebKitWebViewController,
        WebKitWebViewControllerCreationParams,
        WebKitWebViewPlatform;

import 'bridge.dart';
import 'config.dart';
import 'events.dart';
import 'url.dart';
import 'wallet.dart';

/// Name of the JavaScript channel the embed posts to
/// (`window.FlipperHost.postMessage(json)`).
const String kFlipperHostChannel = 'FlipperHost';

/// Default height before the embed reports its own (logical pixels).
const double kFlipperInitialHeight = 560;

/// Default minimum height (logical pixels).
const double kFlipperMinHeight = 120;

/// Controls a mounted [FlipperWidget]: live config updates and reloads.
///
/// ```dart
/// final flipper = FlipperWidgetController();
/// // ...
/// FlipperWidget(controller: flipper, wallet: wallet);
/// // later, e.g. when the app switches to dark mode:
/// flipper.setConfig({'theme': 'dark'});
/// ```
class FlipperWidgetController {
  _FlipperWidgetState? _state;
  final Map<String, Object?> _pending = <String, Object?>{};

  /// Whether a [FlipperWidget] is using this controller.
  bool get isAttached => _state != null;

  /// Whether the current embed page sent `ready`.
  bool get isReady => _state?._bridge.isReady ?? false;

  /// Sends a live `config` message to the embed. [partial] uses the embed's
  /// `FlipperEmbedConfig` field names (`theme`, `accent`, `radius`,
  /// `branding`, `locale`, `variant`, `hidePicker`, `token`, `tokens`,
  /// `brandName`, `strings`, ...) and JSON-compatible values.
  ///
  /// Queued until the embed is ready (partials merge). This does not change
  /// the widget's `config` / `theme` properties: the next time those change,
  /// only their own difference is sent, and a reload starts from them.
  ///
  /// Throws a [JsonUnsupportedObjectError] if a value isn't JSON-compatible.
  void setConfig(Map<String, Object?> partial) {
    final state = _state;
    if (state == null) {
      jsonEncode(partial);
      _pending.addAll(partial);
      return;
    }
    state._bridge.sendConfig(partial);
  }

  /// Reloads the embed from the widget's current properties.
  Future<void> reload() async {
    await _state?._reload();
  }

  /// Sends the wallet's current state to the embed again. Only needed if
  /// your [FlipperWallet] cannot emit on its streams.
  void refreshWallet() {
    _state?._bridge.pushWalletState();
  }

  void _attach(_FlipperWidgetState state) {
    _state = state;
    if (_pending.isNotEmpty) {
      final pending = Map<String, Object?>.of(_pending);
      _pending.clear();
      state._bridge.sendConfig(pending);
    }
  }

  void _detach(_FlipperWidgetState state) {
    if (identical(_state, state)) _state = null;
  }
}

/// The flipper.family coin-flip widget.
///
/// Loads the hosted embed (`https://flipper.family/embed`) in a WebView and
/// routes its wallet requests to [wallet], the wallet your app already has.
/// The embed never holds keys: every transaction goes through your wallet's
/// own confirmation UI.
///
/// ```dart
/// FlipperWidget(
///   wallet: myWallet, // a FlipperWallet, null until the user connects
///   config: const FlipperConfig(partner: 'acme'),
///   theme: const FlipperTheme(mode: FlipperThemeMode.dark, accent: '#7C5CFF'),
///   onConnectRequest: (_) => openMyConnectSheet(),
///   onFlipSettled: (e) => debugPrint('flip ${e.flipId}: ${e.outcome}'),
/// )
/// ```
///
/// The widget takes the full width it is given. With [autoHeight] (default)
/// it sizes itself to the embed's content, so it works inside scroll views.
class FlipperWidget extends StatefulWidget {
  /// Creates the widget.
  const FlipperWidget({
    super.key,
    this.wallet,
    this.config = const FlipperConfig(),
    this.theme = const FlipperTheme(),
    this.baseUrl = kFlipperEmbedUrl,
    this.allowInsecureLocalhost = kDebugMode,
    this.allowedMethods,
    this.enableBatchCalls = false,
    this.controller,
    this.autoHeight = true,
    this.initialHeight = kFlipperInitialHeight,
    this.minHeight = kFlipperMinHeight,
    this.maxHeight,
    this.placeholder,
    this.gestureRecognizers = const <Factory<OneSequenceGestureRecognizer>>{},
    this.onEvent,
    this.onReady,
    this.onConnectRequest,
    this.onFlipRequested,
    this.onFlipSettled,
    this.onPayoutResolved,
    this.onListing,
    this.onError,
    this.onResize,
  })  : assert(minHeight >= 0, 'minHeight must not be negative'),
        assert(initialHeight > 0, 'initialHeight must be positive'),
        assert(
          (maxHeight ?? double.infinity) >= minHeight,
          'maxHeight must be at least minHeight',
        );

  /// The embed URL for a local `./dev.sh` web app on this platform:
  /// `http://10.0.2.2:3000/embed` on Android (the emulator's alias for the
  /// host machine), `http://localhost:3000/embed` elsewhere. Plain http is
  /// accepted only while [allowInsecureLocalhost] is true (debug builds).
  static String get localDevBaseUrl =>
      defaultTargetPlatform == TargetPlatform.android
          ? kFlipperAndroidEmulatorEmbedUrl
          : kFlipperLocalEmbedUrl;

  /// The host app's wallet. `null` (or a wallet with no accounts) means
  /// "not connected": the embed shows prices and asks to connect through
  /// [onConnectRequest]. Swapping it for another object resubscribes.
  final FlipperWallet? wallet;

  /// What to show: chain, token(s), partner id, locale, layout, branding and
  /// extra embed config. Changing `chain` or `partner` reloads the embed;
  /// other changes are applied live.
  final FlipperConfig config;

  /// Colour mode, accent and corner radius. Applied live when changed.
  final FlipperTheme theme;

  /// The embed page. Must be `https`, or `http` on localhost / 127.0.0.1 /
  /// 10.0.2.2 / ::1 while [allowInsecureLocalhost] is true. Changing it
  /// reloads.
  final String baseUrl;

  /// Accept `http` [baseUrl]s on local hosts. Defaults to [kDebugMode], so
  /// release builds only ever load `https`.
  final bool allowInsecureLocalhost;

  /// Narrows the wallet methods the embed may call (`null`: all of
  /// [kFlipperRpcMethods], plus [kFlipperBatchCallMethods] with
  /// [enableBatchCalls]). Methods outside that set are ignored; the list
  /// can't be widened. Others are answered with error 4200.
  final Set<String>? allowedMethods;

  /// Also forward the optional EIP-5792 methods ([kFlipperBatchCallMethods]:
  /// `wallet_getCapabilities`, `wallet_sendCalls`, `wallet_getCallsStatus`),
  /// so wallets that support atomic batches confirm a native-ETH flip once.
  /// Default false: they're answered with 4200 and the embed sends the
  /// transactions one by one.
  final bool enableBatchCalls;

  /// Optional controller for live config updates and reloads.
  final FlipperWidgetController? controller;

  /// Size the widget to the embed's `resize` reports (clamped to
  /// [minHeight] / [maxHeight]). When false the widget fills a bounded
  /// parent height, or uses [initialHeight].
  final bool autoHeight;

  /// Height until the embed reports its own.
  final double initialHeight;

  /// Lower bound for the height.
  final double minHeight;

  /// Upper bound for the height (`null`: none). When the embed is taller it
  /// scrolls inside the widget.
  final double? maxHeight;

  /// Shown over the WebView until the embed is ready (for example a
  /// skeleton or a progress indicator). The WebView is transparent.
  final Widget? placeholder;

  /// Gestures the WebView should claim from enclosing scroll views. Empty by
  /// default, so vertical drags scroll the page around an auto-height widget.
  final Set<Factory<OneSequenceGestureRecognizer>> gestureRecognizers;

  /// Every event from the embed, typed (see [FlipperEvent]); unknown event
  /// names arrive as [FlipperUnknownEvent]. Called before the specific
  /// callbacks below.
  final ValueChanged<FlipperEvent>? onEvent;

  /// The embed is ready; the widget has just sent it the wallet state.
  final ValueChanged<FlipperReadyEvent>? onReady;

  /// The user wants to connect: open your wallet's connect flow. Also called
  /// when the embed sends `eth_requestAccounts` while no wallet is connected.
  final ValueChanged<FlipperConnectRequestEvent>? onConnectRequest;

  /// A flip transaction was mined; the coin is spinning.
  final ValueChanged<FlipperFlipRequestedEvent>? onFlipRequested;

  /// A flip settled (possibly twice for `WinPending`; de-duplicate by
  /// `flipId`).
  final ValueChanged<FlipperFlipSettledEvent>? onFlipSettled;

  /// A pending win's winnings were paid (once per flip, alongside the final
  /// `flip-settled`).
  final ValueChanged<FlipperPayoutResolvedEvent>? onPayoutResolved;

  /// Listing progress.
  final ValueChanged<FlipperListingEvent>? onListing;

  /// Errors: from the embed, plus host-side ones: `code: "config"` when the
  /// configuration is invalid (nothing is loaded), `code: "network"` when the
  /// embed page fails to load.
  final ValueChanged<FlipperErrorEvent>? onError;

  /// The embed reported a new height (already rounded up and clamped).
  final ValueChanged<double>? onResize;

  @override
  State<FlipperWidget> createState() => _FlipperWidgetState();
}

class _FlipperWidgetState extends State<FlipperWidget> {
  late final FlipperBridge _bridge;
  late final WebViewController _controller;

  bool _disposed = false;
  bool _webViewSetUp = false;
  bool _pageReady = false;
  Uri? _embedUri;
  String _embedPath = '';
  String? _pageOrigin;
  String? _configError;
  late double _height;

  @override
  void initState() {
    super.initState();
    _height = _clamp(widget.initialHeight);
    _bridge = FlipperBridge(
      embedOrigin: '',
      evaluate: _runJavaScript,
      chainId: widget.config.chain,
      allowedMethods: widget.allowedMethods,
      enableBatchCalls: widget.enableBatchCalls,
      wallet: widget.wallet,
      minHeight: widget.minHeight,
      maxHeight: widget.maxHeight,
      onEvent: (FlipperEvent e) => widget.onEvent?.call(e),
      onReady: _handleReady,
      onConnectRequest: (FlipperConnectRequestEvent e) =>
          widget.onConnectRequest?.call(e),
      onFlipRequested: (FlipperFlipRequestedEvent e) =>
          widget.onFlipRequested?.call(e),
      onFlipSettled: (FlipperFlipSettledEvent e) =>
          widget.onFlipSettled?.call(e),
      onPayoutResolved: (FlipperPayoutResolvedEvent e) =>
          widget.onPayoutResolved?.call(e),
      onListing: (FlipperListingEvent e) => widget.onListing?.call(e),
      onError: (FlipperErrorEvent e) => widget.onError?.call(e),
      onResize: _handleResize,
      onDebugLog: kDebugMode ? (String message) => debugPrint(message) : null,
      onCallbackError: _reportCallbackError,
    );
    _controller = _createController();
    _resolveUri(report: true);
    widget.controller?._attach(this);
    unawaited(_setUpWebView());
  }

  @override
  void didUpdateWidget(FlipperWidget oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.controller, widget.controller)) {
      oldWidget.controller?._detach(this);
      widget.controller?._attach(this);
    }
    _bridge
      ..enableBatchCalls = widget.enableBatchCalls
      ..allowedMethods = widget.allowedMethods
      ..minHeight = widget.minHeight
      ..maxHeight = widget.maxHeight;
    if (!identical(oldWidget.wallet, widget.wallet)) {
      _bridge.setWallet(widget.wallet);
    }

    final needsReload = oldWidget.baseUrl != widget.baseUrl ||
        oldWidget.allowInsecureLocalhost != widget.allowInsecureLocalhost ||
        oldWidget.config.chain != widget.config.chain ||
        oldWidget.config.partner != widget.config.partner;
    if (needsReload || _configError != null) {
      if (_resolveUri(report: true)) _load();
    } else {
      final diff = flipperConfigDiff(
        oldConfig: oldWidget.config,
        oldTheme: oldWidget.theme,
        newConfig: widget.config,
        newTheme: widget.theme,
      );
      if (diff.isNotEmpty) {
        try {
          _bridge.sendConfig(diff);
        } on JsonUnsupportedObjectError catch (error) {
          _reportConfigError('FlipperConfig.extra must be JSON-compatible '
              '($error).');
        }
        // Keep the URL current so a reload starts from the new properties.
        _resolveUri(report: false);
      }
    }

    if (oldWidget.minHeight != widget.minHeight ||
        oldWidget.maxHeight != widget.maxHeight) {
      _height = _clamp(_height);
    }
  }

  @override
  void dispose() {
    _disposed = true;
    widget.controller?._detach(this);
    _bridge.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final error = _configError;
    if (error != null) {
      if (kReleaseMode) return const SizedBox.shrink();
      return SizedBox(
        height: _clamp(widget.initialHeight),
        child: ErrorWidget(FlipperConfigException(error)),
      );
    }
    final placeholder = widget.placeholder;
    final content = Stack(
      fit: StackFit.expand,
      children: <Widget>[
        WebViewWidget(
          controller: _controller,
          gestureRecognizers: widget.gestureRecognizers,
        ),
        if (placeholder != null && !_pageReady) placeholder,
      ],
    );
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final double height;
        if (_autoSized) {
          height = _height;
        } else if (constraints.hasBoundedHeight) {
          height = constraints.maxHeight;
        } else {
          height = _clamp(widget.initialHeight);
        }
        return SizedBox(height: height, child: content);
      },
    );
  }

  // ------------------------------------------------------------------ setup

  WebViewController _createController() {
    final PlatformWebViewControllerCreationParams params;
    if (WebViewPlatform.instance is WebKitWebViewPlatform) {
      params = WebKitWebViewControllerCreationParams(
        allowsInlineMediaPlayback: true,
      );
    } else {
      params = const PlatformWebViewControllerCreationParams();
    }
    return WebViewController.fromPlatformCreationParams(
      params,
      // No camera, microphone or other device permission, ever.
      onPermissionRequest: (WebViewPermissionRequest request) {
        unawaited(request.deny());
      },
    );
  }

  Future<void> _setUpWebView() async {
    final controller = _controller;
    try {
      // Required: fail closed if any of these can't be applied.
      await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
      await controller.addJavaScriptChannel(
        kFlipperHostChannel,
        onMessageReceived: _onChannelMessage,
      );
      await controller.setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: _onNavigationRequest,
          onPageStarted: _onPageStarted,
          onPageFinished: _onPageFinished,
          onUrlChange: _onUrlChange,
          onWebResourceError: _onWebResourceError,
        ),
      );
    } catch (error) {
      _log('WebView setup failed: $error');
      if (!_disposed) {
        widget.onError?.call(
          FlipperErrorEvent.config(
            'The WebView could not be configured: $error',
            partner: widget.config.partner,
          ),
        );
      }
      return;
    }

    // Best effort hardening; defaults are already safe where these fail.
    await _bestEffort(
      'setBackgroundColor',
      () => controller.setBackgroundColor(const Color(0x00000000)),
    );
    await _bestEffort('enableZoom', () => controller.enableZoom(false));
    if (kDebugMode) {
      await _bestEffort(
        'setOnConsoleMessage',
        () => controller.setOnConsoleMessage(
          (JavaScriptConsoleMessage message) => debugPrint(
            '[flipper embed] ${message.level.name}: ${message.message}',
          ),
        ),
      );
    }
    final Object platform = controller.platform;
    if (platform is AndroidWebViewController) {
      await _bestEffort(
        'setAllowFileAccess',
        () => platform.setAllowFileAccess(false),
      );
      await _bestEffort(
        'setAllowContentAccess',
        () => platform.setAllowContentAccess(false),
      );
      await _bestEffort(
        'setGeolocationEnabled',
        () => platform.setGeolocationEnabled(false),
      );
      await _bestEffort(
        'setMixedContentMode',
        () => platform.setMixedContentMode(MixedContentMode.neverAllow),
      );
      await _bestEffort(
        'setMediaPlaybackRequiresUserGesture',
        () => platform.setMediaPlaybackRequiresUserGesture(true),
      );
      if (kDebugMode) {
        // Process-wide switch: only ever turned on, and only in debug builds.
        await _bestEffort(
          'enableDebugging',
          () => AndroidWebViewController.enableDebugging(true),
        );
      }
    } else if (platform is WebKitWebViewController) {
      await _bestEffort(
        'setAllowsLinkPreview',
        () => platform.setAllowsLinkPreview(false),
      );
      if (kDebugMode) {
        await _bestEffort(
          'setInspectable',
          () => platform.setInspectable(true),
        );
      }
    }

    if (_disposed) return;
    _webViewSetUp = true;
    _load();
  }

  // ---------------------------------------------------------------- loading

  /// Builds and validates the embed URL from the current properties.
  bool _resolveUri({required bool report}) {
    try {
      final uri = buildEmbedUri(
        baseUrl: widget.baseUrl,
        config: widget.config,
        theme: widget.theme,
        allowInsecureLocalhost: widget.allowInsecureLocalhost,
      );
      _embedUri = uri;
      _embedPath = flipperEmbedPathOf(uri);
      _bridge
        ..embedOrigin = flipperOriginOf(uri) ?? ''
        ..chainId = widget.config.chain
        // rpcUrl / apiUrl / addresses: not in the URL; sent after `ready`
        ..hostConfig = widget.config.hostOnlyConfig;
      _configError = null;
      return true;
    } on FlipperConfigException catch (error) {
      if (report) _failConfig(error.message);
      return false;
    } on JsonUnsupportedObjectError catch (error) {
      if (report) {
        _failConfig('FlipperConfig.extra must be JSON-compatible ($error).');
      }
      return false;
    }
  }

  void _failConfig(String message) {
    final repeated = _configError == message;
    _embedUri = null;
    _configError = message;
    _bridge.embedOrigin = '';
    if (!repeated) _reportConfigError(message);
  }

  void _reportConfigError(String message) {
    _log('configuration error: $message');
    final event = FlipperErrorEvent.config(
      message,
      partner: widget.config.partner,
    );
    // Deliver outside the build phase: the host may call setState.
    scheduleMicrotask(() {
      if (!_disposed) widget.onError?.call(event);
    });
  }

  void _load() {
    if (_disposed || !_webViewSetUp) return;
    final uri = _embedUri;
    if (uri == null) return;
    _bridge.pageLoadStarted();
    if (_pageReady) setState(() => _pageReady = false);
    unawaited(_bestEffort('loadRequest', () => _controller.loadRequest(uri)));
  }

  Future<void> _reload() async {
    if (_disposed) return;
    final ok = _resolveUri(report: true);
    setState(() {});
    if (ok) _load();
  }

  // ------------------------------------------------------ WebView callbacks

  void _onChannelMessage(JavaScriptMessage message) {
    if (_disposed) return;
    final origin = _pageOrigin;
    if (origin != null) {
      _bridge.handleMessage(message.message, origin: origin);
      return;
    }
    // No navigation callback has named the page yet: ask the WebView.
    _controller.currentUrl().then<void>(
      (String? url) {
        if (_disposed) return;
        _setPageUrl(url);
        _bridge.handleMessage(message.message, origin: _pageOrigin);
      },
      onError: (Object error) => _log('currentUrl failed: $error'),
    );
  }

  NavigationDecision _onNavigationRequest(NavigationRequest request) {
    final decision = decideFlipperNavigation(
      url: request.url,
      isMainFrame: request.isMainFrame,
      embedOrigin: _bridge.embedOrigin,
      embedPath: _embedPath,
    );
    switch (decision) {
      case FlipperNavigationDecision.allow:
        return NavigationDecision.navigate;
      case FlipperNavigationDecision.openExternally:
        _openExternally(request.url);
        return NavigationDecision.prevent;
      case FlipperNavigationDecision.block:
        _log('blocked a navigation to ${request.url}');
        return NavigationDecision.prevent;
    }
  }

  void _onPageStarted(String url) {
    if (_disposed) return;
    _setPageUrl(url);
    _bridge.pageLoadStarted();
    if (_pageReady) setState(() => _pageReady = false);
  }

  void _onPageFinished(String url) {
    if (_disposed) return;
    _setPageUrl(url);
    _installLinkShim();
  }

  void _onUrlChange(UrlChange change) {
    if (_disposed) return;
    final url = change.url;
    if (url != null) _setPageUrl(url);
  }

  void _onWebResourceError(WebResourceError error) {
    if (_disposed) return;
    if (error.isForMainFrame == false) return;
    // iOS: -999 cancelled, 102 frame load interrupted (a cancelled navigation).
    if (error.errorCode == -999 || error.errorCode == 102) return;
    final url = error.url;
    if (url != null && flipperOriginOfUrl(url) != _bridge.embedOrigin) return;
    final partner = widget.config.partner;
    widget.onError?.call(
      FlipperErrorEvent(
        code: 'network',
        message: 'The flipper widget could not be loaded: '
            '${error.description}',
        partner: partner,
        raw: <String, Object?>{
          'code': 'network',
          'message': error.description,
          'errorCode': error.errorCode,
          'url': url,
          'partner': partner,
        },
      ),
    );
  }

  void _setPageUrl(String? url) {
    if (url == null || url.isEmpty) return;
    _pageOrigin = flipperOriginOfUrl(url);
  }

  // ---------------------------------------------------------- bridge hooks

  void _runJavaScript(String javaScript) {
    if (_disposed) return;
    unawaited(
      _bestEffort('runJavaScript', () => _controller.runJavaScript(javaScript)),
    );
  }

  void _handleReady(FlipperReadyEvent event) {
    if (!_disposed && !_pageReady) setState(() => _pageReady = true);
    widget.onReady?.call(event);
  }

  /// The view follows the widget's content height: `autoHeight`, unless the
  /// config asks the widget to fill the view (`fit: FlipperFit.fill`).
  bool get _autoSized => widget.autoHeight && widget.config.fit != FlipperFit.fill;

  void _handleResize(double height, FlipperResizeEvent event) {
    if (_disposed) return;
    if (_autoSized && height != _height) {
      setState(() => _height = height);
    }
    widget.onResize?.call(height);
  }

  // ---------------------------------------------------------------- helpers

  /// WKWebView reports `target="_blank"` links and `window.open` as sub-frame
  /// navigations through webview_flutter, which the navigation policy blocks.
  /// This turns them into top-level navigation attempts, which the policy
  /// then cancels and opens in the system browser. iOS only; Android already
  /// routes new windows through the navigation delegate.
  void _installLinkShim() {
    if (_controller.platform is! WebKitWebViewController) return;
    if (_pageOrigin == null || _pageOrigin != _bridge.embedOrigin) return;
    _runJavaScript(_linkShim);
  }

  void _openExternally(String url) {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    unawaited(() async {
      try {
        final opened = await launchUrl(
          uri,
          mode: LaunchMode.externalApplication,
        );
        if (!opened) _log('no app could open $uri');
      } catch (error) {
        _log('could not open $uri: $error');
      }
    }());
  }

  double _clamp(double height) {
    var h = height;
    if (h < widget.minHeight) h = widget.minHeight;
    final max = widget.maxHeight;
    if (max != null && h > max) h = max;
    return h;
  }

  Future<void> _bestEffort(String what, Future<void> Function() action) async {
    try {
      await action();
    } catch (error) {
      _log('$what failed: $error');
    }
  }

  void _reportCallbackError(Object error, StackTrace stack) {
    FlutterError.reportError(
      FlutterErrorDetails(
        exception: error,
        stack: stack,
        library: 'flipper_family',
        context: ErrorDescription('while running a FlipperWidget callback'),
      ),
    );
  }

  void _log(String message) {
    if (kDebugMode) debugPrint('[flipper] $message');
  }
}

const String _linkShim = r'''
(function () {
  if (window.__flipperLinkShim) { return; }
  window.__flipperLinkShim = true;
  function go(u) {
    try {
      var a = new URL(String(u), document.baseURI);
      if (a.protocol === 'http:' || a.protocol === 'https:' ||
          a.protocol === 'mailto:' || a.protocol === 'tel:') {
        window.location.assign(a.href);
      }
    } catch (e) {}
  }
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented) { return; }
    var path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
    for (var i = 0; i < path.length; i++) {
      var n = path[i];
      if (n && n.tagName === 'A' && typeof n.href === 'string' && n.href) {
        var t = (n.getAttribute('target') || '').toLowerCase();
        if (t && t !== '_self' && t !== '_top' && t !== '_parent') {
          e.preventDefault();
          go(n.href);
        }
        return;
      }
    }
  }, false);
  window.open = function (u) { if (u) { go(u); } return null; };
})();
true;
''';
