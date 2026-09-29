/**
 * The avatar palette, in the site icon's format: a disc filled with a 3-stop radial gradient in the site's ocean
 * colours, and a silhouette filled with a 2-stop light linear gradient.
 *
 * ⚠️ APPEND-ONLY. An avatar is a set of indices into these arrays. Reordering, removing or editing an entry changes
 * every avatar that points at it, and changing how many entries a version uses (AVATAR_TABLE_SIZES) reshuffles every
 * user's avatar. New entries go at the end, and only a new AVATAR_VERSION picks them up.
 */

/**
 * A disc: the radial gradient's stops from its (top-left) centre to the rim, deep ocean colours like the icon's
 * #0e3a57 → #082536 → #04121c. `tints` are the silhouette tints (indices into AVATAR_TINTS) that read on it: six per
 * disc, leaving out the ones too close in hue.
 */
export interface AvatarDisc {
  name: string;
  stops: readonly [string, string, string];
  tints: readonly number[];
}

/** A silhouette tint: the linear gradient's light start and its deeper end (the end also colours the rim). */
export interface AvatarTint {
  name: string;
  stops: readonly [string, string];
}

export const AVATAR_TINTS: readonly AvatarTint[] = [
  { name: "sky", stops: ["#9BE0FF", "#4CC2FF"] }, // the icon's
  { name: "seafoam", stops: ["#C4FFF4", "#5CF2DC"] },
  { name: "pearl", stops: ["#FFFFFF", "#BCD0DE"] },
  { name: "gold", stops: ["#FFE7A6", "#F5C451"] },
  { name: "coral", stops: ["#FFCFC5", "#FF907F"] },
  { name: "lilac", stops: ["#E8E0FF", "#B7A0FF"] },
  { name: "mint", stops: ["#D2FFE0", "#7BE3A6"] },
  { name: "peach", stops: ["#FFE0C2", "#FFA56B"] },
];

const [SKY, SEAFOAM, PEARL, GOLD, CORAL, LILAC, MINT, PEACH] = [0, 1, 2, 3, 4, 5, 6, 7];

export const AVATAR_DISCS: readonly AvatarDisc[] = [
  { name: "deep navy", stops: ["#0E3A57", "#082536", "#04121C"], tints: [SKY, SEAFOAM, PEARL, GOLD, CORAL, LILAC] }, // the icon's
  { name: "reef blue", stops: ["#0A4169", "#062E4A", "#03131F"], tints: [SEAFOAM, PEARL, GOLD, CORAL, MINT, PEACH] },
  { name: "teal deep", stops: ["#0B4650", "#08323A", "#031417"], tints: [SKY, PEARL, GOLD, CORAL, LILAC, PEACH] },
  { name: "abyss green", stops: ["#0C4236", "#082C26", "#03120F"], tints: [SKY, PEARL, GOLD, CORAL, LILAC, PEACH] },
  { name: "midnight violet", stops: ["#2E2170", "#170F40", "#070618"], tints: [SKY, SEAFOAM, PEARL, GOLD, MINT, PEACH] },
  { name: "indigo", stops: ["#232C78", "#121845", "#06081C"], tints: [SKY, SEAFOAM, PEARL, GOLD, CORAL, MINT] },
  { name: "dusk ember", stops: ["#5E2440", "#301431", "#0E0816"], tints: [SKY, SEAFOAM, PEARL, GOLD, LILAC, MINT] },
  { name: "plum", stops: ["#4C1F62", "#271237", "#0D0717"], tints: [SKY, SEAFOAM, PEARL, GOLD, MINT, PEACH] },
  { name: "storm", stops: ["#283D50", "#172633", "#080F15"], tints: [SKY, SEAFOAM, GOLD, CORAL, LILAC, MINT] },
  { name: "twilight", stops: ["#1C3E7A", "#0F2148", "#050B1E"], tints: [SEAFOAM, PEARL, GOLD, CORAL, MINT, PEACH] },
  { name: "lagoon night", stops: ["#08434D", "#06363F", "#021519"], tints: [SKY, PEARL, GOLD, CORAL, LILAC, PEACH] },
  { name: "kelp", stops: ["#1E4432", "#132D22", "#05110C"], tints: [SKY, PEARL, GOLD, CORAL, LILAC, PEACH] },
  { name: "aurora", stops: ["#163F5E", "#1A1F55", "#07081D"], tints: [SEAFOAM, PEARL, GOLD, CORAL, MINT, PEACH] },
  { name: "coral dusk", stops: ["#6A2F33", "#34171F", "#0E080C"], tints: [SKY, SEAFOAM, PEARL, GOLD, LILAC, MINT] },
];

/** The silhouette gradient's direction (objectBoundingBox x1 y1 x2 y2); the first is the icon's. */
export const AVATAR_ANGLES: readonly (readonly [number, number, number, number])[] = [
  [0.2, 0, 0.8, 1],
  [0, 0, 1, 1],
  [0.5, 0, 0.5, 1],
  [0, 0.25, 1, 0.75],
];

/**
 * The light source: the soft highlight ellipse's centre (icon units) and the disc gradient's centre (fraction of the
 * disc). The first is the icon's; the others move it a little along the top.
 */
export interface AvatarHighlight {
  x: number;
  y: number;
  cx: number;
  cy: number;
}

export const AVATAR_HIGHLIGHTS: readonly AvatarHighlight[] = [
  { x: 27, y: 13, cx: 0.36, cy: 0.24 },
  { x: 24, y: 14.5, cx: 0.31, cy: 0.27 },
  { x: 31, y: 12.5, cx: 0.43, cy: 0.22 },
  { x: 34, y: 13.5, cx: 0.5, cy: 0.25 },
];
