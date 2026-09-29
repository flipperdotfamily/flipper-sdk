#if os(iOS)
import SwiftUI
import UIKit

/// The flipper.family flip widget for SwiftUI.
///
/// ```swift
/// FlipperWidgetView(
///     config: FlipperConfig(partner: "acme"),
///     theme: FlipperTheme(mode: .dark, accent: "#ff5a1f"),
///     wallet: wallet
/// )
/// .onFlipperConnectRequest { _ in showConnectSheet = true }
/// .onFlipperFlipSettled { print($0.outcome ?? "") }
/// ```
///
/// With `options.autoHeight` (the default) the view takes the embed's content height; otherwise give it a frame.
public struct FlipperWidgetView: View {
    let config: FlipperConfig
    let theme: FlipperTheme
    let options: FlipperWidgetOptions
    let wallet: FlipperWallet?
    var callbacks = FlipperWidgetCallbacks()

    @State private var height: CGFloat

    public init(
        config: FlipperConfig = FlipperConfig(),
        theme: FlipperTheme = FlipperTheme(),
        options: FlipperWidgetOptions = FlipperWidgetOptions(),
        wallet: FlipperWallet? = nil
    ) {
        self.config = config
        self.theme = theme
        self.options = options
        self.wallet = wallet
        _height = State(initialValue: CGFloat(options.initialHeight))
    }

    public var body: some View {
        FlipperWidgetRepresentable(
            config: config,
            theme: theme,
            options: options,
            wallet: wallet,
            callbacks: callbacks,
            onHeight: { height = $0 }
        )
        .frame(height: options.autoHeight && config.fit != .fill ? height : nil)
    }

    // MARK: modifiers

    public func onFlipperEvent(_ action: @escaping (FlipperEvent) -> Void) -> Self { with { $0.onEvent = action } }
    public func onFlipperReady(_ action: @escaping (FlipperReadyEvent) -> Void) -> Self { with { $0.onReady = action } }
    /// Open your wallet UI here.
    public func onFlipperConnectRequest(_ action: @escaping (FlipperConnectRequestEvent) -> Void) -> Self { with { $0.onConnectRequest = action } }
    public func onFlipperFlipRequested(_ action: @escaping (FlipperFlipRequestedEvent) -> Void) -> Self { with { $0.onFlipRequested = action } }
    public func onFlipperFlipSettled(_ action: @escaping (FlipperFlipSettledEvent) -> Void) -> Self { with { $0.onFlipSettled = action } }
    /// A pending win's winnings were paid (once per flip).
    public func onFlipperPayoutResolved(_ action: @escaping (FlipperPayoutResolvedEvent) -> Void) -> Self { with { $0.onPayoutResolved = action } }
    public func onFlipperListing(_ action: @escaping (FlipperListingEvent) -> Void) -> Self { with { $0.onListing = action } }
    public func onFlipperError(_ action: @escaping (FlipperErrorEvent) -> Void) -> Self { with { $0.onError = action } }
    public func onFlipperResize(_ action: @escaping (CGFloat) -> Void) -> Self { with { $0.onResize = action } }
    /// Links outside the embed (default: `UIApplication.shared.open`).
    public func onFlipperOpenExternalURL(_ action: @escaping (URL) -> Void) -> Self { with { $0.onOpenExternalURL = action } }

    private func with(_ change: (inout FlipperWidgetCallbacks) -> Void) -> Self {
        var copy = self
        change(&copy.callbacks)
        return copy
    }
}

struct FlipperWidgetCallbacks {
    var onEvent: ((FlipperEvent) -> Void)?
    var onReady: ((FlipperReadyEvent) -> Void)?
    var onConnectRequest: ((FlipperConnectRequestEvent) -> Void)?
    var onFlipRequested: ((FlipperFlipRequestedEvent) -> Void)?
    var onFlipSettled: ((FlipperFlipSettledEvent) -> Void)?
    var onPayoutResolved: ((FlipperPayoutResolvedEvent) -> Void)?
    var onListing: ((FlipperListingEvent) -> Void)?
    var onError: ((FlipperErrorEvent) -> Void)?
    var onResize: ((CGFloat) -> Void)?
    var onOpenExternalURL: ((URL) -> Void)?
}

struct FlipperWidgetRepresentable: UIViewRepresentable {
    let config: FlipperConfig
    let theme: FlipperTheme
    let options: FlipperWidgetOptions
    let wallet: FlipperWallet?
    let callbacks: FlipperWidgetCallbacks
    let onHeight: (CGFloat) -> Void

    func makeUIView(context: Context) -> FlipperWidgetUIView {
        let view = FlipperWidgetUIView(config: config, theme: theme, options: options, wallet: wallet)
        apply(to: view)
        return view
    }

    func updateUIView(_ view: FlipperWidgetUIView, context: Context) {
        apply(to: view)
        // property observers diff these: unchanged values send nothing
        if view.config != config { view.config = config }
        if view.theme != theme { view.theme = theme }
        if view.wallet !== wallet { view.wallet = wallet }
    }

    private func apply(to view: FlipperWidgetUIView) {
        let callbacks = self.callbacks
        let onHeight = self.onHeight
        view.onEvent = callbacks.onEvent
        view.onReady = callbacks.onReady
        view.onConnectRequest = callbacks.onConnectRequest
        view.onFlipRequested = callbacks.onFlipRequested
        view.onFlipSettled = callbacks.onFlipSettled
        view.onPayoutResolved = callbacks.onPayoutResolved
        view.onListing = callbacks.onListing
        view.onError = callbacks.onError
        view.onOpenExternalURL = callbacks.onOpenExternalURL
        view.onResize = { height in
            onHeight(height)
            callbacks.onResize?(height)
        }
    }

    static func dismantleUIView(_ view: FlipperWidgetUIView, coordinator: ()) {
        view.wallet = nil
    }
}
#endif
