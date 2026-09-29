/**
 * What the hosted embed accepts from where. Everything here is pure (no DOM), so it's unit-tested in node.
 *
 * Trust model:
 * - **The URL** (`/embed?…`, including `config=`) can be crafted by anyone and opened under flipper.family's origin. It
 *   never decides where funds or approvals go: `addresses`, `rpcUrl` and `apiUrl` are always dropped from it; the page's
 *   own deployment manifest decides those. A standalone embed (no host: someone opened a link) also ignores the URL's
 *   branding and copy (`strings`, `brandName`, `brandLogo`, `coinImage*`, custom tagline text), and takes only the
 *   theme mode and plain colour tokens, so a link can't reskin the page into a phishing overlay.
 * - **A host** (an iframe parent or a native app's bridge) already owns the wallet. Its live `config` messages may
 *   set the network fields too. A standalone page has no host, so bridged config is treated like the URL there.
 */
import { normalizePartner, parseChainId } from "@flipperdotfamily/sdk";
import { COLOR_VARS, normalizeColor } from "../theme";
import type { FlipperTheme } from "../types";
import { decodeConfigParam, type FlipperEmbedConfig } from "./protocol";

export { decodeConfigParam, encodeConfigParam } from "./protocol";

/** Where a config comes from, and whether the page has a host. */
export interface ConfigSource {
  /** "url": the page's query string (anyone can craft it); "host": a live `config` message from the bridge */
  from: "url" | "host";
  /** no iframe parent and no native bridge: a link opened directly */
  standalone: boolean;
}

/** Config fields that decide where funds, approvals and reads go. Never from a URL; from a host only when there is one. */
const NETWORK_FIELDS = ["addresses", "rpcUrl", "apiUrl"] as const;
/** Branding and copy a crafted standalone link could use to reskin the page. */
const BRANDING_FIELDS = ["strings", "brandName", "brandLogo", "coinImage", "coinImageTails"] as const;

/**
 * A plain CSS colour and nothing else: #hex, rgb()/rgba()/hsl()/hsla()/oklch()/oklab() with numeric arguments, or a
 * named colour. Rejects `url(`, `expression(`, `@import`, `var(`, quotes, `;`, braces and backslashes by construction.
 */
export function isSafeColor(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (s.length === 0 || s.length > 64) return false;
  return (
    /^#[0-9a-f]{3,8}$/i.test(s) ||
    /^(rgba?|hsla?|oklch|oklab)\(\s*[0-9.,%\s/+-]+(deg|turn|rad)?[0-9.,%\s/+-]*\)$/i.test(s) ||
    /^[a-z]{3,24}$/i.test(s)
  );
}

/** A theme reduced to its mode and plain colour tokens (per mode too): what a standalone URL may set. */
export function sanitizeTheme(t: unknown): FlipperEmbedConfig["theme"] | undefined {
  if (t === "light" || t === "dark" || t === "auto") return t;
  if (!t || typeof t !== "object" || Array.isArray(t)) return undefined;
  const src = t as Record<string, unknown>;
  const colors = (o: unknown) => {
    const out: Record<string, string> = {};
    if (!o || typeof o !== "object") return out;
    for (const k of Object.keys(COLOR_VARS)) {
      const v = Object.prototype.hasOwnProperty.call(o, k) ? (o as Record<string, unknown>)[k] : undefined;
      if (isSafeColor(v)) out[k] = v.trim();
    }
    return out;
  };
  const out: FlipperTheme = { ...colors(src) };
  if (src.mode === "light" || src.mode === "dark" || src.mode === "auto") out.mode = src.mode;
  const light = colors(src.light);
  const dark = colors(src.dark);
  if (Object.keys(light).length) out.light = light;
  if (Object.keys(dark).length) out.dark = dark;
  return out;
}

const httpsOrLocal = (v: unknown) => {
  if (typeof v !== "string") return undefined;
  try {
    const u = new URL(v);
    if (u.protocol === "https:" || u.protocol === "data:" || (u.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname))) return v;
  } catch {
    /* not a URL */
  }
  return undefined;
};

/** Keeps only known fields, with sane types, and only what `source` may set (see the trust model above). */
export function sanitizeConfig(c: FlipperEmbedConfig, source: ConfigSource = { from: "host", standalone: false }): FlipperEmbedConfig {
  const out: FlipperEmbedConfig = {};
  if (!c || typeof c !== "object") return out;
  const trusted = source.from === "host" && !source.standalone;
  const reskinnable = !source.standalone;
  const str = (v: unknown, max = 200) => (typeof v === "string" && v.length <= max ? v : undefined);
  if (typeof c.chainId === "number" || typeof c.chainId === "string") out.chainId = parseChainId(c.chainId as never);
  if (str(c.token, 64)) out.token = c.token;
  if (Array.isArray(c.tokens)) out.tokens = c.tokens.filter((t) => typeof t === "string" && t.length <= 64).slice(0, 50);
  if (c.mode === "picker" || c.mode === "single") out.mode = c.mode;
  if (typeof c.hidePicker === "boolean") out.hidePicker = c.hidePicker;
  if (c.variant === "card" || c.variant === "compact") out.variant = c.variant;
  if (c.fit === "auto" || c.fit === "fill") out.fit = c.fit;
  if (c.size === "sm" || c.size === "md" || c.size === "lg" || c.size === "auto") out.size = c.size;
  // null (a key a host SDK cleared) turns these opt-ins back off
  if (typeof c.details === "boolean" || c.details === null) out.details = c.details ?? false;
  if (typeof c.tagline === "boolean" || c.tagline === null) out.tagline = c.tagline ?? false;
  else if (reskinnable && str(c.tagline, 120) !== undefined) out.tagline = c.tagline;
  if (c.theme !== undefined) {
    const theme = reskinnable ? (typeof c.theme === "string" ? sanitizeTheme(c.theme) : c.theme && typeof c.theme === "object" ? c.theme : undefined) : sanitizeTheme(c.theme);
    if (theme !== undefined) out.theme = theme;
  }
  const accent = normalizeColor(str(c.accent, 64));
  if (isSafeColor(accent)) out.accent = accent;
  if (typeof c.radius === "number" && Number.isFinite(c.radius)) out.radius = Math.max(0, Math.min(40, c.radius));
  if (typeof c.branding === "boolean") out.branding = c.branding;
  if (reskinnable) {
    if (str(c.brandName, 40)) out.brandName = c.brandName;
    for (const k of ["brandLogo", "coinImage", "coinImageTails"] as const) {
      const u = httpsOrLocal(c[k]);
      if (u && u.length < 200_000) out[k] = u;
    }
    if (c.strings && typeof c.strings === "object" && !Array.isArray(c.strings)) {
      out.strings = Object.fromEntries(Object.entries(c.strings).filter(([k, v]) => k !== "__proto__" && typeof v === "string" && v.length <= 500));
    }
  }
  if (str(c.locale, 20)) out.locale = c.locale;
  const partner = normalizePartner(c.partner);
  if (partner) out.partner = partner;
  if (str(c.minAmount, 40)) out.minAmount = c.minAmount;
  if (str(c.maxAmount, 40)) out.maxAmount = c.maxAmount;
  if (c.approval === "max" || c.approval === "exact") out.approval = c.approval;
  if (typeof c.listing === "boolean") out.listing = c.listing;
  if (typeof c.eth === "boolean") out.eth = c.eth;
  if (trusted) {
    const rpc = httpsOrLocal(c.rpcUrl);
    if (rpc && !rpc.startsWith("data:")) out.rpcUrl = rpc;
    const api = httpsOrLocal(c.apiUrl);
    if (api && !api.startsWith("data:")) out.apiUrl = api;
    if (c.addresses && typeof c.addresses === "object" && !Array.isArray(c.addresses)) out.addresses = c.addresses;
  }
  return out;
}

/** The fields a config from `source` loses (for tests and diagnostics). */
export const DROPPED_FROM = {
  url: NETWORK_FIELDS,
  standalone: [...NETWORK_FIELDS, ...BRANDING_FIELDS],
} as const;

/** Parses the embed's URL params into a config (the `config` param, decoded, wins), as the URL may set them. */
export function configFromParams(search: string, opts: { standalone: boolean } = { standalone: false }): FlipperEmbedConfig & {
  connect: "event" | "request";
  hostOrigin?: string;
} {
  const q = new URLSearchParams(search);
  const bool = (k: string) => {
    const v = q.get(k);
    return v === null ? undefined : !/^(0|false|off|no)$/i.test(v.trim());
  };
  const cfg: FlipperEmbedConfig & { connect: "event" | "request"; hostOrigin?: string } = { connect: q.get("connect") === "request" ? "request" : "event" };
  const chainId = parseChainId(q.get("chain") ?? undefined);
  if (chainId) cfg.chainId = chainId;
  const token = q.get("token");
  if (token && token.trim().length <= 64) cfg.token = token.trim();
  const tokens = q.get("tokens");
  if (tokens) cfg.tokens = tokens.split(/[\s,]+/).filter((t) => t && t.length <= 64).slice(0, 50);
  const mode = q.get("mode");
  if (mode === "picker" || mode === "single") cfg.mode = mode;
  const hide = bool("hidePicker") ?? bool("hide-picker");
  if (hide !== undefined) cfg.hidePicker = hide;
  const fit = q.get("fit");
  if (fit === "fill" || fit === "auto") cfg.fit = fit;
  const size = q.get("size");
  if (size === "sm" || size === "md" || size === "lg" || size === "auto") cfg.size = size;
  const details = bool("details");
  if (details !== undefined) cfg.details = details;
  const tagline = q.get("tagline");
  if (tagline !== null) {
    const v = tagline.trim();
    const on = /^(|1|true|on|yes)$/i.test(v);
    const off = /^(0|false|off|no|none)$/i.test(v);
    if (on || off) cfg.tagline = on;
    else if (!opts.standalone) cfg.tagline = v.slice(0, 120);
  }
  const theme = q.get("theme");
  if (theme === "light" || theme === "dark" || theme === "auto") cfg.theme = theme;
  const accent = normalizeColor(q.get("accent"));
  if (isSafeColor(accent)) cfg.accent = accent;
  const radius = q.get("radius");
  if (radius !== null && radius.trim() !== "" && Number.isFinite(Number(radius))) cfg.radius = Math.max(0, Math.min(40, Number(radius)));
  const branding = bool("branding");
  if (branding !== undefined) cfg.branding = branding;
  const partner = normalizePartner(q.get("partner"));
  if (partner) cfg.partner = partner;
  const locale = q.get("locale");
  if (locale && locale.length <= 20) cfg.locale = locale;
  if (bool("compact")) cfg.variant = "compact";
  const approval = q.get("approval");
  if (approval === "exact" || approval === "max") cfg.approval = approval;
  const hostOrigin = q.get("hostOrigin");
  if (hostOrigin) {
    try {
      cfg.hostOrigin = new URL(hostOrigin).origin;
    } catch {
      /* ignore a malformed origin */
    }
  }
  const raw = q.get("config");
  if (raw) Object.assign(cfg, sanitizeConfig(decodeConfigParam(raw) ?? {}, { from: "url", standalone: opts.standalone }));
  return cfg;
}
