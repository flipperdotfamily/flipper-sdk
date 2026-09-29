/**
 * `@flipperdotfamily/sdk/avatar`: deterministic default profile pictures in the flipper.family icon's format. Each address gets
 * one flippered animal's silhouette on a gradient disc; the same address always gets the same avatar, on every platform.
 *
 * Framework-agnostic and dependency-free: the output is an SVG string (or a data URI), so it works in React, the web
 * component, server rendering, React Native (react-native-svg's SvgXml) and anywhere that shows an image.
 *
 * How an avatar is chosen (version 2), so other SDKs can port it exactly:
 *  1. seed = FNV-1a 32 over the UTF-8 bytes of `address.trim().toLowerCase()`
 *  2. a SplitMix32 stream from that seed yields, in order, the animal, disc, tint slot, gradient angle and highlight,
 *     each as `next() % tableSize` (the sizes are AVATAR_TABLE_SIZES[2]).
 *  3. the tint is `disc.tints[slot]`.
 */
import { AVATAR_SILHOUETTES } from "./animals";
import { fnv1a32, normalizeSeed, splitmix32 } from "./hash";
import { AVATAR_ANGLES, AVATAR_DISCS, AVATAR_HIGHLIGHTS, AVATAR_TINTS, type AvatarDisc, type AvatarHighlight, type AvatarTint } from "./palette";

export { AVATAR_SILHOUETTES, type AvatarSilhouette } from "./animals";
export {
  AVATAR_ANGLES,
  AVATAR_DISCS,
  AVATAR_HIGHLIGHTS,
  AVATAR_TINTS,
  type AvatarDisc,
  type AvatarHighlight,
  type AvatarTint,
} from "./palette";

/**
 * The avatar algorithm's version. Bump it (and add a row to AVATAR_TABLE_SIZES) only to start using entries appended to
 * the tables; that reshuffles every user's avatar, so treat it as a deliberate, announced change.
 * Version 1 (pre-launch) drew cartoon busts; version 2 is the icon-style silhouettes.
 */
export const AVATAR_VERSION = 2;

/** How many entries of each table a version picks from. The tables may grow; a version's slice never changes. */
export const AVATAR_TABLE_SIZES = {
  2: { animals: 25, discs: 14, tintsPerDisc: 6, angles: 4, highlights: 4 },
} as const;

const SIZES = AVATAR_TABLE_SIZES[AVATAR_VERSION];

/** The animals of the current version, in table order. */
export const AVATAR_ANIMALS: readonly string[] = AVATAR_SILHOUETTES.slice(0, SIZES.animals).map((a) => a.name);

/** Distinct avatars the current version can draw: animals × discs × tints × gradient angles × highlights. */
export const AVATAR_COMBINATIONS = SIZES.animals * SIZES.discs * SIZES.tintsPerDisc * SIZES.angles * SIZES.highlights;

const DEFAULT_SIZE = 64;

/** The parts an address resolves to. */
export interface AvatarSpec {
  version: number;
  /** the normalised input (trimmed, lowercase) */
  input: string;
  /** the 32-bit seed, as 8 hex digits */
  seed: string;
  animal: { index: number; name: string };
  disc: { index: number } & AvatarDisc;
  tint: { index: number; slot: number } & AvatarTint;
  angle: { index: number; vector: readonly [number, number, number, number] };
  highlight: { index: number } & AvatarHighlight;
}

export interface AvatarOptions {
  /** rendered width and height in px (default 64). Keeps the rim at least 0.75px wide when small. */
  size?: number;
  /** an accessible name: adds `<title>` and `role="img"`. Without one the SVG is decorative (`aria-hidden`). */
  title?: string;
  /**
   * Prefix for the SVG's internal gradient ids. Defaults to one derived from the address, so two different avatars
   * inlined in one page never collide; pass a unique value when inlining the same address more than once.
   */
  idPrefix?: string;
}

/** The table indices an avatar is made of (`slot` indexes the disc's `tints`). */
export interface AvatarParts {
  animal: number;
  disc: number;
  slot: number;
  angle: number;
  highlight: number;
}

/** The parts `address` resolves to (for tests, debugging and native renderers that draw the parts themselves). */
export function avatarSpec(address: string): AvatarSpec {
  const input = normalizeSeed(address);
  const seed = fnv1a32(input);
  const next = splitmix32(seed);
  const pick = (size: number) => next() % size;
  // the order of these picks is part of the algorithm: never reorder them
  const parts: AvatarParts = {
    animal: pick(SIZES.animals),
    disc: pick(SIZES.discs),
    slot: pick(SIZES.tintsPerDisc),
    angle: pick(SIZES.angles),
    highlight: pick(SIZES.highlights),
  };
  return composeAvatarSpec(parts, { input, seed: seed.toString(16).padStart(8, "0") });
}

/** A spec from explicit parts, for previews ("every animal on this disc"). Out-of-range indices wrap. */
export function composeAvatarSpec(parts: AvatarParts, from: { input?: string; seed?: string } = {}): AvatarSpec {
  const wrap = (i: number, size: number) => ((Math.trunc(i) % size) + size) % size;
  const animal = wrap(parts.animal, SIZES.animals);
  const discIndex = wrap(parts.disc, SIZES.discs);
  const slot = wrap(parts.slot, SIZES.tintsPerDisc);
  const angle = wrap(parts.angle, SIZES.angles);
  const highlight = wrap(parts.highlight, SIZES.highlights);
  const disc = AVATAR_DISCS[discIndex]!;
  const tintIndex = disc.tints[slot]!;
  return {
    version: AVATAR_VERSION,
    input: from.input ?? "",
    seed: from.seed ?? [animal, discIndex, slot, angle, highlight].map((v) => v.toString(16).padStart(2, "0")).join(""),
    animal: { index: animal, name: AVATAR_SILHOUETTES[animal]!.name },
    disc: { index: discIndex, ...disc },
    tint: { index: tintIndex, slot, ...AVATAR_TINTS[tintIndex]! },
    angle: { index: angle, vector: AVATAR_ANGLES[angle]! },
    highlight: { index: highlight, ...AVATAR_HIGHLIGHTS[highlight]! },
  };
}

/** The avatar for `address` as an SVG string (viewBox 0 0 64 64, the site icon's format). */
export function avatarSvg(address: string, options: AvatarOptions = {}): string {
  return renderAvatar(avatarSpec(address), options);
}

/** The avatar as a `data:image/svg+xml,…` URI, for an `<img src>`, a CSS background or a native image view. */
export function avatarDataUri(address: string, options: AvatarOptions = {}): string {
  return svgDataUri(avatarSvg(address, options));
}

/**
 * Draws a spec (see avatarSpec), in the site icon's layout: a disc (r 30) with a radial gradient offset toward the
 * light, a rim in the tint at 40%, a soft highlight near the top, and the animal's silhouette in a light gradient.
 */
export function renderAvatar(spec: AvatarSpec, options: AvatarOptions = {}): string {
  const size = clampSize(options.size);
  const id = sanitizeId(options.idPrefix ?? `fa${spec.seed}`);
  const [b, h, f] = [`${id}b`, `${id}h`, `${id}f`];
  const [light, deep] = spec.tint.stops;
  const [x1, y1, x2, y2] = spec.angle.vector;
  const hl = spec.highlight;
  // the icon's rim is 2 units (0.625px at 20px): keep it at least 0.75px on screen
  const rim = Math.max(2, 48 / size);
  const title = options.title?.trim();

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}"` +
    (title ? ` role="img" aria-label="${escapeXml(title)}"><title>${escapeXml(title)}</title>` : ` aria-hidden="true">`) +
    `<defs>` +
    `<radialGradient id="${b}" cx="${hl.cx}" cy="${hl.cy}" r=".84">${stops(spec.disc.stops)}</radialGradient>` +
    `<radialGradient id="${h}"><stop offset="0" stop-color="${light}" stop-opacity=".16"/><stop offset="1" stop-color="${light}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="${f}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops(spec.tint.stops)}</linearGradient>` +
    `</defs>` +
    `<circle cx="32" cy="32" r="30" fill="url(#${b})" stroke="${deep}" stroke-opacity=".4" stroke-width="${fmt(rim)}"/>` +
    `<ellipse cx="${hl.x}" cy="${hl.y}" rx="15" ry="7" fill="url(#${h})"/>` +
    `<path fill="url(#${f})" fill-rule="evenodd" d="${AVATAR_SILHOUETTES[spec.animal.index]!.d}"/>` +
    `</svg>`
  );
}

// ── internals ───────────────────────────────────────────────────────────────────────────────────────────────────────

const fmt = (v: number) => String(Math.round(v * 100) / 100);

const stops = (colors: readonly string[]) =>
  colors.map((c, i) => `<stop offset="${fmt(i / (colors.length - 1))}" stop-color="${c}"/>`).join("");

function clampSize(size: number | undefined): number {
  const s = Number(size);
  return Number.isFinite(s) && s > 0 ? Math.min(1024, Math.max(8, Math.round(s))) : DEFAULT_SIZE;
}

function sanitizeId(prefix: string): string {
  const clean = prefix.replace(/[^A-Za-z0-9_-]/g, "");
  return /^[A-Za-z_]/.test(clean) ? clean : `a${clean}`;
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** A compact, URL-safe `data:` URI: quotes swapped to apostrophes and only unsafe characters percent-encoded. */
function svgDataUri(svg: string): string {
  const body = svg
    .replace(/"/g, "'")
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[^\x20-\x7E]|[%#<>?[\\\]^`{|}]/g, (c) => encodeURIComponent(c));
  return `data:image/svg+xml,${body}`;
}
