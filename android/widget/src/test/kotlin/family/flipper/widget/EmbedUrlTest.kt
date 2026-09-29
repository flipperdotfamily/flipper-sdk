package family.flipper.widget

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.util.Base64

class EmbedUrlTest {

    private fun assertRejected(baseUrl: String, allowInsecure: Boolean) {
        try {
            EmbedUrl.build(baseUrl, allowInsecure)
            fail("expected $baseUrl to be rejected (allowInsecure=$allowInsecure)")
        } catch (e: FlipperConfigException) {
            assertEquals("config", e.code)
        }
    }

    @Test
    fun defaultUrlAlwaysCarriesTheChain() {
        val built = EmbedUrl.build(FlipperDefaults.EMBED_URL, allowInsecureLocalhost = false)
        assertEquals("https://flipper.family/embed?chain=4663", built.url)
        assertEquals("https://flipper.family", built.origin)
    }

    @Test
    fun allParamsInOrderAndEncoded() {
        val config = FlipperConfig(
            chain = 31337,
            token = "0xToken",
            tokens = listOf("0xA", "0xB"),
            partner = "acme.app",
            locale = "es",
            compact = true,
            hidePicker = false,
            branding = false,
        )
        val theme = FlipperTheme(mode = FlipperThemeMode.DARK, accent = "#7C5CFF", radius = 12)
        val built = EmbedUrl.build("https://flipper.family/embed", false, config, theme)
        assertEquals(
            "https://flipper.family/embed?chain=31337&token=0xToken&theme=dark&accent=%237C5CFF&radius=12" +
                "&branding=0&partner=acme.app&locale=es&compact=1&hidePicker=0&tokens=0xA%2C0xB",
            built.url,
        )
    }

    @Test
    fun unsetFieldsAreNotSent() {
        val built = EmbedUrl.build(
            "https://flipper.family/embed",
            false,
            FlipperConfig(token = "", partner = null),
            FlipperTheme(),
        )
        assertEquals("https://flipper.family/embed?chain=4663", built.url)
    }

    @Test
    fun extraConfigIsStandardBase64ThenUrlEncoded() {
        val extra = buildJsonObject {
            put("brandName", "Acme ✓")
            put("minAmount", "10")
        }
        val built = EmbedUrl.build("https://flipper.family/embed", false, FlipperConfig(extra = extra))
        val json = """{"brandName":"Acme ✓","minAmount":"10"}"""
        val b64 = Base64.getEncoder().encodeToString(json.toByteArray(Charsets.UTF_8))
        assertTrue(b64.contains('+') || b64.contains('/') || b64.contains('='))
        val encoded = b64.replace("+", "%2B").replace("/", "%2F").replace("=", "%3D")
        assertEquals("https://flipper.family/embed?chain=4663&config=$encoded", built.url)
    }

    @Test
    fun hostOnlyFieldsStayOutOfTheUrl() {
        val extra = flipperExtraConfig(
            brandName = "Acme",
            rpcUrl = "https://rpc.example",
            apiUrl = "https://api.example",
            addresses = mapOf("house" to "0x01", "lens" to "0x02"),
        )
        val built = EmbedUrl.build("https://flipper.family/embed", false, FlipperConfig(extra = extra))
        val b64 = Base64.getEncoder().encodeToString("""{"brandName":"Acme"}""".toByteArray(Charsets.UTF_8))
        val encoded = b64.replace("+", "%2B").replace("/", "%2F").replace("=", "%3D")
        assertEquals("https://flipper.family/embed?chain=4663&config=$encoded", built.url)

        val host = EmbedUrl.hostOnlyConfig(FlipperConfig(extra = extra))
        assertEquals(setOf("rpcUrl", "apiUrl", "addresses"), host.keys)
        assertEquals("https://rpc.example", host["rpcUrl"]!!.jsonPrimitive.content)

        // only network fields: no config param at all
        val onlyNetwork = buildJsonObject {
            put("rpcUrl", "https://rpc.example")
            putJsonObject("addresses") { put("house", "0x01") }
            put("apiUrl", JsonNull)
        }
        assertEquals(
            "https://flipper.family/embed?chain=4663",
            EmbedUrl.build("https://flipper.family/embed", false, FlipperConfig(extra = onlyNetwork)).url,
        )
        assertEquals(setOf("rpcUrl", "addresses"), EmbedUrl.hostOnlyConfig(FlipperConfig(extra = onlyNetwork)).keys)
        assertTrue(EmbedUrl.hostOnlyConfig(FlipperConfig()).isEmpty())
    }

    @Test
    fun base64MatchesTheJdkEncoderForAllPaddings() {
        for (len in 0..40) {
            val bytes = ByteArray(len) { i -> (i * 37 + 250).toByte() }
            assertEquals(Base64.getEncoder().encodeToString(bytes), EmbedUrl.base64(bytes))
        }
    }

    @Test
    fun percentEncodingKeepsOnlyUnreserved() {
        assertEquals("aZ09-._~", EmbedUrl.percentEncode("aZ09-._~"))
        assertEquals("%20%23%26%3D%3F%2F%2B%2C%25", EmbedUrl.percentEncode(" #&=?/+,%"))
        assertEquals("%C3%A9", EmbedUrl.percentEncode("é"))
    }

    @Test
    fun existingParamsAreKeptAndOursReplaceDuplicates() {
        val built = EmbedUrl.build(
            "https://flipper.family/embed?utm=x&chain=1&theme=light#top",
            false,
            FlipperConfig(chain = 31337),
            FlipperTheme(mode = FlipperThemeMode.DARK),
        )
        assertEquals("https://flipper.family/embed?utm=x&chain=31337&theme=dark#top", built.url)
    }

    @Test
    fun emptyPathGetsASlash() {
        assertEquals("https://flipper.family/?chain=4663", EmbedUrl.build("https://flipper.family", false).url)
    }

    @Test
    fun httpsIsAlwaysAllowed() {
        assertEquals("https://widgets.example.com:8443", EmbedUrl.validate("https://widgets.example.com:8443/embed", false))
        assertEquals("https://flipper.family", EmbedUrl.validate("HTTPS://Flipper.Family:443/embed", false))
    }

    @Test
    fun httpOnlyForDebugHostsWhenAllowed() {
        assertEquals("http://localhost:3000", EmbedUrl.validate("http://localhost:3000/embed", true))
        assertEquals("http://127.0.0.1:3000", EmbedUrl.validate("http://127.0.0.1:3000/embed", true))
        assertEquals("http://10.0.2.2:3000", EmbedUrl.validate("http://10.0.2.2:3000/embed", true))
        assertEquals("http://[::1]:3000", EmbedUrl.validate("http://[::1]:3000/embed", true))
        assertEquals("http://localhost", EmbedUrl.validate("http://localhost:80/embed", true))

        assertRejected("http://localhost:3000/embed", false)
        assertRejected("http://10.0.2.2:3000/embed", false)
        assertRejected("http://flipper.family/embed", true)
        assertRejected("http://192.168.1.10:3000/embed", true)
        assertRejected("http://localhost.evil.com/embed", true)
    }

    @Test
    fun rejectsUserinfoOtherSchemesAndGarbage() {
        assertRejected("https://user:pass@flipper.family/embed", false)
        assertRejected("https://flipper.family@evil.com/embed", false)
        assertRejected("ftp://flipper.family/embed", false)
        assertRejected("javascript:alert(1)", true)
        assertRejected("file:///sdcard/embed.html", true)
        assertRejected("data:text/html,hi", true)
        assertRejected("intent://flipper.family#Intent;end", true)
        assertRejected("flipper.family/embed", false)
        assertRejected("https:///embed", false)
        assertRejected("https://exa mple.com/embed", false)
        assertRejected("", false)
    }

    @Test
    fun rejectsNonPositiveChain() {
        try {
            EmbedUrl.build("https://flipper.family/embed", false, FlipperConfig(chain = 0))
            fail("expected chain 0 to be rejected")
        } catch (e: FlipperConfigException) {
            // expected
        }
    }

    @Test
    fun originOf() {
        assertEquals("https://flipper.family", EmbedUrl.originOf("https://flipper.family/embed?chain=4663#x"))
        assertEquals("https://flipper.family", EmbedUrl.originOf("https://flipper.family:443"))
        assertEquals("http://10.0.2.2:3000", EmbedUrl.originOf("http://10.0.2.2:3000/embed"))
        assertEquals("https://flipper.family", EmbedUrl.originOf("https://flipper.family/a|b{c}"))
        assertEquals("https://evil.com", EmbedUrl.originOf("https://evil.com\\@flipper.family/"))
        assertNull(EmbedUrl.originOf("about:blank"))
        assertNull(EmbedUrl.originOf("data:text/html,x"))
        assertNull(EmbedUrl.originOf("file:///x"))
        assertNull(EmbedUrl.originOf("null"))
        assertNull(EmbedUrl.originOf(null))
    }

    // ------------------------------------------------------------------------------------------------------------
    // Navigation policy

    @Test
    fun navigationPolicy() {
        val o = "https://flipper.family"
        fun main(url: String) = NavigationPolicy.decide(url, true, o)
        fun sub(url: String) = NavigationPolicy.decide(url, false, o)

        assertEquals(NavigationDecision.ALLOW, main("https://flipper.family/embed?chain=1"))
        assertEquals(NavigationDecision.OPEN_EXTERNAL, main("https://robinhoodchain.blockscout.com/tx/0x1"))
        assertEquals(NavigationDecision.OPEN_EXTERNAL, main("http://example.com"))
        assertEquals(NavigationDecision.OPEN_EXTERNAL, main("mailto:hi@flipper.family"))
        assertEquals(NavigationDecision.OPEN_EXTERNAL, main("tel:+15555550100"))
        assertEquals(NavigationDecision.BLOCK, main("javascript:alert(1)"))
        assertEquals(NavigationDecision.BLOCK, main("file:///etc/hosts"))
        assertEquals(NavigationDecision.BLOCK, main("data:text/html,x"))
        assertEquals(NavigationDecision.BLOCK, main("content://com.example/x"))
        assertEquals(NavigationDecision.BLOCK, main("intent://x#Intent;end"))
        assertEquals(NavigationDecision.BLOCK, main("metamask://wc?uri=x"))
        assertEquals(NavigationDecision.BLOCK, main("about:blank"))

        assertEquals(NavigationDecision.ALLOW, sub("about:blank"))
        assertEquals(NavigationDecision.ALLOW, sub("about:srcdoc"))
        assertEquals(NavigationDecision.ALLOW, sub("https://flipper.family/frame"))
        assertEquals(NavigationDecision.BLOCK, sub("https://ads.example.com/"))
        assertEquals(NavigationDecision.BLOCK, sub("mailto:x@y.z"))
        assertEquals(NavigationDecision.BLOCK, sub("javascript:void(0)"))

        // Nothing is same-origin before the first load.
        assertEquals(NavigationDecision.OPEN_EXTERNAL, NavigationPolicy.decide("https://flipper.family/embed", true, ""))
    }

    // ------------------------------------------------------------------------------------------------------------
    // Config diff

    @Test
    fun chainAndPartnerReloadOtherFieldsDoNot() {
        val base = FlipperConfig()
        assertTrue(ConfigDiff.requiresReload(base, base.copy(chain = 31337)))
        assertTrue(ConfigDiff.requiresReload(base, base.copy(partner = "acme")))
        assertFalse(ConfigDiff.requiresReload(base, base.copy(locale = "es", compact = true, token = "0x1")))
    }

    @Test
    fun tokenModeAndFitGoInTheUrlAndLiveConfig() {
        val config = FlipperConfig(token = "ETH", mode = FlipperTokenMode.SINGLE, fit = FlipperFit.FILL)
        val params = EmbedUrl.queryParams(config, FlipperTheme()).toMap()
        assertEquals("single", params["mode"])
        assertEquals("fill", params["fit"])
        assertEquals("ETH", params["token"])
        val partial = ConfigDiff.partial(FlipperConfig(), FlipperTheme(), config.copy(fit = null), FlipperTheme())
        assertEquals("single", partial["mode"]!!.jsonPrimitive.content)
        assertNull(partial["fit"])
    }

    @Test
    fun detailsAndTaglinePassThrough() {
        val config = FlipperConfig(details = true, tagline = FlipperTagline.Text("Double or nothing on Acme"))
        val params = EmbedUrl.queryParams(config, FlipperTheme()).toMap()
        assertEquals("1", params["details"])
        assertEquals("Double or nothing on Acme", params["tagline"])
        assertEquals("1", EmbedUrl.queryParams(FlipperConfig(tagline = FlipperTagline.BuiltIn), FlipperTheme()).toMap()["tagline"])
        assertNull(EmbedUrl.queryParams(FlipperConfig(), FlipperTheme()).toMap()["details"])
        val on = ConfigDiff.partial(FlipperConfig(), FlipperTheme(), FlipperConfig(tagline = FlipperTagline.BuiltIn), FlipperTheme())
        assertEquals("true", on["tagline"]!!.jsonPrimitive.content)
        val off = ConfigDiff.partial(config, FlipperTheme(), FlipperConfig(), FlipperTheme())
        assertEquals("false", off["details"]!!.jsonPrimitive.content)
        assertEquals("false", off["tagline"]!!.jsonPrimitive.content)
    }

    @Test
    fun configPartialUsesEmbedFieldNames() {
        val oldConfig = FlipperConfig(extra = buildJsonObject {
            put("brandName", "Old")
            put("listing", true)
        })
        val newConfig = oldConfig.copy(
            compact = true,
            hidePicker = true,
            branding = false,
            locale = "es",
            token = "0xT",
            tokens = listOf("0xA"),
            extra = buildJsonObject {
                put("brandName", "New")
                put("coinImage", "https://cdn.example/coin.png")
                put("type", "hijack")
            },
        )
        val partial = ConfigDiff.partial(
            oldConfig,
            FlipperTheme(),
            newConfig,
            FlipperTheme(mode = FlipperThemeMode.LIGHT, accent = "#ff5a1f", radius = 8),
        )
        assertEquals("light", partial["theme"]!!.jsonPrimitive.content)
        assertEquals("#ff5a1f", partial["accent"]!!.jsonPrimitive.content)
        assertEquals("8", partial["radius"]!!.jsonPrimitive.content)
        assertEquals("compact", partial["variant"]!!.jsonPrimitive.content)
        assertEquals(true, partial["hidePicker"]!!.jsonPrimitive.boolean)
        assertEquals(false, partial["branding"]!!.jsonPrimitive.boolean)
        assertEquals("es", partial["locale"]!!.jsonPrimitive.content)
        assertEquals("0xT", partial["token"]!!.jsonPrimitive.content)
        assertEquals(listOf("0xA"), partial["tokens"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertEquals("New", partial["brandName"]!!.jsonPrimitive.content)
        assertEquals("https://cdn.example/coin.png", partial["coinImage"]!!.jsonPrimitive.content)
        assertEquals(JsonNull, partial["listing"])
        assertFalse(partial.containsKey("type"))
        assertFalse(partial.containsKey("compact"))
        assertFalse(partial.containsKey("chainId"))
    }

    @Test
    fun configPartialResetsToDefaultsAndIsEmptyWithoutChanges() {
        val a = FlipperConfig(compact = true, branding = false)
        val theme = FlipperTheme(mode = FlipperThemeMode.DARK)
        assertTrue(ConfigDiff.partial(a, theme, a, theme).isEmpty())
        val reset = ConfigDiff.partial(a, theme, FlipperConfig(), FlipperTheme())
        assertEquals("card", reset["variant"]!!.jsonPrimitive.content)
        assertEquals(true, reset["branding"]!!.jsonPrimitive.boolean)
        assertEquals("auto", reset["theme"]!!.jsonPrimitive.content)
    }

    @Test
    fun extraConfigHelper() {
        val extra = flipperExtraConfig(
            brandName = "Acme",
            strings = mapOf("flip" to "Toss"),
            listing = false,
            other = buildJsonObject { put("custom", 1) },
        )
        assertEquals("Acme", extra["brandName"]!!.jsonPrimitive.content)
        assertEquals(JsonPrimitive(false), extra["listing"])
        assertEquals("Toss", (extra["strings"] as kotlinx.serialization.json.JsonObject)["flip"]!!.jsonPrimitive.content)
        assertEquals(JsonPrimitive(1), extra["custom"])
        assertFalse(extra.containsKey("brandLogo"))
    }
}
