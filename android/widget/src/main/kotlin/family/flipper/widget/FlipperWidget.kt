package family.flipper.widget

import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView

/**
 * Imperative handle for a [FlipperWidget] composable: `reload()` and `setConfig(...)`.
 * Create it with [rememberFlipperWidgetController]. Values set here stay until the composable's own `config` /
 * `theme` parameters change.
 */
class FlipperWidgetController {
    private var view: FlipperWidgetView? = null

    internal fun bind(target: FlipperWidgetView?) {
        view = target
    }

    internal fun unbind(target: FlipperWidgetView?) {
        if (view === target) view = null
    }

    /** True while bound to a live widget. */
    val isAttached: Boolean
        get() = view != null

    /** True between the page's `ready` event and the next page load. */
    val isReady: Boolean
        get() = view?.isReady == true

    /** Reloads the embed page (a new `ready` follows; the wallet state is re-sent). */
    fun reload() {
        view?.reload()
    }

    /** Same as [FlipperWidgetView.setConfig]; pass only what changes. */
    fun setConfig(config: FlipperConfig? = null, theme: FlipperTheme? = null) {
        val v = view ?: return
        v.setConfig(config ?: v.config, theme ?: v.theme)
    }

    /** `controller.updateConfig { it.copy(token = "0x...") }` */
    fun updateConfig(transform: (FlipperConfig) -> FlipperConfig) {
        view?.updateConfig(transform)
    }
}

/** Remembers a [FlipperWidgetController] across recompositions. */
@Composable
fun rememberFlipperWidgetController(): FlipperWidgetController = remember { FlipperWidgetController() }

/**
 * The flipper.family flip widget for Jetpack Compose.
 *
 * ```kotlin
 * FlipperWidget(
 *     modifier = Modifier.fillMaxWidth(),
 *     wallet = wallet,
 *     config = FlipperConfig(partner = "acme"),
 *     theme = FlipperTheme(mode = if (isSystemInDarkTheme()) FlipperThemeMode.DARK else FlipperThemeMode.LIGHT),
 *     onConnectRequest = { openConnectModal() },
 *     onFlipSettled = { event -> analytics.log(event.outcome) },
 * )
 * ```
 *
 * With `options.autoHeight` (default) the composable sizes its height to the page's `resize` events (clamped to
 * min/max height); an explicit height in [modifier] wins. Changes to [config] / [theme] are sent live, except
 * `chain` and `partner`, which reload the page, as do `options.baseUrl` changes. Swapping [wallet] resubscribes.
 */
@Composable
fun FlipperWidget(
    modifier: Modifier = Modifier,
    wallet: FlipperWallet? = null,
    config: FlipperConfig = FlipperConfig(),
    theme: FlipperTheme = FlipperTheme(),
    options: FlipperWidgetOptions = FlipperWidgetOptions(),
    controller: FlipperWidgetController? = null,
    onEvent: ((FlipperEvent) -> Unit)? = null,
    onReady: ((FlipperEvent.Ready) -> Unit)? = null,
    onConnectRequest: ((reason: String?) -> Unit)? = null,
    onFlipRequested: ((FlipperEvent.FlipRequested) -> Unit)? = null,
    onFlipSettled: ((FlipperEvent.FlipSettled) -> Unit)? = null,
    onPayoutResolved: ((FlipperEvent.PayoutResolved) -> Unit)? = null,
    onListing: ((FlipperEvent.Listing) -> Unit)? = null,
    onError: ((FlipperEvent.Error) -> Unit)? = null,
    onResize: ((heightDp: Int) -> Unit)? = null,
    onOpenExternalUrl: ((android.net.Uri) -> Boolean)? = null,
) {
    val currentOnEvent by rememberUpdatedState(onEvent)
    val currentOnReady by rememberUpdatedState(onReady)
    val currentOnConnectRequest by rememberUpdatedState(onConnectRequest)
    val currentOnFlipRequested by rememberUpdatedState(onFlipRequested)
    val currentOnFlipSettled by rememberUpdatedState(onFlipSettled)
    val currentOnPayoutResolved by rememberUpdatedState(onPayoutResolved)
    val currentOnListing by rememberUpdatedState(onListing)
    val currentOnError by rememberUpdatedState(onError)
    val currentOnResize by rememberUpdatedState(onResize)
    val currentOnOpenExternalUrl by rememberUpdatedState(onOpenExternalUrl)

    var contentHeightDp by remember { mutableIntStateOf(options.initialHeightDp) }
    val holder = remember { ViewHolder() }

    DisposableEffect(controller) {
        controller?.bind(holder.view)
        onDispose { controller?.unbind(holder.view) }
    }
    DisposableEffect(Unit) {
        onDispose {
            holder.view?.destroy()
            holder.view = null
        }
    }

    val heightModifier = if (options.autoHeight && config.fit != FlipperFit.FILL) {
        Modifier.height(clampHeightDp(contentHeightDp, options).dp)
    } else {
        Modifier
    }

    AndroidView(
        factory = { context ->
            FlipperWidgetView(context).apply {
                autoDestroy = false // Compose owns the lifecycle (onRelease / DisposableEffect)
                listener = object : FlipperWidgetListener {
                    override fun onEvent(event: FlipperEvent) {
                        currentOnEvent?.invoke(event)
                    }

                    override fun onReady(event: FlipperEvent.Ready) {
                        currentOnReady?.invoke(event)
                    }

                    override fun onConnectRequest(reason: String?) {
                        currentOnConnectRequest?.invoke(reason)
                    }

                    override fun onFlipRequested(event: FlipperEvent.FlipRequested) {
                        currentOnFlipRequested?.invoke(event)
                    }

                    override fun onFlipSettled(event: FlipperEvent.FlipSettled) {
                        currentOnFlipSettled?.invoke(event)
                    }

                    override fun onPayoutResolved(event: FlipperEvent.PayoutResolved) {
                        currentOnPayoutResolved?.invoke(event)
                    }

                    override fun onListing(event: FlipperEvent.Listing) {
                        currentOnListing?.invoke(event)
                    }

                    override fun onError(event: FlipperEvent.Error) {
                        currentOnError?.invoke(event)
                    }

                    override fun onResize(heightDp: Int) {
                        contentHeightDp = heightDp
                        currentOnResize?.invoke(heightDp)
                    }
                }
                this.onOpenExternalUrl = { uri -> currentOnOpenExternalUrl?.invoke(uri) == true }
                configure(config = config, theme = theme, options = options, wallet = wallet)
                holder.view = this
                holder.config = config
                holder.theme = theme
                holder.options = options
                controller?.bind(this)
            }
        },
        modifier = modifier.then(heightModifier),
        update = { view ->
            // Only push what the caller changed, so values set through the controller aren't overwritten on every
            // recomposition.
            if (holder.config != config || holder.theme != theme || holder.options != options) {
                view.configure(
                    config = if (holder.config != config) config else view.config,
                    theme = if (holder.theme != theme) theme else view.theme,
                    options = if (holder.options != options) options else view.options,
                )
                holder.config = config
                holder.theme = theme
                holder.options = options
            }
            view.wallet = wallet
        },
        onRelease = { view ->
            controller?.unbind(view)
            view.destroy()
            if (holder.view === view) holder.view = null
        },
    )
}

private class ViewHolder {
    var view: FlipperWidgetView? = null
    var config: FlipperConfig? = null
    var theme: FlipperTheme? = null
    var options: FlipperWidgetOptions? = null
}

private const val MAX_COMPOSE_HEIGHT_DP = 20_000

private fun clampHeightDp(value: Int, options: FlipperWidgetOptions): Int {
    var v = value
    options.maxHeightDp?.let { if (v > it) v = it }
    if (v < options.minHeightDp) v = options.minHeightDp
    return v.coerceIn(0, MAX_COMPOSE_HEIGHT_DP)
}
