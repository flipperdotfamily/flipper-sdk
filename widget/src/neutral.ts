/**
 * The widget's UI names no launchpad and no chain by its brand where flipper runs white-labelled. Messages reach the UI
 * from the SDK too (packages/sdk/src/errors.ts `notVettedMessage` / `toFlipperError`, packages/sdk/src/listing.ts
 * `V3_CHECK_REASONS` via `checkListing`); those get neutral wording here, matching the API's own texts
 * (apps/api/internal/discovery/elig.go). Codes and events keep the raw message: this is only what's shown.
 */
const NEUTRAL: Record<string, string> = {
  "Only hookit launches and whitelisted tokens can be listed": "Only whitelisted tokens can be listed right now",
  "Its pool's hook isn't the audited hookit hook, so it can't be listed": "Its launchpad hook isn't one flipper has audited, so it can't be listed",
  "Only ETH-quoted hookit launches can be listed": "Only ETH-quoted launches can be listed",
  "Its hookit pool isn't initialized yet": "Its launch pool isn't initialized yet",
  "This hookit token uses anti-MEV, max-tx or holder-airdrop modules, which flips can't settle through":
    "It uses a launchpad module (anti-MEV, max-tx or holder airdrop) that flips can't settle through",
  "Its hookit launch window is still live: try again after it ends": "Its launch window is still live: try again after it ends",
  "Its token contract isn't the standard hookit token, so it can't be listed": "Its token contract isn't the launchpad's audited token template, so it can't be listed",
  "That isn't the token's own hookit pool": "That isn't the token's own launch pool",
  "This token's hookit launch rail isn't one flipper supports": "This token's launch rail isn't one flipper supports",
  "That action isn't allowed (is the hookit adapter approved on this house?)": "That action isn't allowed",
  "This token wasn't launched on a supported hookit factory": "This token wasn't launched on a supported launchpad",
  "Only ETH-quoted, single-market hookit launches can be listed": "Only ETH-quoted, single-market launches can be listed",
};

/** A message as the UI shows it: known launchpad texts reworded, and any other launchpad or chain brand dropped. */
export function neutral<T extends string | null | undefined>(msg: T): T {
  if (!msg || !/hookit|\bInk\b/i.test(msg)) return msg;
  const m = /^(.*?)([.!]?)\s*$/s.exec(msg)!;
  const known = NEUTRAL[m[1]!];
  if (known) return (known + m[2]) as T;
  return msg
    .replace(/\bhookit(?:\.fun)?(?:'s)?\s*/gi, "")
    .replace(/\bInk(?: Sepolia)?\b/g, "this network")
    .replace(/^\p{Ll}/u, (c) => c.toUpperCase()) as T;
}

/** A chain's name as the UI shows it: the network's own name, or the generic fallback for a name the UI leaves out. */
export function chainLabel(name: string | undefined): string {
  return name && !/\bink\b/i.test(name) ? name : "the right network";
}
