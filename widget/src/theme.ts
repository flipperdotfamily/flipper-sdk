import type { FlipperColors, FlipperTheme, FlipperThemeMode } from "./types";

/** CSS custom property per theme colour. Hosts can set these directly (`flipper-widget { --flipper-accent: … }`). */
export const COLOR_VARS: Record<keyof FlipperColors, string> = {
  accent: "--flipper-accent",
  accentText: "--flipper-accent-text",
  background: "--flipper-bg",
  surface: "--flipper-surface",
  field: "--flipper-field",
  border: "--flipper-border",
  text: "--flipper-text",
  textMuted: "--flipper-text-muted",
  textSubtle: "--flipper-text-subtle",
  win: "--flipper-win",
  loss: "--flipper-loss",
};

/** Every custom property the widget reads. */
export const THEME_VARS = [
  ...Object.values(COLOR_VARS),
  "--flipper-radius",
  "--flipper-font",
  "--flipper-font-display",
  "--flipper-font-mono",
  "--flipper-coin-size",
  "--flipper-shadow",
  "--flipper-border-width",
  "--flipper-max-width",
  "--flipper-backdrop",
] as const;

/** The flipper palettes (what the widget looks like with no theme): deep ocean (dark) and a daylight lagoon (light). */
export const PALETTES: Record<"dark" | "light", FlipperColors> = {
  dark: {
    accent: "#4cc2ff",
    accentText: "#031a2b",
    background: "#0a1b26",
    surface: "#0e2230",
    field: "#13293a",
    border: "#cdeeff17",
    text: "#eaf6fb",
    textMuted: "#eaf6fb99",
    textSubtle: "#eaf6fb66",
    win: "#f5c451",
    loss: "#ff6b5e",
  },
  light: {
    accent: "#0a6aa2",
    accentText: "#ffffff",
    background: "#ffffff",
    surface: "#f5f9fc",
    field: "#eef4f8",
    border: "#0e3a5a1c",
    text: "#0b2239",
    textMuted: "#0b2239a6",
    textSubtle: "#0b223980",
    win: "#946200",
    loss: "#c7372c",
  },
};

/** Normalises the `theme` option (a mode string, a JSON string from an attribute, or an object). */
export function parseTheme(v: unknown): FlipperTheme {
  if (!v) return {};
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "light" || s === "dark" || s === "auto") return { mode: s };
    if (s.startsWith("{")) {
      try {
        return parseTheme(JSON.parse(s));
      } catch {
        return {};
      }
    }
    return {};
  }
  return typeof v === "object" ? (v as FlipperTheme) : {};
}

export function resolveMode(mode: FlipperThemeMode | undefined, prefersDark: boolean): "light" | "dark" {
  if (mode === "light" || mode === "dark") return mode;
  return prefersDark ? "dark" : "light";
}

const px = (v: number | string) => (typeof v === "number" ? `${v}px` : v);

/**
 * Custom properties for a theme in the resolved mode, as inline declarations for the host element. Unset fields are
 * omitted, so host CSS (or the defaults) applies to them.
 */
export function themeVars(theme: FlipperTheme, mode: "light" | "dark"): Record<string, string> {
  const out: Record<string, string> = {};
  const colors: Partial<FlipperColors> = { ...pickColors(theme), ...(mode === "dark" ? theme.dark : theme.light) };
  for (const [k, v] of Object.entries(colors) as [keyof FlipperColors, string | undefined][]) {
    // own colour keys only (a theme parsed from JSON can carry "__proto__")
    if (typeof v === "string" && v.trim() && Object.prototype.hasOwnProperty.call(COLOR_VARS, k)) out[COLOR_VARS[k]] = v.trim();
  }
  if (colors.accent && !colors.accentText) {
    const ink = inkFor(colors.accent);
    if (ink) out["--flipper-accent-text"] = ink;
  }
  if (theme.radius !== undefined && theme.radius !== null && theme.radius !== "") out["--flipper-radius"] = px(theme.radius);
  if (theme.fontFamily && theme.fontFamily !== "inherit") out["--flipper-font"] = theme.fontFamily;
  if (theme.displayFontFamily) out["--flipper-font-display"] = theme.displayFontFamily;
  if (theme.monoFontFamily) out["--flipper-font-mono"] = theme.monoFontFamily;
  if (theme.coinSize) out["--flipper-coin-size"] = px(theme.coinSize);
  if (theme.shadow) out["--flipper-shadow"] = theme.shadow;
  if (theme.borderWidth !== undefined) out["--flipper-border-width"] = px(theme.borderWidth);
  if (theme.maxWidth !== undefined) out["--flipper-max-width"] = px(theme.maxWidth);
  return out;
}

function pickColors(t: FlipperTheme): Partial<FlipperColors> {
  const out: Partial<FlipperColors> = {};
  for (const k of Object.keys(COLOR_VARS) as (keyof FlipperColors)[]) if (t[k]) out[k] = t[k];
  return out;
}

/** "#4cc2ff" / "4cc2ff" / "rgb(76 194 255)" → [r, g, b] (0–255); null for anything else. */
export function parseColor(c: string): [number, number, number] | null {
  const s = c.trim().toLowerCase();
  const hex = s.startsWith("#") ? s.slice(1) : /^[0-9a-f]{3,8}$/.test(s) ? s : null;
  if (hex && /^[0-9a-f]+$/.test(hex)) {
    if (hex.length === 3 || hex.length === 4) return [0, 1, 2].map((i) => parseInt(hex[i]! + hex[i]!, 16)) as [number, number, number];
    if (hex.length === 6 || hex.length === 8) return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
    return null;
  }
  const m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

/** Normalises a user colour: bare hex gets its "#", anything else passes through. */
export function normalizeColor(c: string | undefined | null): string | undefined {
  if (!c) return undefined;
  const s = String(c).trim();
  if (/^[0-9a-fA-F]{3,8}$/.test(s)) return `#${s}`;
  return s || undefined;
}

/** Dark or light text for a background colour (WCAG relative luminance); null when the colour can't be parsed. */
export function inkFor(background: string): string | null {
  const rgb = parseColor(background) ?? computedRgb(background);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // contrast against near-black (#07130f, L≈0.005) vs white (L=1): pick the larger
  return (L + 0.05) / 0.055 >= 1.05 / (L + 0.05) ? "#07130f" : "#ffffff";
}

function computedRgb(c: string): [number, number, number] | null {
  if (typeof document === "undefined" || !document.body) return null;
  const el = document.createElement("i");
  el.style.color = c;
  if (!el.style.color) return null;
  el.style.display = "none";
  document.body.appendChild(el);
  const v = getComputedStyle(el).color;
  el.remove();
  return parseColor(v);
}
