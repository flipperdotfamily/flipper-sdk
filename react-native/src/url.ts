import { DEBUG_HOSTS, DEFAULT_CHAIN_ID, DEFAULT_EMBED_URL } from "./constants";
import { base64Utf8, parseUrl } from "./encoding";
import type { FlipperEmbedConfig, FlipperEmbedOptions } from "./types";

/** An invalid embed configuration (e.g. a non-https `baseUrl`). The widget reports it through `onError`. */
export class FlipperConfigError extends Error {
  readonly code = "config";
  constructor(message: string) {
    super(message);
    this.name = "FlipperConfigError";
  }
}

export interface EmbedUrlOptions extends FlipperEmbedOptions {
  /** default https://flipper.family/embed */
  baseUrl?: string;
  /** allow http://localhost (and 127.0.0.1, 10.0.2.2, ::1); keep this off in release builds */
  allowInsecureLocalhost?: boolean;
}

export interface EmbedUrl {
  url: string;
  /** scheme://host[:port]: the only origin the widget talks to or navigates within */
  origin: string;
}

/**
 * Checks that `baseUrl` is https (or http on a loopback host when `allowInsecureLocalhost`), without credentials,
 * and returns its origin. Throws `FlipperConfigError` otherwise.
 */
export function validateEmbedBaseUrl(baseUrl: string, allowInsecureLocalhost: boolean): string {
  const parsed = parseUrl(baseUrl);
  if (!parsed || !parsed.origin) throw new FlipperConfigError(`Invalid embed URL: ${baseUrl}`);
  if (parsed.hasUserInfo) throw new FlipperConfigError("The embed URL must not contain credentials.");
  if (parsed.scheme === "https") return parsed.origin;
  if (parsed.scheme === "http") {
    const loopback = (DEBUG_HOSTS as readonly string[]).includes(parsed.host);
    if (loopback && allowInsecureLocalhost) return parsed.origin;
    throw new FlipperConfigError(
      loopback
        ? "http:// embed URLs are only allowed in development (allowInsecureLocalhost)."
        : "The embed URL must use https:// (http:// is only allowed for localhost in development).",
    );
  }
  throw new FlipperConfigError(`Unsupported embed URL scheme: ${parsed.scheme}:`);
}

const flag = (v: boolean) => (v ? "1" : "0");

/**
 * `FlipperEmbedConfig` fields the embed never takes from its URL, since anyone can craft a URL: they decide where
 * funds, approvals and reads go. The embed only accepts them from its host's live `config` messages, so they're left
 * out of the URL and the bridge sends them after every `ready` (`hostConfig`).
 */
export const HOST_ONLY_CONFIG_KEYS = ["rpcUrl", "apiUrl", "addresses"] as const;

/** The host-only fields of `options.config` (`rpcUrl`, `apiUrl`, `addresses`); `{}` when none are set. */
export function hostOnlyConfigOf(options: FlipperEmbedOptions): FlipperEmbedConfig {
  const out: FlipperEmbedConfig = {};
  const c = options.config ?? {};
  for (const k of HOST_ONLY_CONFIG_KEYS) if (c[k] !== undefined && c[k] !== null) (out as Record<string, unknown>)[k] = c[k];
  return out;
}

/** The URL parameters for a set of embed options (only the ones that are set). */
export function embedQueryParams(options: FlipperEmbedOptions): Array<[string, string]> {
  const out: Array<[string, string]> = [["chain", String(options.chain ?? DEFAULT_CHAIN_ID)]];
  if (options.token) out.push(["token", options.token]);
  if (options.tokens && options.tokens.length) out.push(["tokens", options.tokens.join(",")]);
  if (typeof options.theme === "string") out.push(["theme", options.theme]);
  if (options.accent) out.push(["accent", options.accent]);
  if (typeof options.radius === "number" && Number.isFinite(options.radius)) out.push(["radius", String(Math.round(options.radius))]);
  if (typeof options.branding === "boolean") out.push(["branding", flag(options.branding)]);
  if (options.partner) out.push(["partner", options.partner]);
  if (options.locale) out.push(["locale", options.locale]);
  if (typeof options.compact === "boolean") out.push(["compact", flag(options.compact)]);
  if (options.mode === "picker" || options.mode === "single") out.push(["mode", options.mode]);
  if (typeof options.hidePicker === "boolean") out.push(["hidePicker", flag(options.hidePicker)]);
  if (options.fit === "auto" || options.fit === "fill") out.push(["fit", options.fit]);
  if (typeof options.details === "boolean") out.push(["details", flag(options.details)]);
  if (typeof options.tagline === "boolean") out.push(["tagline", flag(options.tagline)]);
  else if (typeof options.tagline === "string" && options.tagline) out.push(["tagline", options.tagline]);
  const extra: FlipperEmbedConfig = { ...(options.config ?? {}) };
  for (const k of HOST_ONLY_CONFIG_KEYS) delete extra[k]; // the embed ignores them in the URL: sent after `ready`
  if (options.theme && typeof options.theme === "object") extra.theme = options.theme;
  if (Object.keys(extra).length) out.push(["config", base64Utf8(JSON.stringify(extra))]);
  return out;
}

/** Builds and validates the embed URL. Throws `FlipperConfigError` for an unsafe `baseUrl`. */
export function buildEmbedUrl(options: EmbedUrlOptions = {}): EmbedUrl {
  const baseUrl = (options.baseUrl ?? DEFAULT_EMBED_URL).trim();
  const origin = validateEmbedBaseUrl(baseUrl, options.allowInsecureLocalhost ?? false);

  const hashAt = baseUrl.indexOf("#");
  const beforeHash = hashAt < 0 ? baseUrl : baseUrl.slice(0, hashAt);
  const hash = hashAt < 0 ? "" : baseUrl.slice(hashAt);
  const queryAt = beforeHash.indexOf("?");
  const head = queryAt < 0 ? beforeHash : beforeHash.slice(0, queryAt);
  const existing = queryAt < 0 ? "" : beforeHash.slice(queryAt + 1);

  const params = embedQueryParams(options);
  const ours = new Set(params.map(([k]) => k));
  const kept = existing
    .split("&")
    .filter((pair) => pair && !ours.has(safeDecode(pair.split("=")[0]!)));
  const added = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  const query = [...kept, ...added].join("&");
  return { url: `${head}${query ? `?${query}` : ""}${hash}`, origin };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

/**
 * The live-config form of the embed options (`FlipperEmbedConfig` field names), used to diff prop changes into
 * `config` messages. `chain`, `partner` and `baseUrl` changes reload the page instead.
 */
export function liveConfigOf(options: FlipperEmbedOptions): FlipperEmbedConfig {
  const out: FlipperEmbedConfig = { ...(options.config ?? {}) };
  if (options.theme !== undefined) out.theme = options.theme;
  if (options.accent !== undefined) out.accent = options.accent;
  if (options.radius !== undefined) out.radius = options.radius;
  if (options.branding !== undefined) out.branding = options.branding;
  if (options.locale !== undefined) out.locale = options.locale;
  if (options.compact !== undefined) out.variant = options.compact ? "compact" : "card";
  if (options.mode !== undefined) out.mode = options.mode;
  if (options.hidePicker !== undefined) out.hidePicker = options.hidePicker;
  if (options.fit !== undefined) out.fit = options.fit;
  if (options.details !== undefined) out.details = options.details;
  if (options.tagline !== undefined) out.tagline = options.tagline;
  if (options.token !== undefined) out.token = options.token;
  if (options.tokens !== undefined) out.tokens = [...options.tokens];
  // identity fields: handled by reloading, never sent live from props
  delete out.chainId;
  delete out.partner;
  return out;
}

/** Keys whose values differ between two live configs (by JSON value); removed keys are not reported. */
export function diffConfig(prev: FlipperEmbedConfig, next: FlipperEmbedConfig): FlipperEmbedConfig | null {
  const changed: FlipperEmbedConfig = {};
  let any = false;
  for (const key of Object.keys(next)) {
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
      changed[key] = next[key];
      any = true;
    }
  }
  return any ? changed : null;
}
