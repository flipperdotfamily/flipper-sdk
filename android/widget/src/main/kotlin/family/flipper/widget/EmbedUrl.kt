package family.flipper.widget

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import java.net.URI
import java.net.URISyntaxException

/** A base URL or config value the SDK refuses to load. Surfaced through `onError` with code `config`. */
class FlipperConfigException(message: String) : IllegalArgumentException(message) {
    val code: String get() = "config"
}

/** A validated embed URL and the origin every message and navigation is checked against. */
data class FlipperEmbedUrl(val url: String, val origin: String)

/**
 * Embed URL building and validation (contract section 1). Pure JVM: no android.* imports, so it is unit-testable.
 */
object EmbedUrl {
    /** Hosts that may use plain http, and only when insecure localhost is allowed (debug builds by default). */
    @JvmField
    val DEBUG_HOSTS: Set<String> = setOf("localhost", "127.0.0.1", "10.0.2.2", "::1")

    /**
     * `FlipperEmbedConfig` fields the embed never takes from its URL, since anyone can craft a URL: they decide where
     * funds, approvals and reads go. They're left out of the URL's `config` param, and the bridge sends them in a
     * `config` message after every `ready` ([FlipperBridge.hostConfig]).
     */
    @JvmField
    val HOST_ONLY_CONFIG_KEYS: Set<String> = setOf("rpcUrl", "apiUrl", "addresses")

    /** The host-only fields of [FlipperConfig.extra] (see [HOST_ONLY_CONFIG_KEYS]); empty when none are set. */
    @JvmStatic
    fun hostOnlyConfig(config: FlipperConfig): JsonObject =
        JsonObject(config.extra.orEmpty().filter { (k, v) -> k in HOST_ONLY_CONFIG_KEYS && v !is JsonNull })

    private const val HEX = "0123456789ABCDEF"
    private const val BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

    /**
     * Validates [baseUrl] and appends the query params for [config] and [theme]. Params already on the base URL are
     * kept, except ones this SDK sets (those are replaced, so the SDK's value is the one the page reads).
     *
     * @throws FlipperConfigException if the URL is not allowed; never load it.
     */
    @JvmStatic
    @Throws(FlipperConfigException::class)
    fun build(
        baseUrl: String,
        allowInsecureLocalhost: Boolean,
        config: FlipperConfig = FlipperConfig(),
        theme: FlipperTheme = FlipperTheme(),
    ): FlipperEmbedUrl {
        val uri = parseBase(baseUrl, allowInsecureLocalhost)
        if (config.chain <= 0) throw FlipperConfigException("chain must be a positive chain id, got ${config.chain}")
        val ours = queryParams(config, theme)
        val names = ours.map { it.first }.toSet()
        val kept = uri.rawQuery
            ?.split('&')
            ?.filter { it.isNotEmpty() && it.substringBefore('=') !in names }
            .orEmpty()
        val query = (kept + ours.map { (k, v) -> k + "=" + percentEncode(v) }).joinToString("&")

        val sb = StringBuilder()
        sb.append(uri.scheme.lowercase()).append("://").append(uri.rawAuthority)
        val path = uri.rawPath
        sb.append(if (path.isNullOrEmpty()) "/" else path)
        if (query.isNotEmpty()) sb.append('?').append(query)
        uri.rawFragment?.let { sb.append('#').append(it) }
        val origin = originOfUri(uri) ?: throw FlipperConfigException("baseUrl has no origin: $baseUrl")
        return FlipperEmbedUrl(sb.toString(), origin)
    }

    /**
     * Validates [baseUrl] alone and returns its origin.
     *
     * @throws FlipperConfigException if the URL is not allowed.
     */
    @JvmStatic
    @Throws(FlipperConfigException::class)
    fun validate(baseUrl: String, allowInsecureLocalhost: Boolean): String {
        val uri = parseBase(baseUrl, allowInsecureLocalhost)
        return originOfUri(uri) ?: throw FlipperConfigException("baseUrl has no origin: $baseUrl")
    }

    /**
     * `scheme://host[:port]` of an http(s) URL, lowercased, default ports omitted; null for anything else
     * (opaque URLs, `about:`, `data:`, `file:`, unparseable input). Only the part before the first `/ ? # \`
     * after the scheme is parsed, so odd characters in the path don't matter.
     */
    @JvmStatic
    fun originOf(url: String?): String? {
        if (url == null) return null
        val s = url.trim()
        val schemeEnd = s.indexOf("://")
        if (schemeEnd <= 0) return null
        var end = s.length
        for (i in schemeEnd + 3 until s.length) {
            val c = s[i]
            if (c == '/' || c == '?' || c == '#' || c == '\\') {
                end = i
                break
            }
        }
        val uri = try {
            URI(s.substring(0, end))
        } catch (e: URISyntaxException) {
            return null
        }
        return originOfUri(uri)
    }

    /** True for the debug-only insecure hosts (`[::1]` accepted with or without brackets). */
    @JvmStatic
    fun isDebugHost(host: String): Boolean =
        host.lowercase().removePrefix("[").removeSuffix("]") in DEBUG_HOSTS

    /** The query params the SDK appends, in order. Only fields that are set are included; `chain` always is. */
    @JvmStatic
    fun queryParams(config: FlipperConfig, theme: FlipperTheme): List<Pair<String, String>> {
        val p = ArrayList<Pair<String, String>>()
        p.add("chain" to config.chain.toString())
        config.token?.takeIf { it.isNotEmpty() }?.let { p.add("token" to it) }
        theme.mode?.let { p.add("theme" to it.wireValue) }
        theme.accent?.takeIf { it.isNotEmpty() }?.let { p.add("accent" to it) }
        theme.radius?.let { p.add("radius" to it.toString()) }
        config.branding?.let { p.add("branding" to flag(it)) }
        config.partner?.takeIf { it.isNotEmpty() }?.let { p.add("partner" to it) }
        config.locale?.takeIf { it.isNotEmpty() }?.let { p.add("locale" to it) }
        config.compact?.let { p.add("compact" to flag(it)) }
        config.hidePicker?.let { p.add("hidePicker" to flag(it)) }
        config.mode?.let { p.add("mode" to it.wireValue) }
        config.fit?.let { p.add("fit" to it.wireValue) }
        config.details?.let { p.add("details" to flag(it)) }
        when (val t = config.tagline) {
            FlipperTagline.BuiltIn -> p.add("tagline" to "1")
            is FlipperTagline.Text -> if (t.text.isNotEmpty()) p.add("tagline" to t.text)
            null -> Unit
        }
        config.tokens?.takeIf { it.isNotEmpty() }?.let { p.add("tokens" to it.joinToString(",")) }
        // rpcUrl / apiUrl / addresses: the embed ignores them in its URL; the bridge sends them after `ready`
        config.extra?.filterKeys { it !in HOST_ONLY_CONFIG_KEYS }?.takeIf { it.isNotEmpty() }?.let {
            p.add("config" to base64(JsonObject(it).toString().toByteArray(Charsets.UTF_8)))
        }
        return p
    }

    /** RFC 3986 percent-encoding of UTF-8 bytes; only unreserved characters (`A-Z a-z 0-9 - . _ ~`) stay as-is. */
    @JvmStatic
    fun percentEncode(value: String): String {
        val bytes = value.toByteArray(Charsets.UTF_8)
        val sb = StringBuilder(bytes.size * 3)
        for (b in bytes) {
            val c = b.toInt() and 0xff
            val unreserved = (c >= 'A'.code && c <= 'Z'.code) ||
                (c >= 'a'.code && c <= 'z'.code) ||
                (c >= '0'.code && c <= '9'.code) ||
                c == '-'.code || c == '.'.code || c == '_'.code || c == '~'.code
            if (unreserved) {
                sb.append(c.toChar())
            } else {
                sb.append('%').append(HEX[c shr 4]).append(HEX[c and 0x0f])
            }
        }
        return sb.toString()
    }

    /**
     * Standard base64 (RFC 4648 section 4, with padding, not url-safe). java.util.Base64 needs API 26 and
     * android.util.Base64 isn't available in JVM unit tests, hence this small encoder.
     */
    @JvmStatic
    fun base64(input: ByteArray): String {
        val sb = StringBuilder((input.size + 2) / 3 * 4)
        var i = 0
        while (i + 3 <= input.size) {
            val n = ((input[i].toInt() and 0xff) shl 16) or
                ((input[i + 1].toInt() and 0xff) shl 8) or
                (input[i + 2].toInt() and 0xff)
            sb.append(BASE64[(n shr 18) and 63])
                .append(BASE64[(n shr 12) and 63])
                .append(BASE64[(n shr 6) and 63])
                .append(BASE64[n and 63])
            i += 3
        }
        when (input.size - i) {
            1 -> {
                val n = (input[i].toInt() and 0xff) shl 16
                sb.append(BASE64[(n shr 18) and 63]).append(BASE64[(n shr 12) and 63]).append("==")
            }
            2 -> {
                val n = ((input[i].toInt() and 0xff) shl 16) or ((input[i + 1].toInt() and 0xff) shl 8)
                sb.append(BASE64[(n shr 18) and 63])
                    .append(BASE64[(n shr 12) and 63])
                    .append(BASE64[(n shr 6) and 63])
                    .append('=')
            }
        }
        return sb.toString()
    }

    private fun flag(value: Boolean): String = if (value) "1" else "0"

    private fun parseBase(baseUrl: String, allowInsecureLocalhost: Boolean): URI {
        val trimmed = baseUrl.trim()
        if (trimmed.isEmpty()) throw FlipperConfigException("baseUrl is empty")
        val uri = try {
            URI(trimmed)
        } catch (e: URISyntaxException) {
            throw FlipperConfigException("baseUrl is not a valid URL: $trimmed")
        }
        if (uri.isOpaque || !uri.isAbsolute) throw FlipperConfigException("baseUrl must be an absolute https URL: $trimmed")
        if (uri.rawUserInfo != null) throw FlipperConfigException("baseUrl must not contain user info: $trimmed")
        val host = uri.host?.lowercase()?.takeIf { it.isNotEmpty() }
            ?: throw FlipperConfigException("baseUrl has no valid host: $trimmed")
        when (uri.scheme?.lowercase()) {
            "https" -> Unit
            "http" -> {
                if (!isDebugHost(host)) {
                    throw FlipperConfigException(
                        "baseUrl must use https; http is only allowed for localhost, 127.0.0.1, 10.0.2.2 and [::1]: $trimmed",
                    )
                }
                if (!allowInsecureLocalhost) {
                    throw FlipperConfigException(
                        "http://$host is only allowed when allowInsecureLocalhost is on (debug builds by default): $trimmed",
                    )
                }
            }
            else -> throw FlipperConfigException("baseUrl must use https: $trimmed")
        }
        return uri
    }

    private fun originOfUri(uri: URI): String? {
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        // java.net.URI keeps the brackets of IPv6 literals ("[::1]"), matching the browser's origin serialization.
        val host = uri.host?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
        val port = uri.port
        val defaultPort = if (scheme == "https") 443 else 80
        return if (port == -1 || port == defaultPort) "$scheme://$host" else "$scheme://$host:$port"
    }
}
