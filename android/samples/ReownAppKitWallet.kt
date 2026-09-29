// SAMPLE, not part of the family.flipper:widget library (the library has no Reown dependency).
// Copy into your app, which must depend on Reown AppKit:
//
//   implementation(platform("com.reown:android-bom:<BOM_VERSION>"))   // e.g. 1.6.17 (Sept 2026)
//   implementation("com.reown:android-core")
//   implementation("com.reown:appkit")
//
// Written against reown-kotlin master (Sept 2026): AppKit.request(Request, onSuccess: (SentRequestResult) -> Unit,
// onError), AppKit.ModalDelegate.onSessionRequestResponse(Modal.Model.SessionRequestResponse), AppKit.getAccount(),
// AppKit.getSession(). Compile-checked against the com.reown:appkit/android-core/sign 1.6.17 classes. Those are
// built with Kotlin 2.4 metadata, so the app needs Kotlin 2.3 or newer. Runtime behaviour is untested; points that
// are inferred rather than documented are marked "UNVERIFIED".

package com.example.flipper.reown

import com.reown.appkit.client.AppKit
import com.reown.appkit.client.Modal
import com.reown.appkit.client.models.Session
import com.reown.appkit.client.models.request.Request
import com.reown.appkit.client.models.request.SentRequestResult
import com.reown.appkit.engine.coinbase.CoinbaseResult
import com.reown.appkit.utils.EthUtils
import family.flipper.widget.FlipperChainId
import family.flipper.widget.FlipperRpcException
import family.flipper.widget.FlipperWallet
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Robinhood Chain (4663) as an AppKit network. Pass it to AppKit.setChains(...) before opening the modal. */
val RobinhoodChain: Modal.Model.Chain = Modal.Model.Chain(
    chainName = "Robinhood Chain",
    chainNamespace = "eip155",
    chainReference = "4663",
    requiredMethods = EthUtils.ethRequiredMethods,
    // The widget also uses wallet_watchAsset ("Add to wallet"). It never signs messages.
    optionalMethods = EthUtils.ethOptionalMethods + listOf("wallet_watchAsset"),
    events = EthUtils.ethEvents,
    token = Modal.Model.Token(name = "Ether", symbol = "ETH", decimal = 18),
    rpcUrl = "https://rpc.mainnet.chain.robinhood.com",
    blockExplorerUrl = "https://robinhoodchain.blockscout.com",
)

/**
 * [FlipperWallet] over Reown AppKit.
 *
 * Create ONE instance for the whole app, after `AppKit.initialize(...)`, and call [register] once: AppKit keeps
 * every delegate passed to `AppKit.setDelegate` for the life of the process (each call adds collectors), so don't
 * create one per screen. If your app already has a ModalDelegate, you can instead forward its callbacks to this
 * object's methods.
 *
 * Every request opens the user's wallet app for confirmation (AppKit deep-links to it after sending). Nothing is
 * auto-approved.
 */
class ReownAppKitWallet(
    private val scope: CoroutineScope = MainScope(),
) : FlipperWallet, AppKit.ModalDelegate {

    private val accountsState = MutableStateFlow<List<String>>(emptyList())
    private val chainState = MutableStateFlow<Long?>(null)

    override val accounts: StateFlow<List<String>> = accountsState.asStateFlow()
    override val chainId: StateFlow<Long?> = chainState.asStateFlow()

    private val lock = Any()
    private val pending = HashMap<Long, CompletableDeferred<JsonElement>>()
    private val earlyResponses = HashMap<Long, Modal.Model.JsonRpcResponse>()

    /** Registers as an AppKit delegate and reads the current session. Call once. */
    fun register() {
        AppKit.setDelegate(this)
        refresh()
    }

    /** Re-reads account and chain from AppKit (blocking calls, so on Dispatchers.IO). */
    fun refresh() {
        scope.launch {
            val account = withContext(Dispatchers.IO) { runCatching { AppKit.getAccount() }.getOrNull() }
            if (account == null) {
                accountsState.value = emptyList()
                chainState.value = null
            } else {
                accountsState.value = listOf(account.address)
                // account.chain.id is CAIP-2, e.g. "eip155:4663".
                chainState.value = FlipperChainId.parse(account.chain.id) ?: chainState.value
            }
        }
    }

    override suspend fun request(method: String, params: JsonElement): JsonElement {
        when (method) {
            // WalletConnect wallets don't answer these over the relay; the session already has the answer.
            "eth_accounts", "eth_requestAccounts" ->
                return JsonArray(accountsState.value.map { JsonPrimitive(it) })
            "eth_chainId" -> {
                val hex = FlipperChainId.toHex(chainState.value)
                    ?: throw FlipperRpcException(FlipperRpcException.DISCONNECTED, "Wallet is not connected.")
                return JsonPrimitive(hex)
            }
            "wallet_switchEthereumChain" -> {
                val target = FlipperChainId.parse(((params as? JsonArray)?.firstOrNull() as? JsonObject)?.get("chainId"))
                    ?: throw FlipperRpcException(FlipperRpcException.INVALID_PARAMS, "Invalid params")
                // WalletConnect sessions can span several chains: if the session already approved the target chain,
                // "switching" only changes which chain we address requests to.
                if (target in approvedChains()) {
                    chainState.value = target
                    return JsonNull
                }
                // Otherwise ask the wallet (it may answer 4902, which the widget follows with wallet_addEthereumChain).
                val result = send(method, params)
                chainState.value = target // UNVERIFIED: some wallets also emit chainChanged / a session update.
                refreshLater()
                return result
            }
        }
        return send(method, params)
    }

    private suspend fun send(method: String, params: JsonElement): JsonElement {
        val result = CompletableDeferred<JsonElement>()
        // Address the chain the widget sees (AppKit's own selected chain may lag behind a switch).
        val caip2 = chainState.value?.let { "eip155:$it" }
        withContext(Dispatchers.Main) {
            AppKit.request(
                request = Request(method = method, params = params.toString(), chainId = caip2),
                onSuccess = { sent: SentRequestResult ->
                    when (sent) {
                        is SentRequestResult.WalletConnect -> {
                            val early = synchronized(lock) {
                                earlyResponses.remove(sent.requestId).also { if (it == null) pending[sent.requestId] = result }
                            }
                            if (early != null) complete(result, early)
                        }
                        is SentRequestResult.Coinbase -> completeCoinbase(result, sent.results)
                    }
                },
                onError = { error: Throwable ->
                    result.completeExceptionally(
                        FlipperRpcException(FlipperRpcException.INTERNAL_ERROR, error.message ?: "Wallet request failed."),
                    )
                },
            )
        }
        return result.await()
    }

    // ---------------------------------------------------------------------------------------------------------------
    // AppKit.ModalDelegate

    override fun onSessionApproved(approvedSession: Modal.Model.ApprovedSession) = refresh()

    override fun onSessionRejected(rejectedSession: Modal.Model.RejectedSession) = Unit

    override fun onSessionUpdate(updatedSession: Modal.Model.UpdatedSession) = refresh()

    @Suppress("OVERRIDE_DEPRECATION")
    override fun onSessionEvent(sessionEvent: Modal.Model.SessionEvent) = Unit // the non-deprecated overload below

    override fun onSessionEvent(sessionEvent: Modal.Model.Event) {
        // accountsChanged / chainChanged. UNVERIFIED: whether AppKit.getAccount() reflects chainChanged immediately;
        // parse the event's chainId as well.
        if (sessionEvent.name == EthUtils.chainChanged) {
            FlipperChainId.parse(sessionEvent.chainId)?.let { chainState.value = it }
        }
        refreshLater()
    }

    override fun onSessionExtend(session: Modal.Model.Session) = refresh()

    override fun onSessionDelete(deletedSession: Modal.Model.DeletedSession) {
        accountsState.value = emptyList()
        chainState.value = null
        failAll(FlipperRpcException(FlipperRpcException.DISCONNECTED, "The wallet disconnected."))
    }

    override fun onSessionRequestResponse(response: Modal.Model.SessionRequestResponse) {
        val rpc = response.result
        val waiting = synchronized(lock) {
            pending.remove(rpc.id) ?: run {
                // Arrived before onSuccess registered the request id.
                earlyResponses[rpc.id] = rpc
                null
            }
        }
        if (waiting != null) complete(waiting, rpc)
    }

    override fun onProposalExpired(proposal: Modal.Model.ExpiredProposal) = Unit

    override fun onRequestExpired(request: Modal.Model.ExpiredRequest) {
        val waiting = synchronized(lock) { pending.remove(request.id) }
        waiting?.completeExceptionally(FlipperRpcException(FlipperRpcException.USER_REJECTED, "The wallet request expired."))
    }

    override fun onConnectionStateChange(state: Modal.Model.ConnectionState) = Unit

    override fun onError(error: Modal.Model.Error) = Unit

    // ---------------------------------------------------------------------------------------------------------------

    private fun refreshLater() {
        scope.launch {
            kotlinx.coroutines.delay(300)
            refresh()
        }
    }

    /** Chain ids the WalletConnect session approved (from CAIP-10 accounts "eip155:4663:0x..."). */
    private suspend fun approvedChains(): Set<Long> = withContext(Dispatchers.IO) {
        when (val session = runCatching { AppKit.getSession() }.getOrNull()) {
            is Session.WalletConnectSession -> session.namespaces.values
                .flatMap { ns -> ns.accounts.map { it.substringBeforeLast(':') } + ns.chains.orEmpty() }
                .mapNotNull { FlipperChainId.parse(it) }
                .toSet()
            is Session.CoinbaseSession -> setOfNotNull(FlipperChainId.parse(session.chain))
            null -> emptySet()
        }
    }

    private fun complete(target: CompletableDeferred<JsonElement>, response: Modal.Model.JsonRpcResponse) {
        when (response) {
            is Modal.Model.JsonRpcResponse.JsonRpcResult -> target.complete(toJson(response.result))
            is Modal.Model.JsonRpcResponse.JsonRpcError ->
                // Codes pass through unchanged: 4001 user rejected, 4902 unknown chain, ...
                target.completeExceptionally(FlipperRpcException(response.code, response.message))
        }
    }

    private fun completeCoinbase(target: CompletableDeferred<JsonElement>, results: List<CoinbaseResult>) {
        when (val first = results.firstOrNull()) {
            is CoinbaseResult.Result -> target.complete(toJson(first.value))
            is CoinbaseResult.Error -> target.completeExceptionally(FlipperRpcException(first.code.toInt(), first.message))
            null -> target.complete(JsonNull)
        }
    }

    private fun failAll(error: FlipperRpcException) {
        val all = synchronized(lock) {
            val copy = pending.values.toList()
            pending.clear()
            earlyResponses.clear()
            copy
        }
        all.forEach { it.completeExceptionally(error) }
    }

    /**
     * Wallet results arrive as Any? (usually a String). A bare string (tx hash, signature) stays a string; JSON text
     * (object, array, null, boolean, quoted string) is parsed. UNVERIFIED: exact result types per wallet.
     */
    private fun toJson(value: Any?): JsonElement = when (value) {
        null -> JsonNull
        is JsonElement -> value
        is Boolean -> JsonPrimitive(value)
        is Number -> JsonPrimitive(value)
        is String -> parseResultString(value)
        else -> JsonPrimitive(value.toString())
    }

    private fun parseResultString(s: String): JsonElement {
        val t = s.trim()
        when {
            t == "null" -> return JsonNull
            t == "true" || t == "false" -> return JsonPrimitive(t == "true")
            t.startsWith("{") || t.startsWith("[") || t.startsWith("\"") ->
                runCatching { return Json.parseToJsonElement(t) }
        }
        return JsonPrimitive(s)
    }
}

/*
Wiring (Application.onCreate), per the Reown AppKit Android docs and sample app:

    CoreClient.initialize(
        projectId = BuildConfig.REOWN_PROJECT_ID,
        connectionType = ConnectionType.AUTOMATIC,
        application = this,
        metaData = Core.Model.AppMetaData(
            name = "My App", description = "...", url = "https://example.com",
            icons = listOf("https://example.com/icon.png"), redirect = "myapp-wc://request",
        ),
    ) { error -> Log.e("AppKit", "core", error.throwable) }

    AppKit.initialize(Modal.Params.Init(core = CoreClient)) { error -> Log.e("AppKit", "init", error.throwable) }
    AppKit.setChains(listOf(RobinhoodChain))    // add 31337 as a custom chain too for the local fork
    wallet = ReownAppKitWallet().also { it.register() }

Compose screen:

    var showAppKit by remember { mutableStateOf(false) }
    FlipperWidget(
        wallet = app.wallet,
        onConnectRequest = { showAppKit = true },
    )
    if (showAppKit) {
        ModalBottomSheet(onDismissRequest = { showAppKit = false }) {
            // com.reown.appkit.ui.components.internal.AppKitComponent (public despite the package name)
            AppKitComponent(shouldOpenChooseNetwork = false, closeModal = { showAppKit = false })
        }
    }

Navigation-compose apps can instead add `appKitGraph(navController)` (or `appKit()`) to the NavHost and call
`navController.openAppKit(shouldOpenChooseNetwork = false) { error -> ... }` from onConnectRequest.
*/
