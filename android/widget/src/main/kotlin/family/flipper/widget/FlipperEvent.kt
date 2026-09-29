package family.flipper.widget

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

/**
 * An event from the widget (`{ v:1, source:"flipper", type:"event", name, data }`).
 *
 * Payloads follow packages/widget/BRIDGE.md section 5. Parsing is lenient: every typed field is nullable and a
 * wrong type becomes `null`. [data] always holds the raw payload (JSON null when the page sent none), so fields
 * added by later widget versions stay reachable. Amounts are decimal strings in the token's smallest unit.
 */
sealed class FlipperEvent {
    /** Event name as sent by the page (`ready`, `flip-settled`, ...). */
    abstract val name: String

    /** Raw `data` payload. */
    abstract val data: JsonElement

    /** Every payload carries the partner id (`null` without one). */
    val partner: String?
        get() = data.str("partner")

    /** The widget mounted. `account` is null without a wallet. */
    data class Ready(
        val version: String?,
        val chainId: Long?,
        val account: String?,
        val token: String?,
        val variant: String?,
        override val data: JsonElement,
    ) : FlipperEvent() {
        override val name: String get() = READY
    }

    /** The user wants to connect: open your wallet's connect UI, then update the wallet's flows. */
    data class ConnectRequest(
        /** `"connect"`, `"flip"` or `"list"`. */
        val reason: String?,
        override val data: JsonElement,
    ) : FlipperEvent() {
        override val name: String get() = CONNECT_REQUEST
    }

    /** The flip transaction is mined and randomness was requested. */
    data class FlipRequested(
        val flipId: String?,
        val account: String?,
        val token: String?,
        val symbol: String?,
        val decimals: Int?,
        val amount: String?,
        val winChanceBps: Int?,
        val randomnessFee: String?,
        val txHash: String?,
        val approveTxHash: String?,
        override val data: JsonElement,
        /** The stake was native ETH, wrapped to WETH: [token] is WETH and [symbol] is `"ETH"`. */
        val native: Boolean? = null,
    ) : FlipperEvent() {
        override val name: String get() = FLIP_REQUESTED
    }

    /**
     * The coin landed. A pending win (`status == "WinPending"`, `pending == true`) has its winnings still owed, and
     * the widget offers Retry payout. It gets a second `flip-settled` for the same [flipId] once they're paid (with a
     * [PayoutResolved]); de-duplicate by [flipId], the last one is final.
     */
    data class FlipSettled(
        val flipId: String?,
        val account: String?,
        val token: String?,
        val symbol: String?,
        val decimals: Int?,
        val amount: String?,
        /** `"won"`, `"lost"` or `"refunded"`. */
        val outcome: String?,
        /** `Won`, `WonFallback`, `WinPending`, `Lost`, `LostInventory` or `Refunded` (a string). */
        val status: String?,
        val won: Boolean?,
        val pending: Boolean?,
        val payout: String?,
        val payoutToken: String?,
        val flipperPaid: String?,
        val txHash: String?,
        val requestTxHash: String?,
        override val data: JsonElement,
        /** The stake was native ETH, wrapped to WETH: [token] is WETH and [symbol] is `"ETH"`. */
        val native: Boolean? = null,
    ) : FlipperEvent() {
        override val name: String get() = FLIP_SETTLED
    }

    /** A pending win's winnings were paid. Sent once per flip, alongside the final [FlipSettled]. */
    data class PayoutResolved(
        val flipId: String?,
        val account: String?,
        val token: String?,
        val symbol: String?,
        val decimals: Int?,
        /** Winnings paid in [token] (the stake already came back at settlement). */
        val tokenPaid: String?,
        /** $FLIPPER paid instead: `"0"` unless the token still couldn't be bought after the pending timeout. */
        val flipperPaid: String?,
        /** `"self"`: this widget's Retry payout paid it; `"other"`: someone else (usually flipper's payout worker). */
        val by: String?,
        /**
         * The stake was native ETH: [token] is WETH (the winnings are paid in WETH) and [symbol] is `"ETH"`. False,
         * with `"WETH"`, for a pending win the widget only learned about from an earlier session.
         */
        val native: Boolean?,
        /** The `PendingWinResolved` transaction (null if it couldn't be looked up). */
        val txHash: String?,
        override val data: JsonElement,
    ) : FlipperEvent() {
        override val name: String get() = PAYOUT_RESOLVED
    }

    /** Permissionless listing progress. */
    data class Listing(
        /** `"started"`, `"submitted"`, `"listed"` or `"failed"`. */
        val stage: String?,
        val token: String?,
        val symbol: String?,
        val txHash: String?,
        val error: String?,
        override val data: JsonElement,
    ) : FlipperEvent() {
        override val name: String get() = LISTING
    }

    /**
     * Something went wrong. [code] is `user-rejected`, `rejected`, `insufficient-funds`, `revert`, `timeout`,
     * `config`, `network`, `wallet` or `unknown`; [context] is `config`, `wallet`, `preview`, `flip` or `listing`.
     * [message] is plain English and safe to show. Host-side problems (bad base URL, page failed to load, WebView
     * renderer gone) arrive through `onError` too, with code `config`, `network` or `webview`.
     */
    data class Error(
        val code: String?,
        val message: String?,
        val context: String?,
        override val data: JsonElement,
    ) : FlipperEvent() {
        override val name: String get() = ERROR
    }

    /** The widget's border box changed size (CSS px). */
    data class Resize(
        val width: Double?,
        val height: Double?,
        override val data: JsonElement,
    ) : FlipperEvent() {
        override val name: String get() = RESIZE
    }

    /** An event this SDK version doesn't know (forward compatible). */
    data class Unknown(
        override val name: String,
        override val data: JsonElement,
    ) : FlipperEvent()

    companion object {
        const val READY: String = "ready"
        const val CONNECT_REQUEST: String = "connect-request"
        const val FLIP_REQUESTED: String = "flip-requested"
        const val FLIP_SETTLED: String = "flip-settled"
        const val PAYOUT_RESOLVED: String = "payout-resolved"
        const val LISTING: String = "listing"
        const val ERROR: String = "error"
        const val RESIZE: String = "resize"

        /** Builds the typed event for [name]; never throws. */
        @JvmStatic
        fun parse(name: String, data: JsonElement?): FlipperEvent {
            val d = data ?: JsonNull
            return when (name) {
                READY -> Ready(
                    version = d.str("version"),
                    chainId = d.long("chainId"),
                    account = d.str("account"),
                    token = d.str("token"),
                    variant = d.str("variant"),
                    data = d,
                )
                CONNECT_REQUEST -> ConnectRequest(reason = d.str("reason"), data = d)
                FLIP_REQUESTED -> FlipRequested(
                    flipId = d.str("flipId"),
                    account = d.str("account"),
                    token = d.str("token"),
                    symbol = d.str("symbol"),
                    decimals = d.int("decimals"),
                    amount = d.str("amount"),
                    winChanceBps = d.int("winChanceBps"),
                    randomnessFee = d.str("randomnessFee"),
                    txHash = d.str("txHash"),
                    approveTxHash = d.str("approveTxHash"),
                    data = d,
                    native = d.bool("native"),
                )
                FLIP_SETTLED -> FlipSettled(
                    flipId = d.str("flipId"),
                    account = d.str("account"),
                    token = d.str("token"),
                    symbol = d.str("symbol"),
                    decimals = d.int("decimals"),
                    amount = d.str("amount"),
                    outcome = d.str("outcome"),
                    status = d.str("status"),
                    won = d.bool("won"),
                    pending = d.bool("pending"),
                    payout = d.str("payout"),
                    payoutToken = d.str("payoutToken"),
                    flipperPaid = d.str("flipperPaid"),
                    txHash = d.str("txHash"),
                    requestTxHash = d.str("requestTxHash"),
                    data = d,
                    native = d.bool("native"),
                )
                PAYOUT_RESOLVED -> PayoutResolved(
                    flipId = d.str("flipId"),
                    account = d.str("account"),
                    token = d.str("token"),
                    symbol = d.str("symbol"),
                    decimals = d.int("decimals"),
                    tokenPaid = d.str("tokenPaid"),
                    flipperPaid = d.str("flipperPaid"),
                    by = d.str("by"),
                    native = d.bool("native"),
                    txHash = d.str("txHash"),
                    data = d,
                )
                LISTING -> Listing(
                    stage = d.str("stage"),
                    token = d.str("token"),
                    symbol = d.str("symbol"),
                    txHash = d.str("txHash"),
                    error = d.str("error"),
                    data = d,
                )
                ERROR -> Error(
                    code = d.str("code"),
                    message = d.str("message"),
                    context = d.str("context"),
                    data = d,
                )
                RESIZE -> Resize(width = d.double("width"), height = d.double("height"), data = d)
                else -> Unknown(name = name, data = d)
            }
        }
    }
}

// Lenient field readers: a primitive of any JSON type is accepted where it makes sense, anything else is null.

private fun JsonElement.primitive(key: String): JsonPrimitive? {
    val value = (this as? JsonObject)?.get(key) ?: return null
    if (value is JsonNull) return null
    return value as? JsonPrimitive
}

internal fun JsonElement.str(key: String): String? = primitive(key)?.content

internal fun JsonElement.long(key: String): Long? {
    val p = primitive(key) ?: return null
    p.longOrNull?.let { return it }
    val d = p.doubleOrNull ?: return null
    return if (d.isFinite() && d == Math.floor(d) && d >= Long.MIN_VALUE.toDouble() && d <= Long.MAX_VALUE.toDouble()) {
        d.toLong()
    } else {
        null
    }
}

internal fun JsonElement.int(key: String): Int? {
    val l = long(key) ?: return null
    return if (l >= Int.MIN_VALUE && l <= Int.MAX_VALUE) l.toInt() else null
}

internal fun JsonElement.double(key: String): Double? = primitive(key)?.doubleOrNull?.takeIf { it.isFinite() }

internal fun JsonElement.bool(key: String): Boolean? = primitive(key)?.booleanOrNull
