import type { App, Plugin } from "vue";
import { FLIPPER_DEFAULTS, FlipperWidget, type FlipperOptions } from "./FlipperWidget";

/**
 * Registers `<FlipperWidget>` globally, with defaults for every instance:
 *
 * ```ts
 * app.use(FlipperPlugin, { partner: "acme", theme: { mode: "dark", accent: "#ff5a1f" } });
 * ```
 */
export const FlipperPlugin: Plugin<[Partial<FlipperOptions>?]> = {
  install(app: App, defaults: Partial<FlipperOptions> = {}) {
    app.provide(FLIPPER_DEFAULTS, defaults);
    app.component("FlipperWidget", FlipperWidget);
  },
};
