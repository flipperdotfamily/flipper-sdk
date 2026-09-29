#if os(iOS)
import Combine
import UIKit
import WebKit

/// The flipper.family flip widget for UIKit: the hosted embed in a `WKWebView`, wired to your app's wallet.
///
/// ```swift
/// let widget = FlipperWidgetUIView(
///     config: FlipperConfig(partner: "acme"),
///     theme: FlipperTheme(mode: .dark, accent: "#ff5a1f"),
///     wallet: myWallet
/// )
/// widget.onConnectRequest = { _ in presentWalletModal() }
/// widget.onFlipSettled = { print($0.outcome ?? "") }
/// stackView.addArrangedSubview(widget)   // sizes itself to the content (autoHeight)
/// ```
@MainActor
public final class FlipperWidgetUIView: UIView {
    // MARK: public API

    /// The host wallet (nil = read-only; "Connect" calls `onConnectRequest`). Swapping it re-subscribes.
    public var wallet: FlipperWallet? {
        didSet {
            guard wallet !== oldValue else { return }
            core?.wallet = wallet
            subscribeWallet()
        }
    }

    /// Changes to `chainId` / `partner` reload the embed; everything else is applied live.
    public var config: FlipperConfig {
        didSet {
            if config.fit != oldValue.fit {
                webView.scrollView.isScrollEnabled = !autoSized
                invalidateIntrinsicContentSize()
            }
            configChanged(reloadNeeded: config.chainId != oldValue.chainId || config.partner != oldValue.partner)
        }
    }

    /// Applied live.
    public var theme: FlipperTheme {
        didSet { configChanged(reloadNeeded: false) }
    }

    public let options: FlipperWidgetOptions

    /// Every embed event, including unknown ones.
    public var onEvent: ((FlipperEvent) -> Void)?
    public var onReady: ((FlipperReadyEvent) -> Void)?
    /// Open your wallet UI; the widget updates when the wallet's publishers change.
    public var onConnectRequest: ((FlipperConnectRequestEvent) -> Void)?
    public var onFlipRequested: ((FlipperFlipRequestedEvent) -> Void)?
    public var onFlipSettled: ((FlipperFlipSettledEvent) -> Void)?
    /// A pending win's winnings were paid (once per flip).
    public var onPayoutResolved: ((FlipperPayoutResolvedEvent) -> Void)?
    public var onListing: ((FlipperListingEvent) -> Void)?
    /// Embed errors, plus configuration (`context == "config"`) and page-load (`code == "network"`) errors.
    public var onError: ((FlipperErrorEvent) -> Void)?
    /// New content height in points.
    public var onResize: ((CGFloat) -> Void)?
    /// Links outside the embed (default: `UIApplication.shared.open`).
    public var onOpenExternalURL: ((URL) -> Void)?
    /// Debug logging of dropped messages.
    public var onLog: ((String) -> Void)?

    /// Height of the embed's content (points), as last reported.
    public private(set) var contentHeight: CGFloat

    /// The underlying web view (for layout tweaks; don't change its navigation or script handlers).
    public let webView: WKWebView

    // MARK: internals

    private var core: FlipperBridgeCore?
    private var embedOrigin: String?
    private var loadedConfig: [String: JSONValue] = [:]
    private var walletSubscription: AnyCancellable?
    private let scriptProxy = WeakScriptMessageHandler()

    public convenience init(
        config: FlipperConfig = FlipperConfig(),
        theme: FlipperTheme = FlipperTheme(),
        options: FlipperWidgetOptions = FlipperWidgetOptions(),
        wallet: FlipperWallet? = nil
    ) {
        self.init(config: config, theme: theme, options: options, wallet: wallet, loadImmediately: true)
    }

    /// `loadImmediately: false` is a test seam: the bridge is prepared but nothing is loaded.
    init(config: FlipperConfig, theme: FlipperTheme, options: FlipperWidgetOptions, wallet: FlipperWallet?, loadImmediately: Bool) {
        self.config = config
        self.theme = theme
        self.options = options
        self.wallet = wallet
        contentHeight = CGFloat(options.initialHeight)

        let configuration = WKWebViewConfiguration()
        let contentController = WKUserContentController()
        contentController.addUserScript(
            WKUserScript(source: FlipperScripts.hostScript, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        contentController.add(scriptProxy, name: FlipperScripts.messageHandlerName)
        configuration.userContentController = contentController
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.dataDetectorTypes = []
        configuration.applicationNameForUserAgent = "FlipperiOS/\(FlipperConstants.sdkVersion)"
        webView = WKWebView(frame: .zero, configuration: configuration)

        super.init(frame: .zero)
        scriptProxy.target = self
        setUpWebView()
        if loadImmediately { load() } else { _ = prepare() }
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not supported; create FlipperWidgetUIView in code") }

    /// Reload the embed (live config changes are re-applied once it's ready).
    public func reload() {
        core?.pageStarted()
        if webView.url == nil { load() } else { webView.reload() }
    }

    /// Send a live config update (`FlipperEmbedConfig` fields such as theme, accent, token, strings).
    public func setConfig(_ partial: [String: JSONValue]) {
        core?.sendConfig(partial)
    }

    /// the view takes the embed's content height (`options.autoHeight`, unless `config.fit` is `.fill`)
    private var autoSized: Bool { options.autoHeight && config.fit != .fill }

    public override var intrinsicContentSize: CGSize {
        CGSize(width: UIView.noIntrinsicMetric, height: autoSized ? contentHeight : UIView.noIntrinsicMetric)
    }

    // MARK: setup

    private func setUpWebView() {
        backgroundColor = .clear
        isOpaque = false
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.scrollView.isScrollEnabled = !autoSized
        webView.scrollView.showsHorizontalScrollIndicator = false
        webView.allowsLinkPreview = false
        webView.allowsBackForwardNavigationGestures = false
        if #available(iOS 16.4, *) { webView.isInspectable = options.isInspectable }
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: trailingAnchor),
            webView.topAnchor.constraint(equalTo: topAnchor),
            webView.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    private func load() {
        guard let url = prepare() else { return }
        webView.load(URLRequest(url: url))
    }

    /// Builds the URL and a fresh bridge; nil (and an `onError`) for an invalid configuration.
    private func prepare() -> URL? {
        core?.dispose()
        core = nil
        let built: (url: URL, origin: String)
        do {
            built = try FlipperEmbedURL.build(options: options, config: config, theme: theme)
        } catch {
            embedOrigin = nil
            let message = (error as? FlipperConfigError)?.message ?? error.localizedDescription
            report(.error(FlipperErrorEvent(code: "config", message: message, context: "config")))
            return nil
        }
        embedOrigin = built.origin
        loadedConfig = FlipperEmbedURL.liveConfig(config: config, theme: theme)
        core = makeCore(origin: built.origin)
        subscribeWallet()
        return built.url
    }

    func makeCore(origin: String) -> FlipperBridgeCore {
        let core = FlipperBridgeCore(
            embedOrigin: origin,
            chainId: config.chainId,
            minHeight: options.minHeight,
            maxHeight: options.maxHeight,
            evaluate: { [weak self] js in self?.webView.evaluateJavaScript(js, completionHandler: nil) }
        )
        core.enableBatchCalls = options.enableBatchCalls
        core.allowedMethods = options.allowedMethods
        // rpcUrl / apiUrl / addresses: the embed ignores them in its URL, so they go in a config message after ready
        core.hostConfig = FlipperEmbedURL.hostOnlyConfig(config)
        core.wallet = wallet
        var handlers = FlipperBridgeHandlers()
        handlers.onEvent = { [weak self] event in self?.report(event) }
        handlers.onConnectRequest = { [weak self] event in self?.onConnectRequest?(event) }
        handlers.onResize = { [weak self] height in self?.applyHeight(CGFloat(height)) }
        handlers.log = { [weak self] line in self?.onLog?(line) }
        core.handlers = handlers
        return core
    }

    /// Test hook: load `html` as if it were served from the embed origin.
    func loadHTMLForTesting(_ html: String) {
        guard let origin = embedOrigin, let base = URL(string: origin + "/embed") else { return }
        core?.pageStarted()
        webView.loadHTMLString(html, baseURL: base)
    }

    private func subscribeWallet() {
        walletSubscription = nil
        guard let wallet else {
            core?.setWalletState(accounts: [], chainId: nil)
            return
        }
        walletSubscription = wallet.accountsPublisher
            .combineLatest(wallet.chainIdPublisher)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] accounts, chainId in
                MainActor.assumeIsolated {
                    guard let self, self.wallet === wallet else { return }
                    self.core?.setWalletState(accounts: accounts, chainId: chainId)
                }
            }
    }

    private func configChanged(reloadNeeded: Bool) {
        if reloadNeeded || core == nil {
            load()
            return
        }
        let next = FlipperEmbedURL.liveConfig(config: config, theme: theme)
        let changed = FlipperEmbedURL.diff(loadedConfig, next)
        guard !changed.isEmpty else { return }
        loadedConfig.merge(changed) { _, new in new }
        core?.sendConfig(changed)
    }

    private func report(_ event: FlipperEvent) {
        onEvent?(event)
        switch event {
        case .ready(let e): onReady?(e)
        case .flipRequested(let e): onFlipRequested?(e)
        case .flipSettled(let e): onFlipSettled?(e)
        case .payoutResolved(let e): onPayoutResolved?(e)
        case .listing(let e): onListing?(e)
        case .error(let e): onError?(e)
        case .connectRequest, .resize, .unknown: break // connect-request / resize come through the core's handlers
        }
    }

    private func applyHeight(_ height: CGFloat) {
        contentHeight = height
        if autoSized { invalidateIntrinsicContentSize() }
        onResize?(height)
    }

    private func openExternally(_ url: URL) {
        if let onOpenExternalURL { onOpenExternalURL(url) } else { UIApplication.shared.open(url) }
    }

    fileprivate func didReceive(_ message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        let source = FlipperMessageSource(
            origin: FlipperEmbedURL.origin(scheme: origin.protocol.lowercased(), host: origin.host.lowercased(), port: origin.port),
            isMainFrame: message.frameInfo.isMainFrame
        )
        core?.handleMessage(message.body, source: source)
    }
}

// MARK: - WKNavigationDelegate / WKUIDelegate

extension FlipperWidgetUIView: WKNavigationDelegate, WKUIDelegate {
    public func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
    ) {
        guard let origin = embedOrigin else { return decisionHandler(.cancel) }
        let url = navigationAction.request.url
        let newWindow = navigationAction.targetFrame == nil
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        let decision = FlipperNavigationDecision.decide(url: url, embedOrigin: origin, isMainFrame: isMainFrame)
        onLog?("flipper: navigation \(url?.absoluteString ?? "nil") mainFrame=\(isMainFrame) newWindow=\(newWindow) -> \(decision)")
        if decision == .openExternally, let url { openExternally(url) }
        decisionHandler(decision == .allow && !newWindow ? .allow : .cancel)
    }

    public func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        core?.pageStarted()
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        reportLoadError(error)
    }

    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        reportLoadError(error)
    }

    public func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void
    ) {
        if navigationResponse.isForMainFrame, let http = navigationResponse.response as? HTTPURLResponse, http.statusCode >= 400 {
            report(.error(FlipperErrorEvent(code: "network", message: "The widget failed to load (HTTP \(http.statusCode)).", context: "config")))
        }
        decisionHandler(.allow)
    }

    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        reload()
    }

    /// target=_blank / window.open: never a second web view; external targets go to the system browser.
    public func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let origin = embedOrigin, let url = navigationAction.request.url,
           FlipperNavigationDecision.decide(url: url, embedOrigin: origin, isMainFrame: true) == .openExternally {
            openExternally(url)
        }
        return nil
    }

    @available(iOS 15.0, *)
    public func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void
    ) {
        decisionHandler(.deny)
    }

    private func reportLoadError(_ error: Error) {
        let ns = error as NSError
        // cancelled loads (our own navigation policy, reloads) aren't failures
        if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { return }
        if ns.domain == "WebKitErrorDomain" && ns.code == 102 { return } // frame load interrupted by policy change
        report(.error(FlipperErrorEvent(code: "network", message: ns.localizedDescription, context: "config")))
    }
}

// MARK: - Script message handler (weak, so WKUserContentController doesn't retain the view)

private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: FlipperWidgetUIView?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        MainActor.assumeIsolated {
            target?.didReceive(message)
        }
    }
}

/// A view controller hosting a `FlipperWidgetUIView` (its `preferredContentSize` follows the content height).
@MainActor
public final class FlipperWidgetViewController: UIViewController {
    public let widgetView: FlipperWidgetUIView

    public init(
        config: FlipperConfig = FlipperConfig(),
        theme: FlipperTheme = FlipperTheme(),
        options: FlipperWidgetOptions = FlipperWidgetOptions(),
        wallet: FlipperWallet? = nil
    ) {
        widgetView = FlipperWidgetUIView(config: config, theme: theme, options: options, wallet: wallet)
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    public required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    public override func loadView() {
        view = widgetView
        preferredContentSize = CGSize(width: 0, height: widgetView.contentHeight)
        let previous = widgetView.onResize
        widgetView.onResize = { [weak self] height in
            self?.preferredContentSize = CGSize(width: self?.preferredContentSize.width ?? 0, height: height)
            previous?(height)
        }
    }
}
#endif
