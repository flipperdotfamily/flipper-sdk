package family.flipper.widget

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import kotlin.math.ceil

/**
 * The host side of embed bridge protocol v1 (contract sections 3 to 6), with no WebView dependency.
 *
 * Inputs: raw strings from `window.FlipperHost.postMessage` with their frame origin ([onMessage]), page loads
 * ([onPageStarted]), the host wallet ([wallet]) and live config ([sendConfig]).
 * Outputs: JavaScript to evaluate in the page ([evaluateJavascript]) and callbacks on [listener].
 *
 * Not thread-safe: call it from one thread (the main thread in the view), and give it a [scope] whose dispatcher is
 * that thread (the view uses `Dispatchers.Main.immediate`). Wallet requests and wallet-state collection run in
 * [scope]; cancelling it stops them.
 */
class FlipperBridge @JvmOverloads constructor(
    private val scope: CoroutineScope,
    private val evaluateJavascript: (String) -> Unit,
    private val listener: FlipperWidgetListener,
    embedOrigin: String = "",
    chainId: Long = FlipperDefaults.CHAIN_ID,
    allowedMethods: Set<String>? = null,
    minHeight: Int = FlipperDefaults.MIN_HEIGHT_DP,
    maxHeight: Int? = null,
    private val log: (String) -> Unit = {},
) {
    /** Origin messages must come from (`scheme://host[:port]`). Empty = drop everything. */
    var embedOrigin: String = normalizeOrigin(embedOrigin)
        set(value) {
            field = normalizeOrigin(value)
        }

    /** The configured chain: answers `eth_chainId` without a wallet and fills `wallet.chainId` when unknown. */
    var chainId: Long = chainId

    /**
     * Also forward the optional EIP-5792 methods ([BATCH_CALL_METHODS]) so wallets with atomic batches confirm a
     * native-ETH flip once. Default false: they're answered with 4200 and the embed sends transactions one by one.
     */
    var enableBatchCalls: Boolean = false
        set(value) {
            field = value
            effectiveMethods = computeAllowlist(value, allowedMethods)
        }

    /** Narrows [ALLOWED_METHODS] (plus [BATCH_CALL_METHODS] when enabled); `null` = all of them. Never widens. */
    var allowedMethods: Set<String>? = allowedMethods
        set(value) {
            field = value
            effectiveMethods = computeAllowlist(enableBatchCalls, value)
        }

    var minHeight: Int = minHeight
    var maxHeight: Int? = maxHeight

    /**
     * Config the embed only accepts from its host, never from its URL (`rpcUrl`, `apiUrl`, `addresses`; see
     * [EmbedUrl.hostOnlyConfig]). Sent in a `config` message after every `ready`, under any queued live changes. The
     * view sets it from the current config on every load and update. Keys `v`, `source` and `type` are ignored.
     */
    var hostConfig: JsonObject = JsonObject(emptyMap())
        set(value) {
            field = JsonObject(value.filterKeys { it !in ConfigDiff.RESERVED_KEYS })
        }

    /** True between the page's `ready` event and the next page load. */
    var isReady: Boolean = false
        private set

    /** Bumped on every top-level page load; replies to older requests are discarded. */
    var generation: Int = 0
        private set

    private var effectiveMethods: Set<String> = computeAllowlist(false, allowedMethods)
    private val inFlight = HashSet<String>()
    private val queue = ArrayDeque<Outbound>()
    private var lastWallet: WalletState? = null
    private var walletAccounts: List<String> = emptyList()
    private var walletChainHex: String? = null
    private var walletJob: Job? = null
    private var disposed = false

    /**
     * The host wallet. Setting a different object resubscribes to its flows; setting null pushes the disconnected
     * state (`accounts: []`, the configured chain).
     */
    var wallet: FlipperWallet? = null
        set(value) {
            if (value === field) return
            field = value
            walletJob?.cancel()
            walletJob = null
            walletAccounts = emptyList()
            walletChainHex = null
            if (value == null) {
                pushWalletState()
                return
            }
            if (disposed) return
            walletJob = scope.launch {
                combine(value.accounts, value.chainId) { accounts, chain -> accounts to chain }
                    .distinctUntilChanged()
                    .catch { e -> log("wallet state flow failed: ${e.message}") }
                    .collect { state ->
                        if (this@FlipperBridge.wallet === value) onWalletState(state.first, state.second)
                    }
            }
        }

    /** A new top-level page load started: not ready, new generation, pending replies dropped. */
    fun onPageStarted() {
        generation++
        isReady = false
        inFlight.clear()
        lastWallet = null
        queue.removeAll { it.kind == Kind.RPC_REPLY || it.kind == Kind.WALLET }
    }

    /**
     * Handles one `FlipperHost.postMessage` payload. [origin] is the sending frame's origin (or the WebView's
     * current URL origin where the platform gives no frame info); [isMainFrame] whether it came from the top frame.
     */
    fun onMessage(message: String, origin: String?, isMainFrame: Boolean) {
        if (disposed) return
        if (!isMainFrame) {
            log("dropped a message from a sub-frame")
            return
        }
        val from = origin?.let { EmbedUrl.originOf(it) }
        if (from == null || embedOrigin.isEmpty() || from != embedOrigin) {
            log("dropped a message from origin $origin (expected $embedOrigin)")
            return
        }
        if (message.length > MAX_MESSAGE_LENGTH) {
            log("dropped a message of ${message.length} chars")
            return
        }
        val parsed = try {
            Json.parseToJsonElement(message)
        } catch (e: Exception) {
            null
        }
        val obj = parsed as? JsonObject ?: return
        val v = obj["v"] as? JsonPrimitive ?: return
        if (v.isString || v.doubleOrNull != 1.0) return
        val source = obj["source"] as? JsonPrimitive ?: return
        if (!source.isString || source.content != "flipper") return
        val type = obj["type"] as? JsonPrimitive ?: return
        if (!type.isString) return
        when (type.content) {
            "rpc" -> handleRpc(obj)
            "event" -> handleEvent(obj)
            else -> log("dropped a message of type ${type.content}")
        }
    }

    /**
     * Sends a live `config` partial (queued and merged until `ready`). Keys `v`, `source` and `type` are ignored.
     */
    fun sendConfig(partial: JsonObject) {
        val fields = JsonObject(partial.filterKeys { it !in ConfigDiff.RESERVED_KEYS })
        if (fields.isEmpty()) return
        emit(Outbound(Kind.CONFIG, fields))
    }

    /** Stops wallet collection and drops everything queued; later calls are no-ops. */
    fun dispose() {
        disposed = true
        walletJob?.cancel()
        walletJob = null
        queue.clear()
        inFlight.clear()
    }

    // ---------------------------------------------------------------------------------------------------------
    // RPC

    private fun handleRpc(obj: JsonObject) {
        val id = obj["id"] as? JsonPrimitive ?: return
        if (id is JsonNull) return
        if (!id.isString) {
            val n = id.doubleOrNull ?: return
            if (!n.isFinite()) return
        }
        val methodEl = obj["method"] as? JsonPrimitive
        if (methodEl == null || methodEl is JsonNull || !methodEl.isString) {
            reply(rpcError(id, FlipperRpcException.INVALID_REQUEST, "Invalid request"))
            return
        }
        val method = methodEl.content
        val rawParams = obj["params"]
        val params: JsonElement = when {
            rawParams == null || rawParams is JsonNull -> JsonArray(emptyList())
            rawParams is JsonArray -> rawParams
            rawParams is JsonObject -> rawParams
            else -> {
                reply(rpcError(id, FlipperRpcException.INVALID_PARAMS, "Invalid params"))
                return
            }
        }
        val key = idKey(id)
        if (key in inFlight) {
            reply(rpcError(id, FlipperRpcException.INVALID_REQUEST, "Duplicate request id"))
            return
        }
        if (method !in effectiveMethods) {
            reply(rpcError(id, FlipperRpcException.UNSUPPORTED_METHOD, "Unsupported method: $method"))
            return
        }
        val w = wallet
        if (w == null || walletAccounts.isEmpty()) {
            answerWithoutWallet(id, method)
            return
        }
        inFlight.add(key)
        val gen = generation
        scope.launch {
            val response: JsonObject = try {
                rpcResult(id, w.request(method, params))
            } catch (e: Throwable) {
                // Our own cancellation (view destroyed): no reply. A CancellationException thrown by the wallet
                // while we're still active is an ordinary failure.
                if (e is CancellationException) ensureActive()
                errorReply(id, e)
            }
            if (disposed || gen != generation) return@launch
            inFlight.remove(key)
            reply(response)
        }
    }

    private fun answerWithoutWallet(id: JsonPrimitive, method: String) {
        when (method) {
            "eth_accounts" -> reply(rpcResult(id, JsonArray(emptyList())))
            "eth_chainId" -> reply(rpcResult(id, JsonPrimitive(configuredChainHex())))
            "eth_requestAccounts" -> {
                listener.onConnectRequest(null)
                reply(
                    rpcError(
                        id,
                        FlipperRpcException.UNAUTHORIZED,
                        "No wallet connected. The host app was asked to connect one.",
                    ),
                )
            }
            else -> reply(rpcError(id, FlipperRpcException.UNAUTHORIZED, "No wallet connected."))
        }
    }

    private fun errorReply(id: JsonPrimitive, e: Throwable): JsonObject {
        val message = e.message?.takeIf { it.isNotBlank() } ?: "Internal error"
        return if (e is FlipperRpcException) {
            rpcError(id, e.code, message, e.data)
        } else {
            rpcError(id, FlipperRpcException.INTERNAL_ERROR, message)
        }
    }

    private fun reply(message: JsonObject) {
        emit(Outbound(Kind.RPC_REPLY, message))
    }

    // ---------------------------------------------------------------------------------------------------------
    // Events

    private fun handleEvent(obj: JsonObject) {
        val nameEl = obj["name"] as? JsonPrimitive ?: return
        if (nameEl is JsonNull || !nameEl.isString) return
        val data = obj["data"] ?: JsonNull
        val event = FlipperEvent.parse(nameEl.content, data)
        listener.onEvent(event)
        when (event) {
            is FlipperEvent.Ready -> {
                isReady = true
                if (hostConfig.isNotEmpty()) {
                    // no URL carries these: merged under any queued live change, so the newest value wins
                    val index = queue.indexOfFirst { it.kind == Kind.CONFIG }
                    if (index >= 0) queue[index] = Outbound(Kind.CONFIG, JsonObject(hostConfig + queue[index].payload))
                    else queue.addFirst(Outbound(Kind.CONFIG, hostConfig))
                }
                flush()
                pushWalletState()
                listener.onReady(event)
            }
            is FlipperEvent.ConnectRequest -> listener.onConnectRequest(event.reason)
            is FlipperEvent.FlipRequested -> listener.onFlipRequested(event)
            is FlipperEvent.FlipSettled -> listener.onFlipSettled(event)
            is FlipperEvent.PayoutResolved -> listener.onPayoutResolved(event)
            is FlipperEvent.Listing -> listener.onListing(event)
            is FlipperEvent.Error -> listener.onError(event)
            is FlipperEvent.Resize -> clampHeight(data)?.let { listener.onResize(it) }
            is FlipperEvent.Unknown -> Unit
        }
    }

    /** `data.height` must be a finite JSON number > 0; returns clamp(ceil(height), min, max). */
    internal fun clampHeight(data: JsonElement): Int? {
        val h = (data as? JsonObject)?.get("height") as? JsonPrimitive ?: return null
        if (h.isString) return null
        val value = h.doubleOrNull ?: return null
        if (!value.isFinite() || value <= 0.0) return null
        return clampHeight(value, minHeight, maxHeight)
    }

    // ---------------------------------------------------------------------------------------------------------
    // Wallet state

    private fun onWalletState(accounts: List<String>, chain: Long?) {
        walletAccounts = accounts.toList()
        walletChainHex = FlipperChainId.toHex(chain)
        pushWalletState()
    }

    private fun pushWalletState() {
        if (disposed) return
        val connected = wallet != null && walletAccounts.isNotEmpty()
        val state = WalletState(
            accounts = if (connected) walletAccounts else emptyList(),
            chainId = (if (connected) walletChainHex else null) ?: configuredChainHex(),
        )
        if (state == lastWallet) return
        lastWallet = state
        val message = envelope("wallet") {
            put("accounts", JsonArray(state.accounts.map { JsonPrimitive(it) }))
            put("chainId", state.chainId)
        }
        emit(Outbound(Kind.WALLET, message))
    }

    private fun configuredChainHex(): String = FlipperChainId.toHex(chainId) ?: "0x0"

    // ---------------------------------------------------------------------------------------------------------
    // Outbound queue

    private fun emit(out: Outbound) {
        if (disposed) return
        // RPC answers go out at once: the page that asked is alive, and the embed reads eth_accounts / eth_chainId
        // when it mounts, before it says `ready`. Only wallet state and config wait for `ready`.
        if (isReady || out.kind == Kind.RPC_REPLY) {
            deliver(out)
            return
        }
        var entry = out
        when (out.kind) {
            Kind.WALLET -> queue.removeAll { it.kind == Kind.WALLET }
            Kind.CONFIG -> {
                val index = queue.indexOfFirst { it.kind == Kind.CONFIG }
                if (index >= 0) {
                    val previous = queue.removeAt(index)
                    entry = Outbound(Kind.CONFIG, JsonObject(previous.payload + out.payload))
                }
            }
            Kind.RPC_REPLY -> Unit
        }
        queue.addLast(entry)
        while (queue.size > QUEUE_LIMIT) queue.removeFirst()
    }

    private fun flush() {
        while (queue.isNotEmpty()) deliver(queue.removeFirst())
    }

    private fun deliver(out: Outbound) {
        val message = if (out.kind == Kind.CONFIG) {
            envelope("config") { out.payload.forEach { (k, v) -> put(k, v) } }
        } else {
            out.payload
        }
        evaluateJavascript(deliveryScript(message.toString()))
    }

    private enum class Kind { RPC_REPLY, WALLET, CONFIG }

    /** For CONFIG, [payload] is the partial (fields only); otherwise the full message. */
    private class Outbound(val kind: Kind, val payload: JsonObject)

    private data class WalletState(val accounts: List<String>, val chainId: String)

    companion object {
        /** Name of the JavaScript object the page posts to. */
        const val HOST_OBJECT_NAME: String = "FlipperHost"

        const val PROTOCOL_VERSION: Int = 1

        /** Inbound messages longer than this (UTF-16 code units, like JS `length`) are dropped. */
        const val MAX_MESSAGE_LENGTH: Int = 524_288

        /** Outbound messages queued before `ready`; the oldest is dropped beyond this. */
        const val QUEUE_LIMIT: Int = 100

        /**
         * The only RPC methods that may cross the bridge (exact, case-sensitive). No message signing
         * (`personal_sign`, `eth_signTypedData_*`): the embed never signs messages, so a compromised embed can't
         * ask for a Permit signature.
         */
        @JvmField
        val ALLOWED_METHODS: Set<String> = linkedSetOf(
            "eth_accounts",
            "eth_requestAccounts",
            "eth_chainId",
            "eth_sendTransaction",
            "wallet_switchEthereumChain",
            "wallet_addEthereumChain",
            "wallet_watchAsset",
        )

        /**
         * Optional EIP-5792 methods the embed uses for one-confirmation native-ETH flips. Forwarded only with
         * [enableBatchCalls] ([FlipperWidgetOptions.enableBatchCalls]).
         */
        @JvmField
        val BATCH_CALL_METHODS: Set<String> = linkedSetOf("wallet_getCapabilities", "wallet_sendCalls", "wallet_getCallsStatus")

        /** Every method the embed can send; nothing outside this set is ever forwarded. */
        @JvmField
        val BRIDGE_METHODS: Set<String> = LinkedHashSet(ALLOWED_METHODS + BATCH_CALL_METHODS)

        private const val SCRIPT_PREFIX =
            "(function(m){try{if(window.FlipperBridge&&typeof window.FlipperBridge.receive===\"function\")" +
                "{window.FlipperBridge.receive(m);}else{window.postMessage(JSON.parse(m),window.location.origin);}}" +
                "catch(e){}})("
        private const val SCRIPT_SUFFIX = ");true;"

        /** The exact JavaScript that delivers the JSON string [json] to the page (contract section 4). */
        @JvmStatic
        fun deliveryScript(json: String): String = SCRIPT_PREFIX + jsStringLiteral(json) + SCRIPT_SUFFIX

        /**
         * [value] as a JavaScript string literal: JSON string encoding, plus U+2028 / U+2029 escaped as
         * six-character backslash-u sequences (built from code points so no raw separator ever appears in source).
         */
        @JvmStatic
        fun jsStringLiteral(value: String): String {
            val json = JsonPrimitive(value).toString()
            if (json.none { it.code == LINE_SEPARATOR || it.code == PARAGRAPH_SEPARATOR }) return json
            val sb = StringBuilder(json.length + 16)
            for (c in json) {
                when (c.code) {
                    LINE_SEPARATOR -> sb.append('\\').append("u2028")
                    PARAGRAPH_SEPARATOR -> sb.append('\\').append("u2029")
                    else -> sb.append(c)
                }
            }
            return sb.toString()
        }

        /** clamp(ceil(height), min, max) as in contract section 3.5. */
        @JvmStatic
        fun clampHeight(height: Double, minHeight: Int, maxHeight: Int?): Int {
            val up = ceil(height)
            var result = if (up >= Int.MAX_VALUE.toDouble()) Int.MAX_VALUE else up.toInt()
            if (maxHeight != null && result > maxHeight) result = maxHeight
            if (result < minHeight) result = minHeight
            return result
        }

        private const val LINE_SEPARATOR = 0x2028
        private const val PARAGRAPH_SEPARATOR = 0x2029

        /** The forwarded set: [ALLOWED_METHODS], plus [BATCH_CALL_METHODS] when enabled, narrowed by [narrowed]. */
        @JvmStatic
        fun computeAllowlist(enableBatchCalls: Boolean, narrowed: Set<String>?): Set<String> {
            val base = if (enableBatchCalls) BRIDGE_METHODS else ALLOWED_METHODS
            return if (narrowed == null) base else base.filterTo(LinkedHashSet()) { it in narrowed }
        }

        private fun normalizeOrigin(value: String): String =
            if (value.isEmpty()) "" else EmbedUrl.originOf(value) ?: value

        private fun idKey(id: JsonPrimitive): String = (if (id.isString) "s:" else "n:") + id.content

        private fun envelope(type: String, fill: JsonObjectBuilder.() -> Unit): JsonObject =
            buildJsonObject {
                put("v", PROTOCOL_VERSION)
                put("source", "flipper-host")
                put("type", type)
                fill()
            }

        private fun rpcResult(id: JsonPrimitive, result: JsonElement): JsonObject = envelope("rpc-result") {
            put("id", id)
            put("result", result)
        }

        private fun rpcError(id: JsonPrimitive, code: Int, message: String, data: JsonElement? = null): JsonObject =
            envelope("rpc-error") {
                put("id", id)
                put(
                    "error",
                    buildJsonObject {
                        put("code", code)
                        put("message", message)
                        if (data != null && data !is JsonNull) put("data", data)
                    },
                )
            }
    }
}
