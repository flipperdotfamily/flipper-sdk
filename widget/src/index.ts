/**
 * `@flipperdotfamily/widget`: importing it registers `<flipper-widget>` (in browsers; it's a no-op during SSR).
 *
 * ```ts
 * import "@flipperdotfamily/widget";
 * const w = document.querySelector("flipper-widget")!;
 * w.provider = window.ethereum;                 // any EIP-1193 provider, or w.walletClient = viem WalletClient
 * w.addEventListener("flip-settled", (e) => console.log(e.detail.outcome));
 * ```
 */
import { defineFlipperWidget } from "./define";

export * from "./exports";
export { defineFlipperWidget };

defineFlipperWidget();
