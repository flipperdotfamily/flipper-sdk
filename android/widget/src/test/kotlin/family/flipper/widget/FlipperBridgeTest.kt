package family.flipper.widget

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class FlipperBridgeTest {

    private val origin = "https://flipper.family"

    /** Records every callback. */
    private class Recorder : FlipperWidgetListener {
        val events = mutableListOf<FlipperEvent>()
        val calls = mutableListOf<String>()
        val connectRequests = mutableListOf<String?>()
        val resizes = mutableListOf<Int>()
        val settled = mutableListOf<FlipperEvent.FlipSettled>()
        val resolved = mutableListOf<FlipperEvent.PayoutResolved>()

        override fun onEvent(event: FlipperEvent) {
            events += event
            calls += "event:" + event.name
        }

        override fun onReady(event: FlipperEvent.Ready) {
            calls += "ready"
        }

        override fun onConnectRequest(reason: String?) {
            connectRequests += reason
            calls += "connect"
        }

        override fun onFlipSettled(event: FlipperEvent.FlipSettled) {
            settled += event
        }

        override fun onPayoutResolved(event: FlipperEvent.PayoutResolved) {
            resolved += event
        }

        override fun onResize(heightDp: Int) {
            resizes += heightDp
        }
    }

    /** A wallet whose requests are answered by [handler]; state set through [update]. */
    private class FakeWallet(
        accounts: List<String> = listOf("0xAbC0000000000000000000000000000000000001"),
        chainId: Long? = 4663L,
        val handler: suspend (String, JsonElement) -> JsonElement = { _, _ -> JsonPrimitive("0xhash") },
    ) : MutableFlipperWallet(accounts, chainId) {
        val requests = mutableListOf<Pair<String, JsonElement>>()

        override suspend fun request(method: String, params: JsonElement): JsonElement {
            requests += method to params
            return handler(method, params)
        }
    }

    private class Harness(
        val bridge: FlipperBridge,
        val scripts: MutableList<String>,
        val recorder: Recorder,
    ) {
        /** Messages delivered to the page, decoded from the evaluated scripts. */
        val sent: List<JsonObject> get() = scripts.map { decodeScript(it) }

        fun send(json: String, from: String? = "https://flipper.family", mainFrame: Boolean = true) {
            bridge.onMessage(json, from, mainFrame)
        }

        fun ready() = send("""{"v":1,"source":"flipper","type":"event","name":"ready","data":{"version":"0.1.0"}}""")
    }

    private fun TestScope.harness(
        allowedMethods: Set<String>? = null,
        maxHeight: Int? = null,
        chainId: Long = 4663L,
    ): Harness {
        val scripts = mutableListOf<String>()
        val recorder = Recorder()
        val bridge = FlipperBridge(
            scope = backgroundScope,
            evaluateJavascript = { scripts += it },
            listener = recorder,
            embedOrigin = origin,
            chainId = chainId,
            allowedMethods = allowedMethods,
            minHeight = 120,
            maxHeight = maxHeight,
        )
        bridge.onPageStarted()
        return Harness(bridge, scripts, recorder)
    }

    private fun rpc(id: String, method: String, params: String? = "[]"): String {
        val p = if (params == null) "" else ""","params":$params"""
        return """{"v":1,"source":"flipper","type":"rpc","id":$id,"method":"$method"$p}"""
    }

    // -----------------------------------------------------------------------------------------------------------
    // Filtering

    @Test
    fun dropsMessagesWithWrongSourceVersionTypeOrShape() = runTest {
        val h = harness()
        h.ready()
        h.scripts.clear()
        h.recorder.events.clear()
        h.send("""{"v":1,"source":"flipper-host","type":"event","name":"ready"}""")
        h.send("""{"v":2,"source":"flipper","type":"event","name":"ready"}""")
        h.send("""{"v":"1","source":"flipper","type":"event","name":"ready"}""")
        h.send("""{"source":"flipper","type":"event","name":"ready"}""")
        h.send("""{"v":1,"source":"flipper","type":"nope","name":"ready"}""")
        h.send("""{"v":1,"source":"flipper","type":"event","name":42}""")
        h.send("""[1,2,3]""")
        h.send("""not json""")
        h.send(rpc("\"a\"", "eth_accounts").replace("\"v\":1", "\"v\":1.5"))
        runCurrent()
        assertTrue(h.recorder.events.isEmpty())
        assertTrue(h.scripts.isEmpty())
    }

    @Test
    fun acceptsVersionOneWrittenAsFloat() = runTest {
        val h = harness()
        h.send("""{"v":1.0,"source":"flipper","type":"event","name":"flip-requested","data":{}}""")
        assertEquals(listOf("event:flip-requested"), h.recorder.calls)
    }

    @Test
    fun dropsMessagesFromOtherOriginsAndSubFrames() = runTest {
        val h = harness()
        h.send("""{"v":1,"source":"flipper","type":"event","name":"ready"}""", from = "https://evil.example")
        h.send("""{"v":1,"source":"flipper","type":"event","name":"ready"}""", from = "http://flipper.family")
        h.send("""{"v":1,"source":"flipper","type":"event","name":"ready"}""", from = "https://flipper.family:8443")
        h.send("""{"v":1,"source":"flipper","type":"event","name":"ready"}""", from = null)
        h.send("""{"v":1,"source":"flipper","type":"event","name":"ready"}""", from = "null")
        h.send("""{"v":1,"source":"flipper","type":"event","name":"ready"}""", mainFrame = false)
        assertTrue(h.recorder.events.isEmpty())
        assertFalse(h.bridge.isReady)

        // Same origin written differently (default port, trailing path, upper case) is accepted.
        h.send("""{"v":1,"source":"flipper","type":"event","name":"ready"}""", from = "HTTPS://Flipper.Family:443/embed?x=1")
        assertTrue(h.bridge.isReady)
    }

    @Test
    fun dropsOversizedMessages() = runTest {
        val h = harness()
        val padding = "x".repeat(FlipperBridge.MAX_MESSAGE_LENGTH)
        h.send("""{"v":1,"source":"flipper","type":"event","name":"ready","data":{"pad":"$padding"}}""")
        assertTrue(h.recorder.events.isEmpty())
    }

    @Test
    fun emptyEmbedOriginDropsEverything() = runTest {
        val h = harness()
        h.bridge.embedOrigin = ""
        h.ready()
        assertTrue(h.recorder.events.isEmpty())
    }

    // -----------------------------------------------------------------------------------------------------------
    // RPC

    @Test
    fun rejectsMethodsOutsideTheAllowlist() = runTest {
        val h = harness()
        h.ready()
        h.bridge.wallet = FakeWallet()
        runCurrent()
        h.scripts.clear()
        h.send(rpc("\"a\"", "eth_sign"))
        h.send(rpc("\"b\"", "ETH_SENDTRANSACTION"))
        val errors = h.sent.map { it["error"]!!.jsonObject }
        assertEquals(listOf(4200, 4200), errors.map { it["code"]!!.jsonPrimitive.int })
        assertEquals("Unsupported method: eth_sign", errors[0]["message"]!!.jsonPrimitive.content)
    }

    @Test
    fun rejectsMessageSigningLikeEthSignEvenWhenListed() = runTest {
        val signing = setOf("eth_sign", "personal_sign", "eth_signTypedData_v4")
        assertEquals(7, FlipperBridge.ALLOWED_METHODS.size)
        assertTrue(FlipperBridge.BRIDGE_METHODS.none { it in signing })
        assertTrue(FlipperBridge.computeAllowlist(true, signing).isEmpty())

        val h = harness(allowedMethods = signing)
        h.ready()
        val wallet = FakeWallet()
        h.bridge.wallet = wallet
        h.bridge.enableBatchCalls = true
        runCurrent()
        h.scripts.clear()
        h.send(rpc("\"1\"", "eth_sign", """["0x01","0x00"]"""))
        h.send(rpc("\"2\"", "personal_sign", """["0x00","0x01"]"""))
        h.send(rpc("\"3\"", "eth_signTypedData_v4", """["0x01","{}"]"""))
        runCurrent()
        val errors = h.sent.map { it["error"]!!.jsonObject }
        assertEquals(List(3) { 4200 }, errors.map { it["code"]!!.jsonPrimitive.int })
        assertEquals(
            listOf("eth_sign", "personal_sign", "eth_signTypedData_v4").map { "Unsupported method: $it" },
            errors.map { it["message"]!!.jsonPrimitive.content },
        )
        assertTrue(wallet.requests.isEmpty())
    }

    @Test
    fun allowedMethodsNarrowButNeverWiden() = runTest {
        val h = harness(allowedMethods = setOf("eth_accounts", "eth_sign"))
        h.ready()
        val wallet = FakeWallet()
        h.bridge.wallet = wallet
        runCurrent()
        h.scripts.clear()
        h.send(rpc("\"1\"", "eth_sendTransaction", """[{"to":"0x1"}]"""))
        h.send(rpc("\"2\"", "eth_sign"))
        h.send(rpc("\"3\"", "eth_accounts"))
        runCurrent()
        val byId = h.sent.associateBy { it["id"]!!.jsonPrimitive.content }
        assertEquals(4200, byId["1"]!!["error"]!!.jsonObject["code"]!!.jsonPrimitive.int)
        assertEquals(4200, byId["2"]!!["error"]!!.jsonObject["code"]!!.jsonPrimitive.int)
        assertEquals("rpc-result", byId["3"]!!["type"]!!.jsonPrimitive.content)
        assertEquals(listOf("eth_accounts"), wallet.requests.map { it.first })
    }

    @Test
    fun batchCallMethodsAreOptIn() = runTest {
        val h = harness()
        h.ready()
        val wallet = FakeWallet(handler = { method, _ ->
            if (method == "wallet_sendCalls") buildJsonObject { put("id", "0xbatch") } else JsonPrimitive("ok")
        })
        h.bridge.wallet = wallet
        runCurrent()
        h.scripts.clear()

        // default: 4200, the wallet never sees them
        FlipperBridge.BATCH_CALL_METHODS.forEachIndexed { i, m -> h.send(rpc("\"off$i\"", m, "[{}]")) }
        runCurrent()
        assertEquals(List(3) { 4200 }, h.sent.map { it["error"]!!.jsonObject["code"]!!.jsonPrimitive.int })
        assertTrue(wallet.requests.isEmpty())
        h.scripts.clear()

        // enabled: all 10 embed methods are forwarded, nothing beyond them
        h.bridge.enableBatchCalls = true
        FlipperBridge.BRIDGE_METHODS.forEachIndexed { i, m -> h.send(rpc("\"on$i\"", m, "[{}]")) }
        h.send(rpc("\"sign\"", "eth_sign"))
        runCurrent()
        val byId = h.sent.associateBy { it["id"]!!.jsonPrimitive.content }
        FlipperBridge.BRIDGE_METHODS.indices.forEach { i -> assertEquals("rpc-result", byId["on$i"]!!["type"]!!.jsonPrimitive.content) }
        val sendCalls = FlipperBridge.BRIDGE_METHODS.indexOf("wallet_sendCalls")
        assertEquals("0xbatch", byId["on$sendCalls"]!!["result"]!!.jsonObject["id"]!!.jsonPrimitive.content)
        assertEquals(4200, byId["sign"]!!["error"]!!.jsonObject["code"]!!.jsonPrimitive.int)
        assertEquals(10, wallet.requests.size)
        assertEquals(10, FlipperBridge.BRIDGE_METHODS.size)
    }

    @Test
    fun allowedMethodsNarrowBatchCallsAndCannotAddThemWithoutTheFlag() = runTest {
        assertEquals(
            setOf("wallet_sendCalls"),
            FlipperBridge.computeAllowlist(true, setOf("eth_sign", "wallet_sendCalls")),
        )
        assertEquals(setOf("eth_accounts"), FlipperBridge.computeAllowlist(false, setOf("eth_accounts", "wallet_sendCalls")))
        assertEquals(FlipperBridge.ALLOWED_METHODS, FlipperBridge.computeAllowlist(false, null))

        val h = harness(allowedMethods = setOf("eth_sendTransaction", "wallet_getCapabilities"))
        h.ready()
        val wallet = FakeWallet()
        h.bridge.wallet = wallet
        runCurrent()
        h.scripts.clear()
        h.send(rpc("\"1\"", "wallet_getCapabilities", "[]"))
        runCurrent()
        h.bridge.enableBatchCalls = true
        h.send(rpc("\"2\"", "wallet_getCapabilities", "[]"))
        h.send(rpc("\"3\"", "wallet_sendCalls", "[{}]"))
        runCurrent()
        val byId = h.sent.associateBy { it["id"]!!.jsonPrimitive.content }
        assertEquals(4200, byId["1"]!!["error"]!!.jsonObject["code"]!!.jsonPrimitive.int)
        assertEquals("rpc-result", byId["2"]!!["type"]!!.jsonPrimitive.content)
        assertEquals(4200, byId["3"]!!["error"]!!.jsonObject["code"]!!.jsonPrimitive.int)
        assertEquals(listOf("wallet_getCapabilities"), wallet.requests.map { it.first })
    }

    @Test
    fun repliesKeepTheIdAndItsJsonType() = runTest {
        val h = harness()
        h.ready()
        h.bridge.wallet = FakeWallet()
        runCurrent()
        h.scripts.clear()
        h.send(rpc("\"f7\"", "eth_sendTransaction", """[{"to":"0x1"}]"""))
        h.send(rpc("7", "eth_sendTransaction", """[{"to":"0x1"}]"""))
        h.send(rpc("\"7\"", "eth_sendTransaction", """[{"to":"0x1"}]"""))
        runCurrent()
        val ids = h.sent.map { it["id"] as JsonPrimitive }
        assertEquals(3, ids.size)
        assertTrue(ids[0].isString && ids[0].content == "f7")
        assertTrue(!ids[1].isString && ids[1].content == "7")
        assertTrue(ids[2].isString && ids[2].content == "7")
        h.sent.forEach {
            assertEquals("rpc-result", it["type"]!!.jsonPrimitive.content)
            assertEquals("0xhash", it["result"]!!.jsonPrimitive.content)
            assertEquals("flipper-host", it["source"]!!.jsonPrimitive.content)
            assertEquals(1, it["v"]!!.jsonPrimitive.int)
        }
    }

    @Test
    fun dropsRpcWithUnusableIds() = runTest {
        val h = harness()
        h.ready()
        h.scripts.clear()
        h.send(rpc("null", "eth_accounts"))
        h.send(rpc("true", "eth_accounts"))
        h.send(rpc("{}", "eth_accounts"))
        h.send(rpc("[1]", "eth_accounts"))
        h.send("""{"v":1,"source":"flipper","type":"rpc","method":"eth_accounts","params":[]}""")
        runCurrent()
        assertTrue(h.scripts.isEmpty())
    }

    @Test
    fun invalidMethodAndParams() = runTest {
        val h = harness()
        h.ready()
        h.bridge.wallet = FakeWallet()
        runCurrent()
        h.scripts.clear()
        h.send("""{"v":1,"source":"flipper","type":"rpc","id":"m","method":5,"params":[]}""")
        h.send(rpc("\"p\"", "eth_sendTransaction", "\"oops\""))
        h.send(rpc("\"q\"", "eth_sendTransaction", "42"))
        runCurrent()
        val codes = h.sent.associate { it["id"]!!.jsonPrimitive.content to it["error"]!!.jsonObject["code"]!!.jsonPrimitive.int }
        assertEquals(-32600, codes["m"])
        assertEquals(-32602, codes["p"])
        assertEquals(-32602, codes["q"])
        assertEquals("Invalid params", h.sent[1]["error"]!!.jsonObject["message"]!!.jsonPrimitive.content)
    }

    @Test
    fun missingOrNullParamsBecomeAnEmptyArrayAndObjectsPassThrough() = runTest {
        val h = harness()
        h.ready()
        val wallet = FakeWallet()
        h.bridge.wallet = wallet
        runCurrent()
        h.send(rpc("\"a\"", "eth_chainId", params = null))
        h.send(rpc("\"b\"", "eth_chainId", params = "null"))
        h.send(rpc("\"c\"", "wallet_watchAsset", params = """{"type":"ERC20"}"""))
        runCurrent()
        assertEquals(JsonArray(emptyList()), wallet.requests[0].second)
        assertEquals(JsonArray(emptyList()), wallet.requests[1].second)
        assertTrue(wallet.requests[2].second is JsonObject)
    }

    @Test
    fun duplicateInFlightIdIsRejectedUntilTheFirstCompletes() = runTest {
        val h = harness()
        h.ready()
        val gate = CompletableDeferred<JsonElement>()
        val wallet = FakeWallet(handler = { _, _ -> gate.await() })
        h.bridge.wallet = wallet
        runCurrent()
        h.scripts.clear()
        h.send(rpc("\"dup\"", "eth_sendTransaction", """[{"to":"0x1"}]"""))
        runCurrent()
        h.send(rpc("\"dup\"", "eth_sendTransaction", """[{"to":"0x1"}]"""))
        runCurrent()
        assertEquals(1, h.sent.size)
        assertEquals(-32600, h.sent[0]["error"]!!.jsonObject["code"]!!.jsonPrimitive.int)
        assertEquals("Duplicate request id", h.sent[0]["error"]!!.jsonObject["message"]!!.jsonPrimitive.content)
        assertEquals(1, wallet.requests.size)

        gate.complete(JsonPrimitive("0xdone"))
        runCurrent()
        assertEquals(2, h.sent.size)
        assertEquals("0xdone", h.sent[1]["result"]!!.jsonPrimitive.content)

        // Finished ids can be reused.
        h.send(rpc("\"dup\"", "eth_sendTransaction", """[{"to":"0x1"}]"""))
        runCurrent()
        assertEquals("rpc-result", h.sent.last()["type"]!!.jsonPrimitive.content)
    }

    @Test
    fun walletErrorsAreMapped() = runTest {
        val h = harness()
        h.ready()
        val data = buildJsonObject { put("reason", "user closed") }
        val wallet = FakeWallet(handler = { method, _ ->
            when (method) {
                "eth_sendTransaction" -> throw FlipperRpcException(4001, "User rejected the request.", data)
                "wallet_switchEthereumChain" -> throw FlipperRpcException.unrecognizedChain()
                "wallet_watchAsset" -> throw IllegalStateException("boom")
                "eth_requestAccounts" -> throw RuntimeException()
                else -> JsonNull
            }
        })
        h.bridge.wallet = wallet
        runCurrent()
        h.scripts.clear()
        h.send(rpc("\"1\"", "eth_sendTransaction", """[{"to":"0x1"}]"""))
        h.send(rpc("\"2\"", "wallet_switchEthereumChain", """[{"chainId":"0x1237"}]"""))
        h.send(rpc("\"3\"", "wallet_watchAsset", """{"type":"ERC20","options":{"address":"0x09","symbol":"FLIPPER","decimals":18}}"""))
        h.send(rpc("\"4\"", "eth_requestAccounts", "[]"))
        h.send(rpc("\"5\"", "wallet_addEthereumChain", """[{}]"""))
        runCurrent()
        val byId = h.sent.associateBy { it["id"]!!.jsonPrimitive.content }
        val e1 = byId["1"]!!["error"]!!.jsonObject
        assertEquals(4001, e1["code"]!!.jsonPrimitive.int)
        assertEquals("User rejected the request.", e1["message"]!!.jsonPrimitive.content)
        assertEquals(data, e1["data"])
        assertEquals(4902, byId["2"]!!["error"]!!.jsonObject["code"]!!.jsonPrimitive.int)
        val e3 = byId["3"]!!["error"]!!.jsonObject
        assertEquals(-32603, e3["code"]!!.jsonPrimitive.int)
        assertEquals("boom", e3["message"]!!.jsonPrimitive.content)
        assertNull(e3["data"])
        val e4 = byId["4"]!!["error"]!!.jsonObject
        assertEquals(-32603, e4["code"]!!.jsonPrimitive.int)
        assertEquals("Internal error", e4["message"]!!.jsonPrimitive.content)
        assertEquals("rpc-result", byId["5"]!!["type"]!!.jsonPrimitive.content)
        assertEquals(JsonNull, byId["5"]!!["result"])
    }

    @Test
    fun noWalletBehaviour() = runTest {
        val h = harness()
        h.ready()
        h.scripts.clear()
        h.send(rpc("\"a\"", "eth_accounts"))
        h.send(rpc("\"c\"", "eth_chainId"))
        h.send(rpc("\"r\"", "eth_requestAccounts"))
        h.send(rpc("\"s\"", "eth_sendTransaction", """[{"to":"0x1"}]"""))
        runCurrent()
        val byId = h.sent.associateBy { it["id"]!!.jsonPrimitive.content }
        assertEquals(JsonArray(emptyList()), byId["a"]!!["result"])
        assertEquals("0x1237", byId["c"]!!["result"]!!.jsonPrimitive.content)
        val r = byId["r"]!!["error"]!!.jsonObject
        assertEquals(4100, r["code"]!!.jsonPrimitive.int)
        assertEquals("No wallet connected. The host app was asked to connect one.", r["message"]!!.jsonPrimitive.content)
        assertEquals(listOf<String?>(null), h.recorder.connectRequests)
        val s = byId["s"]!!["error"]!!.jsonObject
        assertEquals(4100, s["code"]!!.jsonPrimitive.int)
        assertEquals("No wallet connected.", s["message"]!!.jsonPrimitive.content)
    }

    @Test
    fun walletWithoutAccountsCountsAsNotConnected() = runTest {
        val h = harness(chainId = 31337L)
        h.ready()
        val wallet = FakeWallet(accounts = emptyList(), chainId = null)
        h.bridge.wallet = wallet
        runCurrent()
        h.scripts.clear()
        h.send(rpc("\"c\"", "eth_chainId"))
        h.send(rpc("\"s\"", "eth_sendTransaction", """[{"to":"0x1"}]"""))
        runCurrent()
        assertEquals("0x7a69", h.sent[0]["result"]!!.jsonPrimitive.content)
        assertEquals(4100, h.sent[1]["error"]!!.jsonObject["code"]!!.jsonPrimitive.int)
        assertTrue(wallet.requests.isEmpty())
    }

    @Test
    fun repliesFromAPreviousPageAreDiscarded() = runTest {
        val h = harness()
        h.ready()
        val gate = CompletableDeferred<JsonElement>()
        h.bridge.wallet = FakeWallet(handler = { _, _ -> gate.await() })
        runCurrent()
        h.send(rpc("\"old\"", "eth_sendTransaction", """[{"to":"0x1"}]"""))
        runCurrent()
        h.bridge.onPageStarted()
        h.ready()
        h.scripts.clear()
        gate.complete(JsonPrimitive("0xlate"))
        runCurrent()
        assertTrue(h.sent.none { it["type"]!!.jsonPrimitive.content == "rpc-result" })
    }

    // -----------------------------------------------------------------------------------------------------------
    // Ready queue, wallet state, config

    @Test
    fun queuesUntilReadyThenFlushesAndSendsWalletState() = runTest {
        val h = harness()
        val wallet = FakeWallet()
        h.bridge.wallet = wallet
        runCurrent()
        h.bridge.sendConfig(buildJsonObject { put("theme", "dark") })
        h.bridge.sendConfig(buildJsonObject { put("accent", "#7C5CFF") })
        h.bridge.sendConfig(buildJsonObject { put("theme", "light") })
        wallet.update(chainId = 1L)
        runCurrent()
        wallet.update(chainId = 4663L)
        runCurrent()
        h.send(rpc("\"early\"", "eth_accounts"))
        runCurrent()
        // The embed reads eth_accounts when it mounts, before `ready`: RPC answers are never held back.
        assertEquals(listOf("rpc-result"), h.sent.map { it["type"]!!.jsonPrimitive.content })

        h.ready()
        val types = h.sent.map { it["type"]!!.jsonPrimitive.content }
        assertEquals(listOf("rpc-result", "config", "wallet"), types)
        val config = h.sent[1]
        assertEquals("light", config["theme"]!!.jsonPrimitive.content)
        assertEquals("#7C5CFF", config["accent"]!!.jsonPrimitive.content)
        val walletMsg = h.sent[2]
        assertEquals("0x1237", walletMsg["chainId"]!!.jsonPrimitive.content)
        assertEquals(
            listOf("0xAbC0000000000000000000000000000000000001"),
            walletMsg["accounts"]!!.jsonArray.map { it.jsonPrimitive.content },
        )
        assertEquals(listOf("event:ready", "ready"), h.recorder.calls)
    }

    @Test
    fun rpcRepliesAreNeverQueued() = runTest {
        val h = harness()
        repeat(FlipperBridge.QUEUE_LIMIT + 5) { i -> h.send(rpc("\"$i\"", "eth_accounts")) }
        runCurrent()
        val replies = h.sent.filter { it["type"]!!.jsonPrimitive.content == "rpc-result" }
        assertEquals(FlipperBridge.QUEUE_LIMIT + 5, replies.size)
        assertEquals("0", replies.first()["id"]!!.jsonPrimitive.content)
        h.ready()
        // The wallet state goes out on ready.
        assertEquals("wallet", h.sent.last()["type"]!!.jsonPrimitive.content)
    }

    @Test
    fun walletStateIsPushedOnChangeAndSkippedWhenIdentical() = runTest {
        val h = harness()
        h.ready()
        assertEquals(1, h.sent.size)
        assertEquals(JsonArray(emptyList()), h.sent[0]["accounts"])
        assertEquals("0x1237", h.sent[0]["chainId"]!!.jsonPrimitive.content)

        val wallet = FakeWallet(accounts = listOf("0x1"), chainId = 4663L)
        h.bridge.wallet = wallet
        runCurrent()
        assertEquals(2, h.sent.size)
        wallet.update(accounts = listOf("0x1"), chainId = 4663L)
        runCurrent()
        assertEquals(2, h.sent.size)
        wallet.update(chainId = 1L)
        runCurrent()
        assertEquals("0x1", h.sent.last()["chainId"]!!.jsonPrimitive.content)
        wallet.update(chainId = null)
        runCurrent()
        assertEquals("unknown chain falls back to the configured one", "0x1237", h.sent.last()["chainId"]!!.jsonPrimitive.content)

        val other = FakeWallet(accounts = listOf("0x2", "0x3"), chainId = 31337L)
        h.bridge.wallet = other
        runCurrent()
        assertEquals(listOf("0x2", "0x3"), h.sent.last()["accounts"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertEquals("0x7a69", h.sent.last()["chainId"]!!.jsonPrimitive.content)

        // The old wallet no longer drives the state.
        val before = h.sent.size
        wallet.update(accounts = listOf("0x9"))
        runCurrent()
        assertEquals(before, h.sent.size)

        h.bridge.wallet = null
        runCurrent()
        assertEquals(JsonArray(emptyList()), h.sent.last()["accounts"])
        assertEquals("0x1237", h.sent.last()["chainId"]!!.jsonPrimitive.content)
    }

    @Test
    fun newPageResetsReadyAndResendsWalletOnNextReady() = runTest {
        val h = harness()
        h.bridge.wallet = FakeWallet(accounts = listOf("0x1"))
        runCurrent()
        h.ready()
        assertTrue(h.bridge.isReady)
        h.bridge.onPageStarted()
        assertFalse(h.bridge.isReady)
        h.scripts.clear()
        h.bridge.sendConfig(buildJsonObject { put("locale", "es") })
        assertTrue(h.scripts.isEmpty())
        h.ready()
        assertEquals(listOf("config", "wallet"), h.sent.map { it["type"]!!.jsonPrimitive.content })
    }

    @Test
    fun hostConfigIsSentAfterEveryReadyUnderLiveChanges() = runTest {
        val h = harness()
        h.bridge.hostConfig = buildJsonObject {
            put("rpcUrl", "https://rpc.example")
            put("apiUrl", "https://api.example")
            put("type", "wallet") // reserved: dropped
        }
        h.ready()
        assertEquals(listOf("config", "wallet"), h.sent.map { it["type"]!!.jsonPrimitive.content })
        assertEquals("https://rpc.example", h.sent[0]["rpcUrl"]!!.jsonPrimitive.content)
        assertEquals("https://api.example", h.sent[0]["apiUrl"]!!.jsonPrimitive.content)

        // a reload: sent again, merged under the live change queued before `ready` (one message, newest value wins)
        h.bridge.onPageStarted()
        h.scripts.clear()
        h.bridge.sendConfig(buildJsonObject {
            put("rpcUrl", "https://rpc2.example")
            put("theme", "dark")
        })
        h.ready()
        assertEquals(listOf("config", "wallet"), h.sent.map { it["type"]!!.jsonPrimitive.content })
        val config = h.sent[0]
        assertEquals("config", config["type"]!!.jsonPrimitive.content)
        assertEquals("https://rpc2.example", config["rpcUrl"]!!.jsonPrimitive.content)
        assertEquals("https://api.example", config["apiUrl"]!!.jsonPrimitive.content)
        assertEquals("dark", config["theme"]!!.jsonPrimitive.content)

        // none set: nothing extra goes out
        h.bridge.hostConfig = JsonObject(emptyMap())
        h.bridge.onPageStarted()
        h.scripts.clear()
        h.ready()
        assertEquals(listOf("wallet"), h.sent.map { it["type"]!!.jsonPrimitive.content })
    }

    @Test
    fun configCannotOverrideTheEnvelope() = runTest {
        val h = harness()
        h.ready()
        h.scripts.clear()
        h.bridge.sendConfig(buildJsonObject {
            put("type", "wallet")
            put("source", "x")
            put("v", 9)
            put("brandName", "Acme")
        })
        val msg = h.sent.single()
        assertEquals("config", msg["type"]!!.jsonPrimitive.content)
        assertEquals("flipper-host", msg["source"]!!.jsonPrimitive.content)
        assertEquals(1, msg["v"]!!.jsonPrimitive.int)
        assertEquals("Acme", msg["brandName"]!!.jsonPrimitive.content)
    }

    // -----------------------------------------------------------------------------------------------------------
    // Events

    @Test
    fun resizeIsClampedAndOnlyValidHeightsCount() = runTest {
        val h = harness(maxHeight = 400)
        fun resize(data: String) = h.send("""{"v":1,"source":"flipper","type":"event","name":"resize","data":$data}""")
        resize("""{"width":360,"height":50}""")
        resize("""{"width":360,"height":300.2}""")
        resize("""{"width":360,"height":1000}""")
        resize("""{"height":"300"}""")
        resize("""{"height":-5}""")
        resize("""{"height":0}""")
        resize("""{}""")
        resize("""null""")
        assertEquals(listOf(120, 301, 400), h.recorder.resizes)
        assertEquals(8, h.recorder.events.size) // onEvent is always called
        assertEquals(360.0, (h.recorder.events[0] as FlipperEvent.Resize).width)
    }

    @Test
    fun clampHeightHelper() {
        assertEquals(120, FlipperBridge.clampHeight(1.0, 120, null))
        assertEquals(561, FlipperBridge.clampHeight(560.01, 120, null))
        assertEquals(800, FlipperBridge.clampHeight(1234.0, 120, 800))
        assertEquals(Int.MAX_VALUE, FlipperBridge.clampHeight(1e300, 120, null))
    }

    @Test
    fun typedEventsAreParsedLeniently() = runTest {
        val h = harness()
        h.send(
            """{"v":1,"source":"flipper","type":"event","name":"flip-settled","data":{"flipId":"12","outcome":"won",""" +
                """"status":"WinPending","won":true,"pending":true,"decimals":18,"amount":"1000","payout":"2000",""" +
                """"native":false,"partner":"acme","future":"x"}}""",
        )
        val e = h.recorder.settled.single()
        assertEquals("12", e.flipId)
        assertEquals("won", e.outcome)
        assertEquals("WinPending", e.status)
        assertEquals(true, e.pending)
        assertEquals(18, e.decimals)
        assertEquals(false, e.native)
        assertEquals("acme", e.partner)
        assertEquals("x", e.data.jsonObject["future"]!!.jsonPrimitive.content)

        h.send(
            """{"v":1,"source":"flipper","type":"event","name":"payout-resolved","data":{"flipId":"12","decimals":18,""" +
                """"tokenPaid":"1000","flipperPaid":"0","by":"other","native":true,"txHash":null,"partner":"acme"}}""",
        )
        val r = h.recorder.resolved.single()
        assertEquals(FlipperEvent.PAYOUT_RESOLVED, r.name)
        assertEquals("12", r.flipId)
        assertEquals(18, r.decimals)
        assertEquals("1000", r.tokenPaid)
        assertEquals("0", r.flipperPaid)
        assertEquals("other", r.by)
        assertEquals(true, r.native)
        assertNull(r.txHash)
        assertEquals("acme", r.partner)

        h.send("""{"v":1,"source":"flipper","type":"event","name":"connect-request","data":{"reason":"flip"}}""")
        assertEquals(listOf<String?>("flip"), h.recorder.connectRequests)

        h.send("""{"v":1,"source":"flipper","type":"event","name":"something-new","data":[1]}""")
        val unknown = h.recorder.events.last() as FlipperEvent.Unknown
        assertEquals("something-new", unknown.name)
        assertEquals(JsonArray(listOf(JsonPrimitive(1))), unknown.data)

        h.send("""{"v":1,"source":"flipper","type":"event","name":"error"}""")
        val error = h.recorder.events.last() as FlipperEvent.Error
        assertNull(error.code)
        assertEquals(JsonNull, error.data)
    }

    // -----------------------------------------------------------------------------------------------------------
    // Script and escaping

    @Test
    fun deliveryScriptMatchesTheContract() {
        val script = FlipperBridge.deliveryScript("""{"a":1}""")
        val expected = "(function(m){try{if(window.FlipperBridge&&typeof window.FlipperBridge.receive===\"function\")" +
            "{window.FlipperBridge.receive(m);}else{window.postMessage(JSON.parse(m),window.location.origin);}}" +
            "catch(e){}})(\"{\\\"a\\\":1}\");true;"
        assertEquals(expected, script)
    }

    @Test
    fun jsLiteralEscapesQuotesBackslashesControlsAndLineSeparators() {
        val ls = Char(0x2028)
        val ps = Char(0x2029)
        val input = "a\"b\\c\nd" + ls + "e" + ps + "f</script>"
        val literal = FlipperBridge.jsStringLiteral(input)
        assertFalse(literal.any { it.code == 0x2028 || it.code == 0x2029 })
        assertTrue(literal.contains("\\" + "u2028"))
        assertTrue(literal.contains("\\" + "u2029"))
        assertTrue(literal.contains("\\\""))
        assertTrue(literal.contains("\\\\"))
        assertTrue(literal.contains("\\n"))
        // It is still a valid JSON string literal that decodes to the input.
        assertEquals(input, Json.parseToJsonElement(literal).jsonPrimitive.content)
    }

    @Test
    fun chainIdNormalization() {
        assertEquals("0x1237", FlipperChainId.toHex(4663))
        assertEquals("0x1237", FlipperChainId.toHex(4663L))
        assertEquals("0x1237", FlipperChainId.toHex("4663"))
        assertEquals("0x1237", FlipperChainId.toHex("0x1237"))
        assertEquals("0x1237", FlipperChainId.toHex("0X1237"))
        assertEquals("0x1237", FlipperChainId.toHex("eip155:4663"))
        assertEquals("0x7a69", FlipperChainId.toHex(JsonPrimitive(31337)))
        assertEquals("0x7a69", FlipperChainId.toHex(JsonPrimitive("0x7A69")))
        assertNull(FlipperChainId.toHex(null))
        assertNull(FlipperChainId.toHex(0))
        assertNull(FlipperChainId.toHex(-1))
        assertNull(FlipperChainId.toHex("abc"))
        assertNull(FlipperChainId.toHex("0x"))
        assertNull(FlipperChainId.toHex("eip155:"))
        assertNull(FlipperChainId.toHex(1.5))
    }

    private companion object {
        /** Extracts the JSON message from a delivery script. */
        fun decodeScript(script: String): JsonObject {
            val prefix = FlipperBridge.deliveryScript("").removeSuffix("\"\");true;")
            assertTrue(script.startsWith(prefix))
            assertTrue(script.endsWith(");true;"))
            val literal = script.removePrefix(prefix).removeSuffix(");true;")
            val json = Json.parseToJsonElement(literal).jsonPrimitive.content
            return Json.parseToJsonElement(json).jsonObject
        }
    }
}
