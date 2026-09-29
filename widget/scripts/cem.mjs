#!/usr/bin/env node
// Writes custom-elements.json (Custom Elements Manifest v2) for IDEs, Storybook and framework tooling.
import { writeFileSync } from "node:fs";

const attrs = [
  ["chain-id", "chainId", "number | \"robinhood\" | \"local\"", "Chain to flip on (default: the manifest's, 4663 Robinhood Chain on flipper.family)"],
  ["rpc-url", "rpcUrl", "string", "Read RPC (default: the chain's public RPC)"],
  ["api-url", "apiUrl", "string | null", "flipper API for the token list and logos; \"none\" for on-chain only"],
  ["deployment-url", "deploymentUrl", "string | null", "Deployment manifest (default https://flipper.family/embed/deployment.json)"],
  ["addresses", "addresses", "object (JSON)", "Contract overrides: house, lens, flipper, v4Adapter, v3Adapter, weth…"],
  ["token", "token", "string", "Token selected at start: an address or \"ETH\" (default $FLIPPER)"],
  ["tokens", "tokens", "string[] (comma list)", "Allowlist of tokens the picker offers"],
  ["mode", "mode", "\"picker\" | \"single\"", "picker (default): the user chooses the token. single: one fixed token (token required), no picker"],
  ["hide-picker", "hidePicker", "boolean", "Deprecated: use mode=\"single\""],
  ["fit", "fit", "\"auto\" | \"fill\"", "auto (default): height follows the content. fill: take the element's full height"],
  ["size", "size", "\"sm\" | \"md\" | \"lg\" | \"auto\"", "Scale on top of the fluid layout"],
  ["details", "details", "boolean", "Show the win chance / payout / fee line under the button (default off)"],
  ["tagline", "tagline", "string | boolean", "Idle headline under the coin: true = the built-in one, a string = your own (default none)"],
  ["eth", "eth", "boolean", "Offer native ETH, flipped as WETH (default true)"],
  ["listing", "listing", "boolean", "Permissionless listing of eligible tokens (default true)"],
  ["min-amount", "minAmount", "string", "Minimum stake in token units"],
  ["max-amount", "maxAmount", "string", "Maximum stake in token units"],
  ["approval", "approval", "\"max\" | \"exact\"", "Allowance to request when short (default max)"],
  ["variant", "variant", "\"card\" | \"compact\" | \"button\"", "Layout (default card)"],
  ["theme", "theme", "\"light\" | \"dark\" | \"auto\" | FlipperTheme (JSON)", "Colour mode or a full theme object"],
  ["accent", "accent", "string", "Accent colour"],
  ["radius", "radius", "number", "Card corner radius in px"],
  ["branding", "branding", "boolean", "false removes the flipper.family marks"],
  ["brand-name", "brandName", "string", "Header name"],
  ["brand-logo", "brandLogo", "string", "Header logo URL"],
  ["coin-image", "coinImage", "string", "Heads face image URL"],
  ["coin-image-tails", "coinImageTails", "string", "Tails face image URL"],
  ["button-label", "buttonLabel", "string", "Trigger label (variant=\"button\")"],
  ["locale", "locale", "string", "Built-in strings: en, es"],
  ["reduced-motion", "reducedMotion", "boolean", "Force reduced motion on or off"],
  ["partner", "partner", "string", "Partner id: echoed in events, sent as X-Flipper-Partner; a registered code (1-32 of a-z 0-9 _ -) is also attributed onchain (ERC-8021 suffix on every flip)"],
];
const propsOnly = [
  ["provider", "Eip1193Provider | null", "The host's wallet (any EIP-1193 provider)"],
  ["walletClient", "WalletClientLike | null", "Or a viem client for the connected account"],
  ["onConnectRequest", "(detail) => void", "Open your wallet UI when the user wants to connect"],
  ["strings", "Partial<FlipperStrings>", "String overrides"],
];
const events = [
  ["ready", "{ version, chainId, account, token, variant, partner }"],
  ["connect-request", "{ reason, partner } (cancelable)"],
  ["flip-requested", "{ flipId, account, token, symbol, decimals, amount, winChanceBps, randomnessFee, txHash, approveTxHash, native, partner }"],
  ["flip-settled", "{ flipId, account, token, symbol, decimals, amount, outcome, status, won, pending, payout, payoutToken, flipperPaid, txHash, requestTxHash, native, partner }"],
  ["payout-resolved", "{ flipId, account, token, symbol, decimals, tokenPaid, flipperPaid, by, native, txHash, partner }"],
  ["listing", "{ stage, token, symbol, venue, txHash, error, partner }"],
  ["error", "{ code, message, context, partner }"],
  ["resize", "{ width, height }"],
];
const parts = ["root", "card", "header", "brand", "account", "coin", "status", "result", "payout", "field", "token-button", "token", "amount-input", "max-button", "balance", "odds", "note", "cta", "details", "footer", "picker", "picker-search", "picker-row", "check", "check-launchpad", "trigger", "modal"];
const cssProps = ["--flipper-accent", "--flipper-accent-text", "--flipper-bg", "--flipper-surface", "--flipper-field", "--flipper-border", "--flipper-text", "--flipper-text-muted", "--flipper-text-subtle", "--flipper-win", "--flipper-loss", "--flipper-check", "--flipper-check-launchpad", "--flipper-radius", "--flipper-font", "--flipper-font-display", "--flipper-font-mono", "--flipper-coin-size", "--flipper-shadow", "--flipper-border-width", "--flipper-max-width", "--flipper-backdrop"];

const decl = {
  kind: "class",
  name: "FlipperWidget",
  tagName: "flipper-widget",
  customElement: true,
  description: "Drop-in flipper.family coin flip. The wallet comes from the host: set `provider` or `walletClient`.",
  superclass: { name: "LitElement", package: "lit" },
  attributes: attrs.map(([name, fieldName, type, description]) => ({ name, fieldName, type: { text: type }, description })),
  members: [
    ...attrs.map(([attribute, name, type, description]) => ({ kind: "field", name, attribute, type: { text: type }, description })),
    ...propsOnly.map(([name, type, description]) => ({ kind: "field", name, type: { text: type }, description })),
    { kind: "method", name: "open", description: "Open the modal (variant=\"button\")" },
    { kind: "method", name: "close", description: "Close the modal" },
    { kind: "method", name: "refresh", description: "Re-read the wallet's accounts and chain, and balances" },
  ],
  events: events.map(([name, detail]) => ({ name, type: { text: `CustomEvent<${detail}>` } })),
  cssParts: parts.map((name) => ({ name })),
  cssProperties: cssProps.map((name) => ({ name })),
};
const manifest = {
  schemaVersion: "2.0.0",
  modules: [
    {
      kind: "javascript-module",
      path: "dist/index.js",
      declarations: [decl],
      exports: [
        { kind: "js", name: "FlipperWidget", declaration: { name: "FlipperWidget", module: "dist/index.js" } },
        { kind: "custom-element-definition", name: "flipper-widget", declaration: { name: "FlipperWidget", module: "dist/index.js" } },
      ],
    },
  ],
};
writeFileSync(new URL("../custom-elements.json", import.meta.url), JSON.stringify(manifest, null, 2) + "\n");
console.log("custom-elements.json written");
