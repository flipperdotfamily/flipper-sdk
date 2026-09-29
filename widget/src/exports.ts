// Everything public except the auto-registration (shared by the "." and "./element" entries).
export { FlipperWidget } from "./element";
export { VERSION, type WidgetToken } from "./controller";
export { en, es, LOCALES, stringsFor, fmt, type FlipperStrings } from "./strings";
export { COLOR_VARS, PALETTES, THEME_VARS, inkFor, normalizeColor, parseTheme, resolveMode, themeVars } from "./theme";
export {
  FLIPPER_EVENTS,
  onFlipperEvent,
  type FlipperColors,
  type FlipperDensity,
  type FlipperFit,
  type FlipperMode,
  type FlipperSize,
  type FlipperEventMap,
  type FlipperEventName,
  type FlipperTheme,
  type FlipperThemeMode,
  type FlipperVariant,
  type FlipperWidgetConfig,
  type WalletClientLike,
} from "./types";
export type { Eip1193Provider } from "@flipperdotfamily/sdk";
