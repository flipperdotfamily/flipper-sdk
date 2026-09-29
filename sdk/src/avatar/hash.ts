/**
 * The avatar's seed: FNV-1a (32-bit) over the UTF-8 bytes of the trimmed, lowercased address, then a SplitMix32 stream
 * that yields one uint32 per pick. Both are a few integer ops, so the Swift / Kotlin / Dart SDKs can port them exactly:
 * everything is unsigned 32-bit arithmetic with wrap-around (`Math.imul` is a 32-bit multiply).
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** `0xAbC…` and `0xabc…` are the same user; surrounding whitespace is ignored. */
export const normalizeSeed = (address: string): string => String(address ?? "").trim().toLowerCase();

function utf8(s: string): ArrayLike<number> {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
  // ASCII fallback for runtimes without TextEncoder (an address is always ASCII)
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
  return out;
}

/** FNV-1a 32-bit. */
export function fnv1a32(s: string): number {
  let h = FNV_OFFSET;
  const bytes = utf8(s);
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/** SplitMix32: each call returns the next uint32. */
export function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return t >>> 0;
  };
}
