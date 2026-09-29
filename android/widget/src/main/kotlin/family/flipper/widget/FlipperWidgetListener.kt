package family.flipper.widget

/**
 * Callbacks from the widget, all on the main thread. Every method has an empty default; override what you need.
 *
 * For each event from the page, [onEvent] is called first (always, including for event names this SDK version
 * doesn't know), then the typed callback.
 */
interface FlipperWidgetListener {
    /** Every event from the page, typed where known ([FlipperEvent.Unknown] otherwise). */
    fun onEvent(event: FlipperEvent) {}

    /** The widget mounted; the SDK has already flushed queued messages and sent the wallet state. */
    fun onReady(event: FlipperEvent.Ready) {}

    /**
     * Open your wallet's connect UI. [reason] is `"connect"`, `"flip"` or `"list"` for the page's
     * `connect-request` event, or null when the page sent `eth_requestAccounts` while no wallet was connected.
     * Once connected, update your [FlipperWallet]'s flows; the SDK pushes the new state to the page.
     */
    fun onConnectRequest(reason: String?) {}

    fun onFlipRequested(event: FlipperEvent.FlipRequested) {}

    fun onFlipSettled(event: FlipperEvent.FlipSettled) {}

    /** A pending win's winnings were paid (once per flip). */
    fun onPayoutResolved(event: FlipperEvent.PayoutResolved) {}

    fun onListing(event: FlipperEvent.Listing) {}

    /** Page-reported errors and host-side problems (code `config`, `network`, `webview`). */
    fun onError(event: FlipperEvent.Error) {}

    /**
     * The page's height changed; [heightDp] is ceil(height) clamped to min/max height, in dp (CSS px = dp).
     * Called whether or not auto-height is on.
     */
    fun onResize(heightDp: Int) {}
}
