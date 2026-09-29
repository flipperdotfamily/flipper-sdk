package family.flipper.widget

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Shared constants (identical across the flipper.family mobile SDKs). */
object FlipperDefaults {
    /** Hosted embed page. */
    const val EMBED_URL: String = "https://flipper.family/embed"

    /** The local web app as seen from the Android emulator (`10.0.2.2` is the host machine). */
    const val EMULATOR_DEV_EMBED_URL: String = "http://10.0.2.2:3000/embed"

    /** Robinhood Chain, the launch chain. */
    const val CHAIN_ID: Long = 4663L

    /** The local anvil fork started by the repo's `dev.sh`. */
    const val LOCAL_CHAIN_ID: Long = 31337L

    const val INITIAL_HEIGHT_DP: Int = 560
    const val MIN_HEIGHT_DP: Int = 120

    const val SDK_VERSION: String = "0.1.0"
    const val BRIDGE_VERSION: Int = 1
}

/** Colour mode of the widget. `AUTO` follows `prefers-color-scheme` inside the WebView. */
/** [PICKER] (default): the user chooses the token. [SINGLE]: one fixed token (set `token`), and no picker is rendered. */
enum class FlipperTokenMode(val wireValue: String) {
    PICKER("picker"),
    SINGLE("single"),
}

/** [AUTO] (default): the view takes the widget's content height. [FILL]: the widget fills the view's size. */
enum class FlipperFit(val wireValue: String) {
    AUTO("auto"),
    FILL("fill"),
}

/** The idle headline under the coin ([FlipperConfig.tagline]; default none). */
sealed class FlipperTagline {
    /** The built-in one: "Double or nothing" and its payout line. */
    object BuiltIn : FlipperTagline()

    /** Your own line. */
    data class Text(val text: String) : FlipperTagline()

    internal val wire: JsonPrimitive
        get() = when (this) {
            BuiltIn -> JsonPrimitive(true)
            is Text -> JsonPrimitive(text)
        }
}

enum class FlipperThemeMode(val wireValue: String) {
    LIGHT("light"),
    DARK("dark"),
    AUTO("auto"),
}

/**
 * Look of the widget. Every field is optional; `null` means "use the embed's default".
 *
 * @property mode light / dark / auto (URL param `theme`).
 * @property accent any CSS colour string, e.g. `#7C5CFF` (URL param `accent`).
 * @property radius card corner radius in CSS px, 0..40 (URL param `radius`).
 *
 * For custom theme tokens (the embed's `theme` object) put a `theme` object in [FlipperConfig.extra]
 * (see [flipperExtraConfig]); it wins over [mode] because the embed applies `config` after the URL params.
 */
data class FlipperTheme(
    val mode: FlipperThemeMode? = null,
    val accent: String? = null,
    val radius: Int? = null,
)

/**
 * What the widget shows. Changing [chain] or [partner] after the first load reloads the page; every other field
 * is pushed live as one `config` message.
 *
 * @property chain chain id to flip on (always sent; default Robinhood Chain 4663; local fork 31337).
 * @property token token address selected at start.
 * @property tokens allowlist of token addresses offered by the picker.
 * @property partner attribution id `[A-Za-z0-9._:-]{1,64}`, echoed in every event.
 * @property locale BCP 47 tag (`en`, `es`).
 * @property compact compact layout (`variant: "compact"` in live config messages).
 * @property hidePicker deprecated: use [mode] = [FlipperTokenMode.SINGLE].
 * @property branding `false` removes flipper.family marks (white-label).
 * @property extra any further `FlipperEmbedConfig` fields (brandName, brandLogo, coinImage, strings, ...), sent as
 *   base64 JSON in the `config` URL param and spread at the top level of live `config` messages. `rpcUrl`, `apiUrl`
 *   and `addresses` never go in the URL ([EmbedUrl.HOST_ONLY_CONFIG_KEYS]): they're sent after every `ready`.
 * @property mode [FlipperTokenMode.PICKER] (default) or [FlipperTokenMode.SINGLE] (one fixed token: set [token]; the
 *   embed shows a configuration error without it).
 * @property fit [FlipperFit.FILL]: the widget fills the view (give it a size; `autoHeight` is then ignored).
 * @property details show the win chance / payout / fee line under the button (default off: the widget only flags
 *   odds that fees trim below the usual).
 * @property tagline a headline under the coin while idle: [FlipperTagline.BuiltIn] or [FlipperTagline.Text]
 *   (default none).
 */
data class FlipperConfig(
    val chain: Long = FlipperDefaults.CHAIN_ID,
    val token: String? = null,
    val tokens: List<String>? = null,
    val partner: String? = null,
    val locale: String? = null,
    val compact: Boolean? = null,
    val hidePicker: Boolean? = null,
    val branding: Boolean? = null,
    val extra: JsonObject? = null,
    // appended (not inserted) so positional callers keep compiling
    val mode: FlipperTokenMode? = null,
    val fit: FlipperFit? = null,
    val details: Boolean? = null,
    val tagline: FlipperTagline? = null,
)

/**
 * Behaviour of the host view (not sent to the page, except that [baseUrl] decides what is loaded).
 *
 * @property baseUrl embed page. Must be https; http only for localhost / 127.0.0.1 / 10.0.2.2 / [::1] when
 *   [allowInsecureLocalhost] is on. Changing it reloads the page.
 * @property allowInsecureLocalhost `null` (default) = allowed exactly when the app is debuggable.
 * @property enableBatchCalls also forward the optional EIP-5792 methods (`wallet_getCapabilities`,
 *   `wallet_sendCalls`, `wallet_getCallsStatus`) for one-confirmation native-ETH flips. Default false (4200).
 * @property allowedMethods narrows the RPC allowlist (the seven wallet methods, plus the batch methods when enabled);
 *   can never widen it.
 * @property autoHeight size the view to the page's `resize` events.
 * @property initialHeightDp height before the first `resize` (and the fixed height when [autoHeight] is off and the
 *   view is `wrap_content`).
 * @property minHeightDp lower clamp for `resize` heights.
 * @property maxHeightDp upper clamp for `resize` heights; `null` = none.
 */
data class FlipperWidgetOptions(
    val baseUrl: String = FlipperDefaults.EMBED_URL,
    val allowInsecureLocalhost: Boolean? = null,
    val allowedMethods: Set<String>? = null,
    val enableBatchCalls: Boolean = false,
    val autoHeight: Boolean = true,
    val initialHeightDp: Int = FlipperDefaults.INITIAL_HEIGHT_DP,
    val minHeightDp: Int = FlipperDefaults.MIN_HEIGHT_DP,
    val maxHeightDp: Int? = null,
)

/**
 * Builds the [FlipperConfig.extra] object from the embed's white-label fields. Every argument is optional; only
 * non-null ones are included. [other] is merged last, so it can carry fields this SDK version doesn't model yet.
 *
 * @param brandLogo image as a `data:` URI (the embed's CSP loads images only from flipper.family and `data:`);
 *   the same for [coinImage] and [coinImageTails].
 * @param themeTokens the embed's custom theme object (sent as `theme`; overrides [FlipperTheme.mode]).
 * @param approval `"max"` (default in the embed) or `"exact"` allowance.
 * @param rpcUrl host-only, like [apiUrl] and [addresses]: never put in the embed URL, but sent in a `config` message
 *   after every `ready` ([FlipperBridge.hostConfig]).
 */
fun flipperExtraConfig(
    brandName: String? = null,
    brandLogo: String? = null,
    coinImage: String? = null,
    coinImageTails: String? = null,
    strings: Map<String, String>? = null,
    minAmount: String? = null,
    maxAmount: String? = null,
    approval: String? = null,
    listing: Boolean? = null,
    rpcUrl: String? = null,
    apiUrl: String? = null,
    addresses: Map<String, String>? = null,
    themeTokens: JsonObject? = null,
    other: JsonObject? = null,
): JsonObject {
    val m = LinkedHashMap<String, JsonElement>()
    brandName?.let { m["brandName"] = JsonPrimitive(it) }
    brandLogo?.let { m["brandLogo"] = JsonPrimitive(it) }
    coinImage?.let { m["coinImage"] = JsonPrimitive(it) }
    coinImageTails?.let { m["coinImageTails"] = JsonPrimitive(it) }
    strings?.let { s -> m["strings"] = JsonObject(s.mapValues { JsonPrimitive(it.value) }) }
    minAmount?.let { m["minAmount"] = JsonPrimitive(it) }
    maxAmount?.let { m["maxAmount"] = JsonPrimitive(it) }
    approval?.let { m["approval"] = JsonPrimitive(it) }
    listing?.let { m["listing"] = JsonPrimitive(it) }
    rpcUrl?.let { m["rpcUrl"] = JsonPrimitive(it) }
    apiUrl?.let { m["apiUrl"] = JsonPrimitive(it) }
    addresses?.let { a -> m["addresses"] = JsonObject(a.mapValues { JsonPrimitive(it.value) }) }
    themeTokens?.let { m["theme"] = it }
    other?.let { m.putAll(it) }
    return JsonObject(m)
}

/** Decides between "reload the page" and "send a live `config` message" (contract section 6). */
internal object ConfigDiff {
    /** Keys a live config message may never carry (they would corrupt the envelope). */
    val RESERVED_KEYS: Set<String> = setOf("v", "source", "type")

    fun requiresReload(old: FlipperConfig, new: FlipperConfig): Boolean =
        old.chain != new.chain || old.partner != new.partner

    /**
     * The changed fields, with the embed's `FlipperEmbedConfig` names. An unset boolean / enum goes back to the
     * embed's documented default; other unset fields are sent as JSON null. Extra keys are spread last (they win,
     * as they do in the URL where `config` is applied after the individual params); removed extra keys are null.
     */
    fun partial(
        oldConfig: FlipperConfig,
        oldTheme: FlipperTheme,
        newConfig: FlipperConfig,
        newTheme: FlipperTheme,
    ): JsonObject {
        val m = LinkedHashMap<String, JsonElement>()
        if (oldTheme.mode != newTheme.mode) {
            m["theme"] = JsonPrimitive((newTheme.mode ?: FlipperThemeMode.AUTO).wireValue)
        }
        if (oldTheme.accent != newTheme.accent) m["accent"] = JsonPrimitive(newTheme.accent)
        if (oldTheme.radius != newTheme.radius) m["radius"] = JsonPrimitive(newTheme.radius)
        if (oldConfig.branding != newConfig.branding) m["branding"] = JsonPrimitive(newConfig.branding ?: true)
        if (oldConfig.locale != newConfig.locale) m["locale"] = JsonPrimitive(newConfig.locale)
        if (oldConfig.compact != newConfig.compact) {
            m["variant"] = JsonPrimitive(if (newConfig.compact == true) "compact" else "card")
        }
        if (oldConfig.hidePicker != newConfig.hidePicker) m["hidePicker"] = JsonPrimitive(newConfig.hidePicker ?: false)
        if (oldConfig.mode != newConfig.mode) m["mode"] = JsonPrimitive((newConfig.mode ?: FlipperTokenMode.PICKER).wireValue)
        if (oldConfig.fit != newConfig.fit) m["fit"] = JsonPrimitive((newConfig.fit ?: FlipperFit.AUTO).wireValue)
        if (oldConfig.details != newConfig.details) m["details"] = JsonPrimitive(newConfig.details ?: false)
        if (oldConfig.tagline != newConfig.tagline) m["tagline"] = newConfig.tagline?.wire ?: JsonPrimitive(false)
        if (oldConfig.token != newConfig.token) m["token"] = JsonPrimitive(newConfig.token)
        if (oldConfig.tokens != newConfig.tokens) {
            m["tokens"] = newConfig.tokens?.let { list -> JsonArray(list.map { JsonPrimitive(it) }) } ?: JsonNull
        }
        val oldExtra = oldConfig.extra ?: JsonObject(emptyMap())
        val newExtra = newConfig.extra ?: JsonObject(emptyMap())
        for ((key, value) in newExtra) {
            if (key in RESERVED_KEYS) continue
            if (oldExtra[key] != value) m[key] = value
        }
        for (key in oldExtra.keys) {
            if (key in RESERVED_KEYS) continue
            if (key !in newExtra) m[key] = JsonNull
        }
        return JsonObject(m)
    }
}
