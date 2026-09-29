import { FlipperWidget } from "./element";

/** Registers the element under `tag` (default "flipper-widget"). Safe to call more than once; a no-op without DOM. */
export function defineFlipperWidget(tag = "flipper-widget"): void {
  if (typeof customElements === "undefined" || customElements.get(tag)) return;
  customElements.define(tag, tag === "flipper-widget" ? FlipperWidget : class extends FlipperWidget {});
}
