// Small, dependency-free helpers. React Native's URL / URLSearchParams / btoa polyfills are incomplete across
// versions (e.g. `URL.prototype.origin` throws on older runtimes), so the SDK does its own parsing.

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const BACKSLASH = String.fromCharCode(0x5c);

/**
 * Encodes a string as a JavaScript string literal (double quoted). JSON escaping plus U+2028 / U+2029, which older
 * JavaScript engines treat as line terminators inside string literals.
 */
export function toJsStringLiteral(value: string): string {
  return JSON.stringify(value)
    .split(LINE_SEPARATOR)
    .join(BACKSLASH + "u2028")
    .split(PARAGRAPH_SEPARATOR)
    .join(BACKSLASH + "u2029");
}

function utf8Bytes(value: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < value.length; i++) {
    let cp = value.charCodeAt(i);
    // combine surrogate pairs; lone surrogates become U+FFFD like TextEncoder
    if (cp >= 0xd800 && cp <= 0xdbff) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (next - 0xdc00);
        i++;
      } else cp = 0xfffd;
    } else if (cp >= 0xdc00 && cp <= 0xdfff) cp = 0xfffd;

    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard (RFC 4648, padded) base64 of the string's UTF-8 bytes: what `btoa` gives for ASCII. */
export function base64Utf8(value: string): string {
  const bytes = utf8Bytes(value);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : -1;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : -1;
    out += B64[a >> 2]!;
    out += B64[((a & 3) << 4) | (b < 0 ? 0 : b >> 4)]!;
    out += b < 0 ? "=" : B64[((b & 15) << 2) | (c < 0 ? 0 : c >> 6)]!;
    out += c < 0 ? "=" : B64[c & 63]!;
  }
  return out;
}

/**
 * Normalizes a chain id from a number, a decimal string ("4663"), a hex string ("0x1237") or a CAIP-2 id
 * ("eip155:4663"). Returns null for anything else.
 */
export function normalizeChainId(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value === "bigint") return value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  if (typeof value !== "string") return null;
  let s = value.trim();
  const caip = /^eip155:(.+)$/i.exec(s);
  if (caip) s = caip[1]!;
  let n: number;
  if (/^0x[0-9a-f]+$/i.test(s)) n = parseInt(s.slice(2), 16);
  else if (/^[0-9]+$/.test(s)) n = parseInt(s, 10);
  else return null;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export const toHexChainId = (chainId: number): string => "0x" + chainId.toString(16);

/** Keeps the string entries of an `eth_accounts`-style result. */
export function normalizeAccounts(value: unknown): string[] {
  if (typeof value === "string") return value ? [value] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((a): a is string => typeof a === "string" && a.length > 0);
}

export interface ParsedUrl {
  /** lower-case, without the colon */
  scheme: string;
  /** lower-case; IPv6 hosts keep their brackets */
  host: string;
  /** explicit port, when not the scheme's default */
  port: string | null;
  hasUserInfo: boolean;
  /** scheme://host[:port], or null for URLs without an authority (about:, data:, mailto:, …) */
  origin: string | null;
}

const DEFAULT_PORTS: Record<string, string> = { http: "80", https: "443", ws: "80", wss: "443" };

/** Parses the parts of a URL the bridge needs (scheme, host, port, origin). */
export function parseUrl(url: string): ParsedUrl | null {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/s.exec(url.trim());
  if (!m) return null;
  const scheme = m[1]!.toLowerCase();
  const rest = m[2]!;
  if (!rest.startsWith("//")) return { scheme, host: "", port: null, hasUserInfo: false, origin: null };
  const authorityEnd = rest.slice(2).search(/[/?#\\]/);
  const authority = authorityEnd < 0 ? rest.slice(2) : rest.slice(2, 2 + authorityEnd);
  const at = authority.lastIndexOf("@");
  const hasUserInfo = at >= 0;
  const hostPort = hasUserInfo ? authority.slice(at + 1) : authority;
  const hp = /^(\[[0-9a-fA-F:.]+\]|[^:[\]]*)(?::([0-9]*))?$/.exec(hostPort);
  if (!hp) return null;
  const host = hp[1]!.toLowerCase();
  let port: string | null = hp[2] ? String(parseInt(hp[2], 10)) : null;
  if (port !== null && DEFAULT_PORTS[scheme] === port) port = null;
  if (!host) return { scheme, host, port, hasUserInfo, origin: null };
  return { scheme, host, port, hasUserInfo, origin: `${scheme}://${host}${port ? `:${port}` : ""}` };
}

/** scheme://host[:port] of a URL (default ports dropped), or null when it has none. */
export const originOf = (url: string | null | undefined): string | null => (url ? (parseUrl(url)?.origin ?? null) : null);
