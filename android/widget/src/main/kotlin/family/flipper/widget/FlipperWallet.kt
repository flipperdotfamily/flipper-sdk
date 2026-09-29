package family.flipper.widget

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.math.BigInteger

/**
 * The host app's wallet. The widget has no wallet of its own: every transaction it needs goes through [request], and
 * the wallet MUST show its own confirmation UI for each one. Never auto-approve bridge requests.
 *
 * Only these methods ever reach [request] (the host may narrow the list with
 * [FlipperWidgetOptions.allowedMethods]): `eth_accounts`, `eth_requestAccounts`, `eth_chainId`,
 * `eth_sendTransaction`, `wallet_switchEthereumChain`, `wallet_addEthereumChain`, `wallet_watchAsset`. Message
 * signing (`personal_sign`, `eth_signTypedData_v4`) never does: the widget doesn't sign messages. While [accounts]
 * is empty the SDK answers without calling [request] (see the README, "No wallet").
 */
interface FlipperWallet {
    /**
     * Performs an EIP-1193 request. [params] is a JSON array (EIP-1193 shape) or object, exactly as the page sent
     * it. Return the JSON result (`JsonNull` for null). Throw [FlipperRpcException] with an EIP-1193 code to fail;
     * its code is passed through unchanged (4001 user rejected, 4902 unknown chain, ...). Any other exception is
     * reported as -32603 with its message. There is no timeout: users may take minutes in a wallet.
     *
     * Called on the main thread; switch dispatchers yourself for blocking work.
     */
    suspend fun request(method: String, params: JsonElement): JsonElement

    /** Connected accounts, active account first; empty when disconnected. */
    val accounts: Flow<List<String>>

    /**
     * The wallet's current chain id, or null when unknown. Emit the new id after a successful
     * `wallet_switchEthereumChain` so the widget sees the switch.
     */
    val chainId: Flow<Long?>
}

/**
 * EIP-1193 error thrown by a [FlipperWallet]. [code] reaches the page unchanged; [data] is optional.
 */
open class FlipperRpcException @JvmOverloads constructor(
    val code: Int,
    message: String,
    val data: JsonElement? = null,
) : Exception(message) {
    companion object {
        const val USER_REJECTED: Int = 4001
        const val UNAUTHORIZED: Int = 4100
        const val UNSUPPORTED_METHOD: Int = 4200
        const val DISCONNECTED: Int = 4900
        const val CHAIN_DISCONNECTED: Int = 4901
        const val UNRECOGNIZED_CHAIN: Int = 4902
        const val INVALID_REQUEST: Int = -32600
        const val INVALID_PARAMS: Int = -32602
        const val INTERNAL_ERROR: Int = -32603

        @JvmStatic
        @JvmOverloads
        fun userRejected(message: String = "User rejected the request."): FlipperRpcException =
            FlipperRpcException(USER_REJECTED, message)

        @JvmStatic
        @JvmOverloads
        fun unrecognizedChain(message: String = "Unrecognized chain."): FlipperRpcException =
            FlipperRpcException(UNRECOGNIZED_CHAIN, message)
    }
}

/** Same type under the cross-platform name used by the other flipper SDKs. */
typealias FlipperRpcError = FlipperRpcException

/**
 * Convenience base class: implement [request] and call [update] whenever the wallet connects, switches account or
 * chain, or disconnects.
 */
abstract class MutableFlipperWallet @JvmOverloads constructor(
    initialAccounts: List<String> = emptyList(),
    initialChainId: Long? = null,
) : FlipperWallet {
    private val accountsState = MutableStateFlow(initialAccounts.toList())
    private val chainIdState = MutableStateFlow(initialChainId)

    override val accounts: StateFlow<List<String>> = accountsState.asStateFlow()
    override val chainId: StateFlow<Long?> = chainIdState.asStateFlow()

    /** Replaces the wallet state; the widget receives a `wallet` message if anything changed. */
    fun update(accounts: List<String> = accountsState.value, chainId: Long? = chainIdState.value) {
        accountsState.value = accounts.toList()
        chainIdState.value = chainId
    }

    /** Same as `update(emptyList(), null)`. */
    fun disconnect() {
        update(emptyList(), null)
    }
}

/** Chain id helpers. Accepts integers, decimal strings (`"4663"`), hex (`"0x1237"`) and CAIP-2 (`"eip155:4663"`). */
object FlipperChainId {
    /** Returns the positive chain id, or null if [value] isn't one. */
    @JvmStatic
    fun parse(value: Any?): Long? {
        val id: Long? = when (value) {
            null -> null
            is Long -> value
            is Int -> value.toLong()
            is Short -> value.toLong()
            is Byte -> value.toLong()
            is BigInteger -> if (value.bitLength() < 64) value.toLong() else null
            is Double -> integral(value)
            is Float -> integral(value.toDouble())
            is JsonPrimitive -> if (value.isString) parseString(value.content) else value.longOrNull ?: value.doubleOrNull?.let { integral(it) }
            is CharSequence -> parseString(value.toString())
            else -> null
        }
        return id?.takeIf { it > 0 }
    }

    /** `"0x"` + lowercase hex, or null if [value] isn't a positive chain id. */
    @JvmStatic
    fun toHex(value: Any?): String? = parse(value)?.let { "0x" + java.lang.Long.toHexString(it) }

    private fun integral(d: Double): Long? =
        if (d.isFinite() && d == Math.floor(d) && d > 0 && d < 9.0E18) d.toLong() else null

    private fun parseString(raw: String): Long? {
        var s = raw.trim()
        if (s.startsWith("eip155:", ignoreCase = true)) s = s.substring(7)
        if (s.isEmpty()) return null
        return if (s.startsWith("0x") || s.startsWith("0X")) {
            val hex = s.substring(2)
            if (hex.isEmpty() || hex.length > 15 || !hex.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) {
                null
            } else {
                hex.toLong(16)
            }
        } else {
            if (s.length > 18 || !s.all { it in '0'..'9' }) null else s.toLong()
        }
    }
}
