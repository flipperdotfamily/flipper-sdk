/**
 * `@flipperdotfamily/widget/element`: the class without registering it, for custom tag names or scoped registries.
 *
 * ```ts
 * import { FlipperWidget } from "@flipperdotfamily/widget/element";
 * customElements.define("acme-flip", class extends FlipperWidget {});
 * ```
 */
export * from "./exports";
export { defineFlipperWidget } from "./define";
