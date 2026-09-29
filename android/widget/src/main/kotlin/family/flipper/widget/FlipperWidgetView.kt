package family.flipper.widget

import android.annotation.SuppressLint
import android.annotation.TargetApi
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.util.AttributeSet
import android.util.Log
import android.view.View
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.findViewTreeLifecycleOwner
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.lang.ref.WeakReference
import kotlin.math.ceil
import kotlin.math.roundToInt

/**
 * The flipper.family flip widget as an Android View: a [FrameLayout] hosting a hardened [WebView] that loads the
 * hosted embed page and routes its wallet requests to the host's [FlipperWallet].
 *
 * ```kotlin
 * val widget = FlipperWidgetView(context).apply {
 *     configure(config = FlipperConfig(partner = "acme"), theme = FlipperTheme(FlipperThemeMode.DARK))
 *     wallet = myWallet
 *     onConnectRequest = { openMyConnectModal() }
 * }
 * container.addView(widget, ViewGroup.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
 * ```
 *
 * The page loads when the view is first attached to a window (or on [reload]), so everything set before that goes
 * into the first URL. Use `wrap_content` height for auto-height. All methods must be called on the main thread.
 * The view destroys itself when its view-tree lifecycle (Activity / Fragment view) is destroyed unless
 * [autoDestroy] is false; call [destroy] yourself otherwise.
 */
class FlipperWidgetView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0,
) : FrameLayout(context, attrs, defStyleAttr) {

    private val mainHandler = Handler(Looper.getMainLooper())
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val appDebuggable = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

    private var currentOptions = FlipperWidgetOptions()
    private var currentConfig = FlipperConfig()
    private var currentTheme = FlipperTheme()

    private var webView: WebView? = null
    private var useMessageListener = false
    private var channelOrigin: String? = null
    private var jsInterfaceInstalled = false
    private var loadedOrigin: String = ""
    private var loadedUrl: String? = null
    private var hasLoaded = false
    private var destroyed = false
    private var contentHeightDp: Int? = null
    private var observedLifecycle: Lifecycle? = null
    private var rendererRecoveries = 0

    /** Receives every callback; the lambda properties below are called as well. */
    var listener: FlipperWidgetListener? = null

    var onEvent: ((FlipperEvent) -> Unit)? = null
    var onReady: ((FlipperEvent.Ready) -> Unit)? = null

    /** See [FlipperWidgetListener.onConnectRequest]. */
    var onConnectRequest: ((reason: String?) -> Unit)? = null
    var onFlipRequested: ((FlipperEvent.FlipRequested) -> Unit)? = null
    var onFlipSettled: ((FlipperEvent.FlipSettled) -> Unit)? = null
    var onPayoutResolved: ((FlipperEvent.PayoutResolved) -> Unit)? = null
    var onListing: ((FlipperEvent.Listing) -> Unit)? = null
    var onError: ((FlipperEvent.Error) -> Unit)? = null
    var onResize: ((heightDp: Int) -> Unit)? = null

    /**
     * Called for links the page opens outside the embed origin (http(s), mailto:, tel:). Return true if you handled
     * it (e.g. with a Custom Tab); otherwise the SDK starts an `ACTION_VIEW` intent.
     */
    var onOpenExternalUrl: ((Uri) -> Boolean)? = null

    /** Destroy automatically when the view-tree LifecycleOwner is destroyed. The Compose wrapper turns this off. */
    var autoDestroy: Boolean = true

    private val dispatcher = object : FlipperWidgetListener {
        override fun onEvent(event: FlipperEvent) {
            listener?.onEvent(event)
            this@FlipperWidgetView.onEvent?.invoke(event)
        }

        override fun onReady(event: FlipperEvent.Ready) {
            listener?.onReady(event)
            this@FlipperWidgetView.onReady?.invoke(event)
        }

        override fun onConnectRequest(reason: String?) {
            listener?.onConnectRequest(reason)
            this@FlipperWidgetView.onConnectRequest?.invoke(reason)
        }

        override fun onFlipRequested(event: FlipperEvent.FlipRequested) {
            listener?.onFlipRequested(event)
            this@FlipperWidgetView.onFlipRequested?.invoke(event)
        }

        override fun onFlipSettled(event: FlipperEvent.FlipSettled) {
            listener?.onFlipSettled(event)
            this@FlipperWidgetView.onFlipSettled?.invoke(event)
        }

        override fun onPayoutResolved(event: FlipperEvent.PayoutResolved) {
            listener?.onPayoutResolved(event)
            this@FlipperWidgetView.onPayoutResolved?.invoke(event)
        }

        override fun onListing(event: FlipperEvent.Listing) {
            listener?.onListing(event)
            this@FlipperWidgetView.onListing?.invoke(event)
        }

        override fun onError(event: FlipperEvent.Error) {
            listener?.onError(event)
            this@FlipperWidgetView.onError?.invoke(event)
        }

        override fun onResize(heightDp: Int) {
            applyContentHeight(heightDp)
            listener?.onResize(heightDp)
            this@FlipperWidgetView.onResize?.invoke(heightDp)
        }
    }

    private val bridge = FlipperBridge(
        scope = scope,
        evaluateJavascript = { js -> evaluate(js) },
        listener = dispatcher,
        embedOrigin = "",
        chainId = currentConfig.chain,
        allowedMethods = currentOptions.allowedMethods,
        minHeight = currentOptions.minHeightDp,
        maxHeight = currentOptions.maxHeightDp,
        log = { message -> if (appDebuggable) Log.d(TAG, message) },
    )

    private val lifecycleObserver = object : LifecycleEventObserver {
        override fun onStateChanged(source: LifecycleOwner, event: Lifecycle.Event) {
            when (event) {
                Lifecycle.Event.ON_RESUME -> webView?.onResume()
                Lifecycle.Event.ON_PAUSE -> webView?.onPause()
                Lifecycle.Event.ON_DESTROY -> if (autoDestroy) destroy()
                else -> Unit
            }
        }
    }

    private val webMessageListener = WebViewCompat.WebMessageListener { _, message, sourceOrigin, isMainFrame, _ ->
        if (message.type != WebMessageCompat.TYPE_STRING) return@WebMessageListener
        val data = message.data ?: return@WebMessageListener
        onInbound(data, sourceOrigin.toString(), isMainFrame)
    }

    private val client = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url ?: return true
            return when (NavigationPolicy.decide(uri.toString(), request.isForMainFrame, loadedOrigin)) {
                NavigationDecision.ALLOW -> false
                NavigationDecision.OPEN_EXTERNAL -> {
                    openExternal(uri)
                    true
                }
                NavigationDecision.BLOCK -> true
            }
        }

        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
            if (view !== webView) return
            bridge.onPageStarted()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (view !== webView || !request.isForMainFrame) return
            reportHostError("network", "The widget failed to load: ${error.description}")
        }

        override fun onReceivedHttpError(
            view: WebView,
            request: WebResourceRequest,
            errorResponse: WebResourceResponse,
        ) {
            if (view !== webView || !request.isForMainFrame) return
            reportHostError("network", "The widget failed to load: HTTP ${errorResponse.statusCode}")
        }

        @TargetApi(Build.VERSION_CODES.O)
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            val crashed = detail.didCrash()
            // Returning true keeps the app alive; the dead WebView must not be used again, only destroyed.
            mainHandler.post { onRendererGone(view, crashed) }
            return true
        }
    }

    private val chromeClient = object : WebChromeClient() {
        override fun onPermissionRequest(request: PermissionRequest) {
            request.deny()
        }

        override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback?) {
            callback?.invoke(origin, false, false)
        }

        override fun onCreateWindow(view: WebView?, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message?): Boolean =
            false
    }

    init {
        if (attrs != null) readAttributes(attrs, defStyleAttr)
    }

    // -------------------------------------------------------------------------------------------------------------
    // Public API

    /** How the view behaves. Changing [FlipperWidgetOptions.baseUrl] or `allowInsecureLocalhost` reloads the page. */
    var options: FlipperWidgetOptions
        get() = currentOptions
        set(value) = applyState(value, currentConfig, currentTheme)

    /** What the widget shows. Changing `chain` or `partner` reloads; anything else is sent live. */
    var config: FlipperConfig
        get() = currentConfig
        set(value) = applyState(currentOptions, value, currentTheme)

    /** Theme; always sent live. */
    var theme: FlipperTheme
        get() = currentTheme
        set(value) = applyState(currentOptions, currentConfig, value)

    /** The host wallet. Swapping it resubscribes and pushes the new state; null = disconnected. */
    var wallet: FlipperWallet?
        get() = bridge.wallet
        set(value) {
            if (!destroyed) bridge.wallet = value
        }

    /** True between the page's `ready` event and the next page load. */
    val isReady: Boolean
        get() = bridge.isReady

    /** The URL currently loaded, or null before the first load. */
    val currentUrl: String?
        get() = loadedUrl

    /** Sets several things at once (one reload / one config message at most). */
    fun configure(
        config: FlipperConfig = currentConfig,
        theme: FlipperTheme = currentTheme,
        options: FlipperWidgetOptions = currentOptions,
        wallet: FlipperWallet? = this.wallet,
    ) {
        applyState(options, config, theme)
        this.wallet = wallet
    }

    /**
     * Updates config and/or theme: `setConfig(theme = FlipperTheme(FlipperThemeMode.DARK))`. Changes to `chain` or
     * `partner` reload the page; everything else goes out as one live `config` message (queued until `ready`).
     * (No @JvmOverloads: from Java, the `config` / `theme` property setters cover the one-argument forms.)
     */
    fun setConfig(config: FlipperConfig = currentConfig, theme: FlipperTheme = currentTheme) {
        applyState(currentOptions, config, theme)
    }

    /** `updateConfig { it.copy(locale = "es") }` */
    fun updateConfig(transform: (FlipperConfig) -> FlipperConfig) {
        setConfig(config = transform(currentConfig))
    }

    /** Loads the embed URL built from the current state (also the first load if the view isn't attached yet). */
    fun reload() {
        if (destroyed) return
        load()
    }

    /** Tears down the WebView and cancels all work. The view can't be used afterwards. Idempotent. */
    fun destroy() {
        if (destroyed) return
        destroyed = true
        observedLifecycle?.removeObserver(lifecycleObserver)
        observedLifecycle = null
        bridge.dispose()
        scope.cancel()
        mainHandler.removeCallbacksAndMessages(null)
        webView?.let { teardown(it, rendererAlive = true) }
        webView = null
    }

    // -------------------------------------------------------------------------------------------------------------
    // View lifecycle and layout

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (destroyed || isInEditMode) return
        observeLifecycle()
        if (!hasLoaded) load()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val mode = MeasureSpec.getMode(heightMeasureSpec)
        if (mode == MeasureSpec.EXACTLY) {
            super.onMeasure(widthMeasureSpec, heightMeasureSpec)
            return
        }
        val desiredDp = if (autoSized) contentHeightDp ?: initialHeightDp() else initialHeightDp()
        var px = ceil(desiredDp.toFloat() * resources.displayMetrics.density).toInt().coerceIn(0, MAX_MEASURED_PX)
        if (mode == MeasureSpec.AT_MOST) px = minOf(px, MeasureSpec.getSize(heightMeasureSpec))
        super.onMeasure(widthMeasureSpec, MeasureSpec.makeMeasureSpec(px, MeasureSpec.EXACTLY))
    }

    // -------------------------------------------------------------------------------------------------------------
    // Internals

    private fun applyState(options: FlipperWidgetOptions, config: FlipperConfig, theme: FlipperTheme) {
        if (destroyed) return
        val oldOptions = currentOptions
        val oldConfig = currentConfig
        val oldTheme = currentTheme
        currentOptions = options
        currentConfig = config
        currentTheme = theme

        bridge.enableBatchCalls = options.enableBatchCalls
        bridge.allowedMethods = options.allowedMethods
        bridge.minHeight = options.minHeightDp
        bridge.maxHeight = options.maxHeightDp
        bridge.chainId = config.chain
        bridge.hostConfig = EmbedUrl.hostOnlyConfig(config)
        if (oldOptions.autoHeight != options.autoHeight ||
            oldConfig.fit != config.fit ||
            oldOptions.initialHeightDp != options.initialHeightDp ||
            oldOptions.minHeightDp != options.minHeightDp ||
            oldOptions.maxHeightDp != options.maxHeightDp
        ) {
            contentHeightDp = contentHeightDp?.let { clampDp(it) }
            requestLayout()
        }

        if (!hasLoaded) return
        val reload = oldOptions.baseUrl != options.baseUrl ||
            oldOptions.allowInsecureLocalhost != options.allowInsecureLocalhost ||
            ConfigDiff.requiresReload(oldConfig, config)
        if (reload) {
            load()
            return
        }
        val partial = ConfigDiff.partial(oldConfig, oldTheme, config, theme)
        if (partial.isNotEmpty()) bridge.sendConfig(partial)
    }

    private fun load() {
        if (destroyed || isInEditMode) return
        hasLoaded = true
        val built = try {
            EmbedUrl.build(currentOptions.baseUrl, allowInsecureLocalhost(), currentConfig, currentTheme)
        } catch (e: FlipperConfigException) {
            failClosed()
            reportHostError("config", e.message ?: "Invalid widget configuration.")
            return
        }
        val wv = webView ?: createWebView() ?: return
        if (!installChannel(wv, built.origin)) {
            failClosed()
            reportHostError("config", "Cannot receive messages from ${built.origin}.")
            return
        }
        loadedOrigin = built.origin
        loadedUrl = built.url
        bridge.embedOrigin = built.origin
        bridge.chainId = currentConfig.chain
        bridge.hostConfig = EmbedUrl.hostOnlyConfig(currentConfig)
        bridge.onPageStarted()
        wv.loadUrl(built.url)
    }

    /** Invalid config: never load it, and don't leave the previous page talking to the host. */
    private fun failClosed() {
        loadedOrigin = ""
        loadedUrl = null
        bridge.embedOrigin = ""
        bridge.onPageStarted()
        webView?.let {
            it.stopLoading()
            it.loadUrl("about:blank")
        }
    }

    private fun allowInsecureLocalhost(): Boolean = currentOptions.allowInsecureLocalhost ?: appDebuggable

    private fun createWebView(): WebView? {
        val wv = try {
            WebView(context)
        } catch (e: Exception) {
            // No WebView provider installed / being updated.
            reportHostError("webview", "Android System WebView is unavailable: ${e.message}")
            return null
        }
        configureSettings(wv)
        wv.setBackgroundColor(Color.TRANSPARENT)
        wv.overScrollMode = View.OVER_SCROLL_NEVER
        wv.webViewClient = client
        wv.webChromeClient = chromeClient
        useMessageListener = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
        channelOrigin = null
        jsInterfaceInstalled = false
        addView(wv, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        webView = wv
        return wv
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Suppress("DEPRECATION")
    private fun configureSettings(wv: WebView) {
        val s = wv.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.allowFileAccess = false
        s.allowContentAccess = false
        s.allowFileAccessFromFileURLs = false
        s.allowUniversalAccessFromFileURLs = false
        s.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        s.setGeolocationEnabled(false)
        s.setSupportMultipleWindows(false)
        s.javaScriptCanOpenWindowsAutomatically = false
        s.setSupportZoom(false)
        s.builtInZoomControls = false
        s.displayZoomControls = false
        s.mediaPlaybackRequiresUserGesture = true
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SAFE_BROWSING_ENABLE)) {
            WebSettingsCompat.setSafeBrowsingEnabled(s, true)
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            // The widget themes itself (theme=light|dark|auto); don't let WebView recolour it.
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(s, false)
        }
        // Process-wide switch: only ever turned on, and only for debuggable apps.
        if (appDebuggable) WebView.setWebContentsDebuggingEnabled(true)
    }

    /**
     * Makes `window.FlipperHost.postMessage(json)` available to the page. Must run before `loadUrl`.
     * Preferred: WebMessageListener, injected only into frames of [origin] and reporting the sending frame.
     * Fallback (old WebView): addJavascriptInterface, which is injected into every frame; messages are then checked
     * against the WebView's current URL instead (see README, Security).
     */
    private fun installChannel(wv: WebView, origin: String): Boolean {
        if (useMessageListener) {
            if (channelOrigin == origin) return true
            if (channelOrigin != null) {
                try {
                    WebViewCompat.removeWebMessageListener(wv, FlipperBridge.HOST_OBJECT_NAME)
                } catch (e: Exception) {
                    Log.w(TAG, "removeWebMessageListener failed", e)
                }
                channelOrigin = null
            }
            return try {
                WebViewCompat.addWebMessageListener(wv, FlipperBridge.HOST_OBJECT_NAME, setOf(origin), webMessageListener)
                channelOrigin = origin
                true
            } catch (e: IllegalArgumentException) {
                Log.w(TAG, "addWebMessageListener rejected origin rule $origin", e)
                false
            }
        }
        if (!jsInterfaceInstalled) {
            wv.addJavascriptInterface(JsChannel(this), FlipperBridge.HOST_OBJECT_NAME)
            jsInterfaceInstalled = true
        }
        return true
    }

    private fun onInbound(message: String, origin: String?, isMainFrame: Boolean) {
        if (destroyed) return
        bridge.onMessage(message, origin, isMainFrame)
    }

    /** addJavascriptInterface path: runs on the main thread, no frame info, so the WebView's URL gives the origin. */
    private fun onJsInterfaceMessage(message: String) {
        val wv = webView ?: return
        onInbound(message, EmbedUrl.originOf(wv.url), true)
    }

    private fun evaluate(js: String) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            if (!destroyed) webView?.evaluateJavascript(js, null)
        } else {
            mainHandler.post { if (!destroyed) webView?.evaluateJavascript(js, null) }
        }
    }

    private fun openExternal(uri: Uri) {
        if (onOpenExternalUrl?.invoke(uri) == true) return
        val intent = Intent(Intent.ACTION_VIEW, uri).apply {
            addCategory(Intent.CATEGORY_BROWSABLE)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "No app can open $uri")
        } catch (e: SecurityException) {
            Log.w(TAG, "Not allowed to open $uri", e)
        }
    }

    /** The view takes the page's content height: `options.autoHeight`, unless `config.fit` is [FlipperFit.FILL]. */
    private val autoSized: Boolean
        get() = currentOptions.autoHeight && currentConfig.fit != FlipperFit.FILL

    private fun applyContentHeight(heightDp: Int) {
        if (!autoSized) return
        if (contentHeightDp == heightDp) return
        contentHeightDp = heightDp
        requestLayout()
    }

    private fun initialHeightDp(): Int = clampDp(currentOptions.initialHeightDp)

    private fun clampDp(value: Int): Int {
        var v = value
        currentOptions.maxHeightDp?.let { if (v > it) v = it }
        if (v < currentOptions.minHeightDp) v = currentOptions.minHeightDp
        return v.coerceAtMost(MAX_HEIGHT_DP)
    }

    private fun reportHostError(code: String, message: String) {
        val data = buildJsonObject {
            put("code", code)
            put("message", message)
            put("context", if (code == "config") "config" else null)
            put("partner", currentConfig.partner)
        }
        val errorContext = if (code == "config") "config" else null
        dispatcher.onError(FlipperEvent.Error(code = code, message = message, context = errorContext, data = data))
    }

    private fun observeLifecycle() {
        val lifecycle = findViewTreeLifecycleOwner()?.lifecycle ?: return
        if (lifecycle === observedLifecycle) return
        observedLifecycle?.removeObserver(lifecycleObserver)
        observedLifecycle = lifecycle
        lifecycle.addObserver(lifecycleObserver)
    }

    private fun onRendererGone(dead: WebView, crashed: Boolean) {
        if (dead !== webView) return
        webView = null
        teardown(dead, rendererAlive = false)
        bridge.onPageStarted()
        if (destroyed) return
        rendererRecoveries++
        val recover = rendererRecoveries <= MAX_RENDERER_RECOVERIES
        reportHostError(
            "webview",
            when {
                !recover -> "The widget's WebView renderer stopped again; not reloading."
                crashed -> "The widget's WebView renderer crashed; reloading."
                else -> "The widget's WebView renderer was stopped to free memory; reloading."
            },
        )
        if (!recover) return
        if (isAttachedToWindow) {
            load()
        } else {
            hasLoaded = false // reload on the next attach
        }
    }

    private fun teardown(wv: WebView, rendererAlive: Boolean) {
        if (rendererAlive) {
            if (useMessageListener && channelOrigin != null) {
                try {
                    WebViewCompat.removeWebMessageListener(wv, FlipperBridge.HOST_OBJECT_NAME)
                } catch (e: Exception) {
                    Log.w(TAG, "removeWebMessageListener failed", e)
                }
            }
            if (jsInterfaceInstalled) wv.removeJavascriptInterface(FlipperBridge.HOST_OBJECT_NAME)
            wv.stopLoading()
            wv.webChromeClient = null
            wv.webViewClient = WebViewClient()
        }
        // After onRenderProcessGone only removal from the hierarchy and destroy() are allowed.
        channelOrigin = null
        jsInterfaceInstalled = false
        removeView(wv)
        wv.destroy()
    }

    private fun readAttributes(attrs: AttributeSet, defStyleAttr: Int) {
        val a = context.obtainStyledAttributes(attrs, R.styleable.FlipperWidgetView, defStyleAttr, 0)
        try {
            val density = resources.displayMetrics.density
            fun dp(index: Int): Int? =
                if (a.hasValue(index)) (a.getDimension(index, 0f) / density).roundToInt() else null
            fun bool(index: Int): Boolean? = if (a.hasValue(index)) a.getBoolean(index, false) else null
            fun int(index: Int): Int? = if (a.hasValue(index)) a.getInt(index, 0) else null

            val mode = when (int(R.styleable.FlipperWidgetView_flipperThemeMode)) {
                0 -> FlipperThemeMode.LIGHT
                1 -> FlipperThemeMode.DARK
                2 -> FlipperThemeMode.AUTO
                else -> null
            }
            currentTheme = FlipperTheme(
                mode = mode,
                accent = a.getString(R.styleable.FlipperWidgetView_flipperAccent),
                radius = int(R.styleable.FlipperWidgetView_flipperRadius),
            )
            currentConfig = FlipperConfig(
                chain = int(R.styleable.FlipperWidgetView_flipperChain)?.toLong() ?: FlipperDefaults.CHAIN_ID,
                token = a.getString(R.styleable.FlipperWidgetView_flipperToken),
                tokens = a.getString(R.styleable.FlipperWidgetView_flipperTokens)
                    ?.split(',')
                    ?.map { it.trim() }
                    ?.filter { it.isNotEmpty() },
                partner = a.getString(R.styleable.FlipperWidgetView_flipperPartner),
                locale = a.getString(R.styleable.FlipperWidgetView_flipperLocale),
                compact = bool(R.styleable.FlipperWidgetView_flipperCompact),
                hidePicker = bool(R.styleable.FlipperWidgetView_flipperHidePicker),
                branding = bool(R.styleable.FlipperWidgetView_flipperBranding),
            )
            val defaults = FlipperWidgetOptions()
            currentOptions = FlipperWidgetOptions(
                baseUrl = a.getString(R.styleable.FlipperWidgetView_flipperBaseUrl) ?: defaults.baseUrl,
                allowInsecureLocalhost = bool(R.styleable.FlipperWidgetView_flipperAllowInsecureLocalhost),
                autoHeight = bool(R.styleable.FlipperWidgetView_flipperAutoHeight) ?: defaults.autoHeight,
                initialHeightDp = dp(R.styleable.FlipperWidgetView_flipperInitialHeight) ?: defaults.initialHeightDp,
                minHeightDp = dp(R.styleable.FlipperWidgetView_flipperMinHeight) ?: defaults.minHeightDp,
                maxHeightDp = dp(R.styleable.FlipperWidgetView_flipperMaxHeight),
                enableBatchCalls = bool(R.styleable.FlipperWidgetView_flipperEnableBatchCalls) ?: defaults.enableBatchCalls,
            )
            bridge.enableBatchCalls = currentOptions.enableBatchCalls
            bridge.allowedMethods = currentOptions.allowedMethods
            bridge.minHeight = currentOptions.minHeightDp
            bridge.maxHeight = currentOptions.maxHeightDp
            bridge.chainId = currentConfig.chain
        } finally {
            a.recycle()
        }
    }

    /**
     * `window.FlipperHost` for WebViews without WebMessageListener. Called on a WebView binder thread; holds the
     * view weakly and hops to the main thread. Only [postMessage] is exposed to JavaScript.
     */
    private class JsChannel(view: FlipperWidgetView) {
        private val ref = WeakReference(view)

        @JavascriptInterface
        fun postMessage(message: String?) {
            if (message == null || message.length > FlipperBridge.MAX_MESSAGE_LENGTH) return
            val view = ref.get() ?: return
            view.mainHandler.post { view.onJsInterfaceMessage(message) }
        }
    }

    private companion object {
        const val TAG = "FlipperWidget"
        const val MAX_RENDERER_RECOVERIES = 3

        /** Safety cap so a runaway `resize` can't overflow MeasureSpec / Compose constraints. */
        const val MAX_HEIGHT_DP = 20_000
        const val MAX_MEASURED_PX = 0x00ffffff
    }
}
