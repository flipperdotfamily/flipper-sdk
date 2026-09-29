import { parseUrl } from "./encoding";

export type NavigationDecision = "allow" | "open-external" | "block";

const EXTERNAL_SCHEMES = new Set(["https", "http", "mailto", "tel"]);

/**
 * What to do with a navigation inside the widget's WebView:
 * - the embed origin: `allow`;
 * - sub-frames: only `about:blank` / `about:srcdoc` besides the embed origin, everything else `block`;
 * - top-frame http(s) / mailto / tel elsewhere: `open-external` (system browser or app), never inside the widget;
 * - any other scheme (javascript:, file:, data:, intent:, custom deep links): `block`.
 */
export function decideNavigation(url: string, embedOrigin: string, isTopFrame: boolean): NavigationDecision {
  const trimmed = (url ?? "").trim();
  if (!isTopFrame && (trimmed === "about:blank" || trimmed === "about:srcdoc")) return "allow";
  const parsed = parseUrl(trimmed);
  if (!parsed) return "block";
  if (parsed.origin !== null && parsed.origin === embedOrigin && !parsed.hasUserInfo) return "allow";
  if (!isTopFrame) return "block";
  return EXTERNAL_SCHEMES.has(parsed.scheme) ? "open-external" : "block";
}
