import JavaScriptCore
import XCTest
@testable import FlipperWidget

final class ConfigTests: XCTestCase {
    private func query(_ url: URL) -> [String: String] {
        var out: [String: String] = [:]
        for item in URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? [] { out[item.name] = item.value }
        return out
    }

    func testDefaultURL() throws {
        let built = try FlipperEmbedURL.build(options: FlipperWidgetOptions(), config: FlipperConfig(), theme: FlipperTheme())
        XCTAssertEqual(built.url.absoluteString, "https://flipper.family/embed?chain=4663")
        XCTAssertEqual(built.origin, "https://flipper.family")
    }

    func testEveryParameter() throws {
        let config = FlipperConfig(
            chainId: 31337, token: "0xaA", tokens: ["0x1", "0x2"], partner: "acme.app", locale: "es",
            compact: true, hidePicker: false, branding: false
        )
        let theme = FlipperTheme(mode: .dark, accent: "#ff5a1f", radius: 12)
        let built = try FlipperEmbedURL.build(options: FlipperWidgetOptions(), config: config, theme: theme)
        XCTAssertEqual(query(built.url), [
            "chain": "31337", "token": "0xaA", "tokens": "0x1,0x2", "theme": "dark", "accent": "#ff5a1f", "radius": "12",
            "branding": "0", "partner": "acme.app", "locale": "es", "compact": "1", "hidePicker": "0",
        ])
        XCTAssertTrue(built.url.absoluteString.contains("accent=%23ff5a1f"))
        XCTAssertTrue(built.url.absoluteString.contains("tokens=0x1%2C0x2"))
    }

    func testTokenModeAndFit() throws {
        let config = FlipperConfig(token: "ETH", mode: .single, fit: .fill)
        let built = try FlipperEmbedURL.build(options: FlipperWidgetOptions(), config: config, theme: FlipperTheme())
        let q = query(built.url)
        XCTAssertEqual(q["mode"], "single")
        XCTAssertEqual(q["fit"], "fill")
        XCTAssertEqual(q["token"], "ETH")
        let live = FlipperEmbedURL.liveConfig(config: config, theme: FlipperTheme())
        XCTAssertEqual(live["mode"], .string("single"))
        XCTAssertEqual(live["fit"], .string("fill"))
    }

    func testDetailsAndTaglinePassThrough() throws {
        var config = FlipperConfig()
        XCTAssertNil(config.tagline)
        config.details = true
        config.tagline = .text("Double or nothing on Acme")
        XCTAssertEqual(config.tagline, .text("Double or nothing on Acme"))
        let live = FlipperEmbedURL.liveConfig(config: config, theme: FlipperTheme())
        XCTAssertEqual(live["details"], .bool(true))
        XCTAssertEqual(live["tagline"], .string("Double or nothing on Acme"))
        config.tagline = .builtIn
        XCTAssertEqual(FlipperEmbedURL.liveConfig(config: config, theme: FlipperTheme())["tagline"], .bool(true))
        config.tagline = nil
        XCTAssertEqual(FlipperEmbedURL.liveConfig(config: config, theme: FlipperTheme())["tagline"], .bool(false), "turning it off is sent live")
        XCTAssertNil(config.tagline)
    }

    func testConfigIsBase64JSONWithEscapedPlus() throws {
        var config = FlipperConfig()
        config.brandName = "Açme ✓ >>>?"
        config.strings = ["flip": "Lanzar"]
        let theme = FlipperTheme(custom: ["colors": ["accent": "#123456"]])
        let built = try FlipperEmbedURL.build(options: FlipperWidgetOptions(), config: config, theme: theme)
        let raw = built.url.absoluteString
        XCTAssertFalse(raw.contains("+"), "a raw + would decode as a space in URLSearchParams")
        let b64 = try XCTUnwrap(query(built.url)["config"])
        let decoded = try JSONValue.parse(String(decoding: try XCTUnwrap(Data(base64Encoded: b64)), as: UTF8.self))
        XCTAssertEqual(decoded, ["brandName": "Açme ✓ >>>?", "strings": ["flip": "Lanzar"], "theme": ["colors": ["accent": "#123456"]]])
        XCTAssertNil(query(built.url)["theme"])
    }

    func testHostOnlyFieldsStayOutOfTheURL() throws {
        let network: [String: JSONValue] = ["rpcUrl": "https://rpc.example", "apiUrl": "https://api.example", "addresses": ["house": "0x01", "lens": "0x02"]]
        var config = FlipperConfig(extra: network)
        config.brandName = "Acme"
        let built = try FlipperEmbedURL.build(options: FlipperWidgetOptions(), config: config, theme: FlipperTheme())
        let b64 = try XCTUnwrap(query(built.url)["config"])
        let decoded = try JSONValue.parse(String(decoding: try XCTUnwrap(Data(base64Encoded: b64)), as: UTF8.self))
        XCTAssertEqual(decoded, ["brandName": "Acme"])
        XCTAssertEqual(FlipperEmbedURL.hostOnlyConfig(config), network)

        let onlyNetwork = FlipperConfig(extra: ["rpcUrl": "https://rpc.example", "apiUrl": .null])
        let bare = try FlipperEmbedURL.build(options: FlipperWidgetOptions(), config: onlyNetwork, theme: FlipperTheme())
        XCTAssertEqual(bare.url.absoluteString, "https://flipper.family/embed?chain=4663", "no empty config param")
        XCTAssertEqual(FlipperEmbedURL.hostOnlyConfig(onlyNetwork), ["rpcUrl": "https://rpc.example"])
        XCTAssertTrue(FlipperEmbedURL.hostOnlyConfig(FlipperConfig()).isEmpty)
    }

    func testKeepsBaseParamsAndFragment() throws {
        let options = FlipperWidgetOptions(baseURL: URL(string: "https://flipper.family/embed?utm=x&chain=1#top")!)
        let built = try FlipperEmbedURL.build(options: options, config: FlipperConfig(partner: "p"), theme: FlipperTheme())
        XCTAssertEqual(built.url.absoluteString, "https://flipper.family/embed?utm=x&chain=4663&partner=p#top")
    }

    func testInsecureURLsOnlyForLoopbackWhenAllowed() throws {
        for base in ["http://localhost:3000/embed", "http://127.0.0.1:3000/embed", "http://10.0.2.2:3000/embed", "http://[::1]:3000/embed"] {
            let url = URL(string: base)!
            XCTAssertThrowsError(try FlipperEmbedURL.validate(url, allowInsecureLocalhost: false), base)
            XCTAssertNoThrow(try FlipperEmbedURL.validate(url, allowInsecureLocalhost: true), base)
        }
        XCTAssertEqual(try FlipperEmbedURL.validate(URL(string: "http://localhost:3000/embed")!, allowInsecureLocalhost: true), "http://localhost:3000")
        for base in [
            "http://flipper.family/embed", "http://192.168.1.10:3000/embed", "http://localhost.evil.example/embed",
            "https://user:pass@flipper.family/embed", "https://flipper.family@evil.example/embed",
            "javascript:alert(1)", "file:///etc/passwd", "data:text/html,hi", "ftp://flipper.family/embed",
        ] {
            XCTAssertThrowsError(try FlipperEmbedURL.validate(URL(string: base)!, allowInsecureLocalhost: true), base)
        }
    }

    func testLiveConfigAndDiff() {
        let config = FlipperConfig(chainId: 1, token: "0x9", partner: "x", compact: true, extra: ["brandName": "A", "chainId": 5, "partner": "y"])
        let live = FlipperEmbedURL.liveConfig(config: config, theme: FlipperTheme(mode: .light))
        XCTAssertEqual(live, ["brandName": "A", "theme": "light", "variant": "compact", "token": "0x9"])
        XCTAssertEqual(FlipperEmbedURL.diff(live, live), [:])
        var next = live
        next["theme"] = "dark"
        next["accent"] = "#fff"
        XCTAssertEqual(FlipperEmbedURL.diff(live, next), ["theme": "dark", "accent": "#fff"])
    }

    func testNavigationPolicy() {
        let o = "https://flipper.family"
        func d(_ s: String, main: Bool = true) -> FlipperNavigationDecision {
            FlipperNavigationDecision.decide(url: URL(string: s), embedOrigin: o, isMainFrame: main)
        }
        XCTAssertEqual(d("https://flipper.family/embed?chain=1"), .allow)
        XCTAssertEqual(d("HTTPS://FLIPPER.FAMILY:443/x"), .allow)
        XCTAssertEqual(d("https://flipper.family/asset.js", main: false), .allow)
        XCTAssertEqual(d("https://robinhoodchain.blockscout.com/tx/0x1"), .openExternally)
        XCTAssertEqual(d("mailto:hi@flipper.family"), .openExternally)
        XCTAssertEqual(d("https://flipper.family.evil.example/"), .openExternally)
        XCTAssertEqual(d("https://user@flipper.family/"), .openExternally)
        for bad in ["javascript:alert(1)", "file:///x", "data:text/html,x", "wc:abc@2", "metamask://x", "about:blank"] {
            XCTAssertEqual(d(bad), .block, bad)
        }
        XCTAssertEqual(d("https://ads.example/frame", main: false), .block)
        XCTAssertEqual(d("about:blank", main: false), .allow)
        XCTAssertEqual(d("about:srcdoc", main: false), .allow)
    }

    func testChainIds() {
        XCTAssertEqual(flipperNormalizeChainId(4663), 4663)
        XCTAssertEqual(flipperNormalizeChainId("4663"), 4663)
        XCTAssertEqual(flipperNormalizeChainId("0x1237"), 4663)
        XCTAssertEqual(flipperNormalizeChainId("eip155:4663"), 4663)
        for bad: JSONValue in [0, -1, 1.5, "", "abc", "solana:5eykt", nil, [:]] { XCTAssertNil(flipperNormalizeChainId(bad)) }
        XCTAssertEqual(flipperHexChainId(4663), "0x1237")
        XCTAssertEqual(flipperHexChainId(31337), "0x7a69")
    }

    func testJSONSerializationAndJSLiterals() throws {
        let ls = String(Character(Unicode.Scalar(0x2028)!))
        let ps = String(Character(Unicode.Scalar(0x2029)!))
        let tricky = "a\"b'c\\d</script>" + ls + "x" + ps + "\n\u{0001}🪙"
        let literal = FlipperScripts.jsStringLiteral(tricky)
        XCTAssertFalse(literal.contains(ls))
        XCTAssertFalse(literal.contains(ps))
        let ctx = JSContext(virtualMachine: sharedJSVirtualMachine)!
        XCTAssertEqual(ctx.evaluateScript(literal)?.toString(), tricky)

        let value: JSONValue = ["b": [1, 2.5, true, nil, "x"], "a": ["nested": -3]]
        XCTAssertEqual(value.jsonString, #"{"a":{"nested":-3},"b":[1,2.5,true,null,"x"]}"#)
        XCTAssertEqual(try JSONValue.parse(value.jsonString), value)
        XCTAssertEqual(JSONValue.number(.infinity).jsonString, "null")
        XCTAssertEqual(JSONValue(any: ["x": NSNumber(value: true), "y": NSNumber(value: 3)] as [String: Any]), ["x": true, "y": 3])
    }
}
