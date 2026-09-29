import Foundation

/// A JSON value: what crosses the bridge (RPC params and results, event payloads, config).
///
/// Wallet adapters convert to and from their own types with `init(any:)` / `anyValue`, or via `Codable`.
public enum JSONValue: Hashable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])
}

// MARK: - Literals

extension JSONValue: ExpressibleByNilLiteral, ExpressibleByBooleanLiteral, ExpressibleByIntegerLiteral,
    ExpressibleByFloatLiteral, ExpressibleByStringLiteral, ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral
{
    public init(nilLiteral: ()) { self = .null }
    public init(booleanLiteral value: Bool) { self = .bool(value) }
    public init(integerLiteral value: Int) { self = .number(Double(value)) }
    public init(floatLiteral value: Double) { self = .number(value) }
    public init(stringLiteral value: String) { self = .string(value) }
    public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
    public init(dictionaryLiteral elements: (String, JSONValue)...) {
        self = .object(Dictionary(elements, uniquingKeysWith: { _, last in last }))
    }
}

// MARK: - Accessors

extension JSONValue {
    public var stringValue: String? { if case .string(let s) = self { return s } else { return nil } }
    public var boolValue: Bool? { if case .bool(let b) = self { return b } else { return nil } }
    public var doubleValue: Double? { if case .number(let n) = self { return n } else { return nil } }
    public var intValue: Int? {
        if case .number(let n) = self, n.rounded() == n, abs(n) <= 9_007_199_254_740_991 { return Int(n) }
        return nil
    }
    public var arrayValue: [JSONValue]? { if case .array(let a) = self { return a } else { return nil } }
    public var objectValue: [String: JSONValue]? { if case .object(let o) = self { return o } else { return nil } }
    public var isNull: Bool { self == .null }

    public subscript(key: String) -> JSONValue? { objectValue?[key] }
    public subscript(index: Int) -> JSONValue? {
        guard let a = arrayValue, index >= 0, index < a.count else { return nil }
        return a[index]
    }
}

// MARK: - Foundation bridging

extension JSONValue {
    /// Converts a Foundation JSON object (`JSONSerialization` output, `[String: Any]`, `NSNumber`, …). Returns nil
    /// for values JSON can't represent.
    public init?(any value: Any?) {
        guard let value else { self = .null; return }
        switch value {
        case let v as JSONValue: self = v
        case is NSNull: self = .null
        case let s as String: self = .string(s)
        case let n as NSNumber:
            if CFGetTypeID(n) == CFBooleanGetTypeID() { self = .bool(n.boolValue) } else { self = .number(n.doubleValue) }
        case let b as Bool: self = .bool(b)
        case let i as Int: self = .number(Double(i))
        case let d as Double: self = .number(d)
        case let a as [Any?]:
            var out: [JSONValue] = []
            out.reserveCapacity(a.count)
            for item in a {
                guard let v = JSONValue(any: item) else { return nil }
                out.append(v)
            }
            self = .array(out)
        case let o as [String: Any?]:
            var out: [String: JSONValue] = [:]
            for (k, item) in o {
                guard let v = JSONValue(any: item) else { return nil }
                out[k] = v
            }
            self = .object(out)
        default: return nil
        }
    }

    /// The Foundation form (`NSNull`, `String`, `Double`/`Int`, `Bool`, `[Any]`, `[String: Any]`).
    public var anyValue: Any {
        switch self {
        case .null: return NSNull()
        case .bool(let b): return b
        case .number(let n): return n.rounded() == n && abs(n) <= 9_007_199_254_740_991 ? Int(n) as Any : n as Any
        case .string(let s): return s
        case .array(let a): return a.map(\.anyValue)
        case .object(let o): return o.mapValues(\.anyValue)
        }
    }

    /// Parses JSON text (any top-level value).
    public static func parse(_ text: String) throws -> JSONValue {
        let object = try JSONSerialization.jsonObject(with: Data(text.utf8), options: [.fragmentsAllowed])
        guard let value = JSONValue(any: object) else {
            throw NSError(domain: "FlipperWidget.JSONValue", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unsupported JSON value"])
        }
        return value
    }
}

// MARK: - Serialization

extension JSONValue {
    /// Compact JSON text. Object keys are sorted (deterministic output); integral numbers print without a fraction;
    /// non-finite numbers become `null`; U+2028 / U+2029 are escaped.
    public var jsonString: String {
        var out = ""
        write(to: &out)
        return out
    }

    private func write(to out: inout String) {
        switch self {
        case .null: out += "null"
        case .bool(let b): out += b ? "true" : "false"
        case .number(let n): out += JSONValue.format(n)
        case .string(let s): JSONValue.writeString(s, to: &out)
        case .array(let a):
            out += "["
            for (i, v) in a.enumerated() {
                if i > 0 { out += "," }
                v.write(to: &out)
            }
            out += "]"
        case .object(let o):
            out += "{"
            for (i, key) in o.keys.sorted().enumerated() {
                if i > 0 { out += "," }
                JSONValue.writeString(key, to: &out)
                out += ":"
                o[key]!.write(to: &out)
            }
            out += "}"
        }
    }

    static func format(_ n: Double) -> String {
        guard n.isFinite else { return "null" }
        if n.rounded() == n, abs(n) <= 9_007_199_254_740_991 { return String(Int64(n)) }
        return "\(n)"
    }

    private static let backslash = "\\"

    static func writeString(_ s: String, to out: inout String) {
        out += "\""
        for scalar in s.unicodeScalars {
            switch scalar.value {
            case 0x22: out += backslash + "\""
            case 0x5C: out += backslash + backslash
            case 0x0A: out += backslash + "n"
            case 0x0D: out += backslash + "r"
            case 0x09: out += backslash + "t"
            case 0x08: out += backslash + "b"
            case 0x0C: out += backslash + "f"
            case 0x00..<0x20, 0x2028, 0x2029:
                let hex = String(scalar.value, radix: 16)
                out += backslash + "u" + String(repeating: "0", count: 4 - hex.count) + hex
            default: out.unicodeScalars.append(scalar)
            }
        }
        out += "\""
    }
}

// MARK: - Codable

extension JSONValue: Codable {
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n): if let i = intValue { try c.encode(i) } else { try c.encode(n) }
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }
}
