---
name: flipper-sdk
description: Set up flipper.family coin flips in a web or mobile app. Installs @flipperdotfamily/widget or a framework wrapper (React, Next.js, Vue, Svelte, Angular, React Native, Flutter, iOS, Android) or the headless @flipperdotfamily/sdk, wires it to the app's existing wallet (wagmi, viem, ethers, RainbowKit, Reown AppKit, Privy, Dynamic…), applies theming / white-label, and handles flip events. Use when the user asks to add flipper, a coin flip, the flipper widget, or $FLIPPER to their app.
---

# flipper.family: SDK and drop-in widget

flipper.family is a coin-flip protocol. Players flip listed tokens (Uniswap v4 and v3 routes, or native ETH via WETH)
against a $FLIPPER house bankroll, and Dice Protocol's DiceEntropy supplies the verifiable randomness that settles each
flip. **Robinhood Chain 4663** is the launch chain, for its deeper liquidity and more eligible tokens, and the default
everywhere (SDK, widgets, mobile). A local dev fork is **31337**. At launch the listed tokens are the majors (ETH,
USDG, cbBTC), Robinhood stock tokens and a curated set of Robinhood Chain tokens (PONS, ORBIO, INDEX, SHROOM, DICE).

You will almost always integrate the **widget**. It is `<flipper-widget>`, a web component (Lit, Shadow DOM) with
typed wrappers for each framework. Native apps use the hosted embed page (`https://flipper.family/embed`) in a
WebView. Whichever you use, **the host app owns the wallet**. The widget never ships a wallet modal and never holds
keys. It reads chain state through its own RPC and only asks the wallet to sign transactions.

## Workflow

### 1. Detect the stack

Read the project before you write anything:
- **Package manager** (from the lockfile): `pnpm-lock.yaml` means pnpm, `yarn.lock` yarn, `bun.lock` / `bun.lockb`
  bun, and `package-lock.json` npm. In a monorepo, find the package that renders the target page.
- **Framework**: look in `package.json` for `next`, `react` (+ `vite` / `@remix-run/*`), `vue` / `nuxt`,
  `svelte` / `@sveltejs/kit`, `@angular/core` (check the version), `solid-js`, `preact`, `lit`, `@builder.io/qwik`,
  `astro`, `react-native` / `expo`. Native projects have `pubspec.yaml` (Flutter), `Package.swift` / `*.xcodeproj` /
  `Podfile` (iOS), or `build.gradle(.kts)` (Android).
- **Wallet stack**: `wagmi` / `@wagmi/core` / `@wagmi/vue`, `viem`, `ethers`, `@rainbow-me/rainbowkit`,
  `connectkit`, `@reown/appkit` (formerly `@web3modal/*`), `@privy-io/*`, `@dynamic-labs/*`, `thirdweb`,
  `@web3-onboard/*`. Find the wallet config (the chains list) and the code that opens the connect modal.
- **Also note**: SSR (Next, Nuxt, SvelteKit, Angular SSR, Astro, Remix), the router, TS vs JS, the build and
  typecheck scripts, a CSP (in `next.config.*`, middleware, `<meta http-equiv>`, or server headers), and the design
  tokens (Tailwind / shadcn CSS variables, a theme provider, the dark-mode mechanism).

### 2. Pick the package

| Host | Package | Read |
|---|---|---|
| Plain HTML, no build step | CDN `<script>` (or `@flipperdotfamily/widget`) | [vanilla.md](references/vanilla.md) |
| React (Vite, Remix, CRA) | `@flipperdotfamily/react` | [react.md](references/react.md) |
| Next.js (App or Pages Router) | `@flipperdotfamily/react` | [react.md](references/react.md) + [nextjs.md](references/nextjs.md) |
| Vue 3 / Nuxt 3 | `@flipperdotfamily/vue` | [vue.md](references/vue.md) |
| Svelte 5 / SvelteKit | `@flipperdotfamily/svelte` | [svelte.md](references/svelte.md) |
| Angular 17+ | `@flipperdotfamily/angular` | [angular.md](references/angular.md) |
| Solid, Preact, Lit, Qwik, Astro, Alpine, jQuery; Vue 2, Svelte 4, Angular < 17 | `@flipperdotfamily/widget` directly | [vanilla.md](references/vanilla.md) |
| React Native / Expo | `@flipperdotfamily/react-native` (widget, or its headless hooks) | [react-native.md](references/react-native.md) |
| Flutter | `flipper_family` | [flutter.md](references/flutter.md) |
| iOS (SwiftUI / UIKit) | Swift package `FlipperWidget` | [ios.md](references/ios.md) |
| Android (Compose / Views) | `family.flipper:widget` | [android.md](references/android.md) |
| Custom UI, bot, backend script | `@flipperdotfamily/sdk` + `viem` | [headless-sdk.md](references/headless-sdk.md) |
| Untrusted or isolated page, strict CSP, no bundler control | iframe embed + `@flipperdotfamily/widget/host` | [iframe-bridge.md](references/iframe-bridge.md) |

Cross-cutting references: [theming.md](references/theming.md), [events.md](references/events.md) and
[troubleshooting.md](references/troubleshooting.md).

### 3. Install

Install with the project's own package manager, for example `pnpm add @flipperdotfamily/react`, `yarn add @flipperdotfamily/vue`,
`npm i @flipperdotfamily/widget` or `bun add @flipperdotfamily/svelte`. Every wrapper depends on `@flipperdotfamily/widget`, which brings `lit`,
`viem` and `@flipperdotfamily/sdk`. If you import types from `@flipperdotfamily/widget` (`FlipperEventMap`, `FlipperTheme`,
`Eip1193Provider`), add it as a direct dependency at the same version the wrapper uses; strict pnpm needs this. The
headless SDK is `@flipperdotfamily/sdk viem`.

### 4. Wire the wallet (the host owns it)

- Pass the **connected** wallet as `provider` (any EIP-1193 provider) or `walletClient` (a viem `WalletClient`
  **with an `account`**). Pass `null` / `undefined` while disconnected: the widget then runs read-only, showing
  prices, odds and tokens, and its button reads "Connect wallet".
- On `connect-request`, open the app's **existing** connect modal. Don't pass `window.ethereum` if the app has its
  own modal: pass the provider of the wallet the user actually connected.
- Add Robinhood Chain (4663; viem's `robinhood` from `viem/chains`, in viem 2.55 or newer) to the app's wallet config:
  wagmi `chains` + `transports`, AppKit `networks`, or Privy `supportedChains`. If it's missing, wagmi drops its
  wallet client after the switch and the widget falls back to "Connect wallet".

| Stack | Pass | `connect-request` opens |
|---|---|---|
| wagmi (React) | `walletClient={useWalletClient().data}` | the app's modal |
| RainbowKit | same as wagmi | `useConnectModal().openConnectModal?.()` |
| ConnectKit | same as wagmi | `useModal().setOpen(true)` |
| Reown AppKit (React) | `provider={useAppKitProvider("eip155").walletProvider}`, or the wagmi row with the Wagmi adapter | `useAppKit().open()` |
| Privy | the wagmi row with `@privy-io/wagmi`, else `provider` = `await wallet.getEthereumProvider()` | `usePrivy().login()` |
| Dynamic | the wagmi row with `@dynamic-labs/wagmi-connector` | `useDynamicContext().setShowAuthFlow(true)` |
| `@wagmi/core` (Vue, Svelte, Angular, vanilla) | `provider` from `connector.getProvider()`, kept in sync with `watchAccount` (a helper is in each reference) | the app's modal (`modal.open()` for AppKit) |
| ethers v5 / v6 | the raw EIP-1193 object the app wraps (`new BrowserProvider(x)`: pass `x`), never an ethers Provider or Signer | the app's modal |
| viem only | the `WalletClient` (with `account`), or the EIP-1193 object behind its `custom()` transport | the app's modal |
| Injected only, no library | `window.ethereum` (or an EIP-6963 provider) | nothing: the widget asks `eth_requestAccounts` itself |

Each framework reference has complete code for its usual stacks.

### 5. Configure theme, white label and attribution

Ask the user for these, or infer them from the design tokens and confirm:
- `partner`: the attribution id (`[A-Za-z0-9._:-]{1,64}`). Ask for it. If the user has none, omit it and say so.
  A partner code registered in flipper's PartnerRegistry (1–32 of `a-z 0-9 _ -`; anyone can register one, no approval) is also attributed
  onchain: the widget appends its ERC-8021 suffix to every flip, so the partner earns its share of attributed flips and
  its players get its odds (the preview shows them). Other values stay offchain only (events, analytics header).
- Look: `theme` mode (`"auto"` follows the OS; apps with a manual dark toggle must pass `"light"` / `"dark"`),
  `accent`, `radius`, `fontFamily: "inherit"`, `variant` (`card` / `compact` / `button`).
- White label: `branding={false}`, `brandName`, `brandLogo`, `coinImage` / `coinImageTails`, and `strings`.
- Tokens: `mode` (`"picker"` by default; `"single"` fixes one token, needs `token`, and removes the picker
  entirely), `token` (default $FLIPPER), a `tokens` allowlist for the picker, `eth`, `listing`, `minAmount` /
  `maxAmount`, and `approval` (`"max"` by default, or `"exact"`). `hidePicker` is deprecated: use `mode="single"`.
- Size: nothing to do for a responsive page (it adapts to its container from ~240 px to 1200+ px). For a fixed box
  (a sidebar, a tile, a fixed-height iframe) use `fit="fill"` and give the element a height. `size`
  (`sm` / `md` / `lg`) scales everything.
- What it shows: by default only the coin, the amount with a small balance line, and the button. There's no headline
  and no odds/fee line. A quiet "↓ Odds 0.9 pts below usual" appears only when fees trim the odds. Opt in with
  `details` (win chance, payout and fee under the button) and `tagline` (`true` for the built-in headline, or your
  own text). Only add them if the user asks for that information.
- Chain: leave the default (4663, Robinhood Chain).

Set objects (`provider`, `walletClient`, `theme` objects, `strings`, `addresses`, `tokens`) as **properties or
props**, never as HTML attributes. Hoist constant objects out of render functions: a new `addresses` object on every
render makes the widget reload its deployment. Details: [theming.md](references/theming.md).

### 6. Add event handlers

The events are `ready`, `connect-request`, `flip-requested`, `flip-settled`, `payout-resolved`, `listing`, `error`
and `resize`. Typical uses:
- `flip-settled`: analytics, a toast, refetching the app's balances. It can arrive **twice** for a `WinPending` flip
  (`pending: true`, then the final one), so de-duplicate by `flipId`. `WinPending` means the stake came back but the
  winnings are still owed; the widget shows them with a **Retry payout** button.
- `payout-resolved`: fires once when a pending win's winnings are paid, alongside the final `flip-settled`.
- `error`: log it. Its `message` is plain English and safe to show. Skip toasts for `code: "user-rejected"`.
- `listing`: refresh the app's token lists after `stage: "listed"`.

Events don't bubble: listen on the element, or use the wrapper's callbacks. Amounts are wei as decimal strings.
Payloads and recipes: [events.md](references/events.md).

### 7. Verify

Run the project's own scripts, for example `pnpm typecheck` / `tsc --noEmit`, `vue-tsc --noEmit`,
`npm run check` (SvelteKit), `ng build`, `next build`, and the linter. Then check, or ask the user to check:
- [ ] The widget renders on the target page, and there are no console errors.
- [ ] With no wallet connected, it is read-only (odds, prices, token picker) and the button reads "Connect wallet".
- [ ] "Connect wallet" opens the **app's** modal, and after connecting the widget shows the account and balances.
- [ ] With the wallet on another chain, the button reads "Switch to <chain>" and switching works.
- [ ] A test flip succeeds, on the local fork or with a small amount, and `flip-settled` handlers fire once.
- [ ] No CSP violations (script, `connect-src` for the RPC / API / manifest, `img-src` for logos).
- [ ] SSR pages render without "window is not defined" and without hydration errors.
- [ ] The layout holds at 320 px wide (the widget itself goes down to 280 px) and in dark mode.

### 8. Common pitfalls

These are covered in [troubleshooting.md](references/troubleshooting.md):
- The widget is stuck on "Loading…", or shows "Not live on this network yet" (RPC, manifest, CSP or chain id).
- Objects were set as attributes (`provider="[object Object]"`), or React 18 was used without the wrapper.
- A wagmi app is missing Robinhood Chain (4663) in its config, so the widget drops back to "Connect wallet" after a
  switch.
- Vue or Svelte deep-proxies the provider. Use `shallowRef` / `markRaw` or `$state.raw`.
- Angular handlers run twice when both `(flipSettled)` and `(flip-settled)` are bound.
- `flip-settled` is counted twice (not de-duplicated by `flipId`).
- The iframe doesn't resize (origin checks, `hostOrigin`), or a WebView bridge gets no messages.

## Local development (the flipper repo's `./dev.sh`)

`./dev.sh` runs the web app on :3000, an anvil fork of Robinhood Chain on :8545 (chain id **31337**), the API and
the keeper, which settles the randomness.
- Web widget: `chain-id="local"` plus `deployment-url="http://localhost:3000/embed/deployment.json"` (React:
  `chainId={31337}` `deploymentUrl="http://localhost:3000/embed/deployment.json"`). Alternatively, pin everything:
  `rpcUrl="http://127.0.0.1:8545"`, `apiUrl={null}`, and `addresses={{ house, lens }}` taken from
  `contracts/deployments/local.json` (`contracts.house`, `contracts.lens`).
- iframe: `mountFlipperIframe({ embedUrl: "http://localhost:3000/embed", params: { chain: "local" }, … })`.
- Mobile: each mobile reference has its own local-dev section (`10.0.2.2` on the Android emulator).
- The wallet must be on chain 31337 with the RPC `http://127.0.0.1:8545`. Run the host app on a port other than 3000.
- Gate all of this behind an env flag (`VITE_FLIPPER_LOCAL`, `NEXT_PUBLIC_FLIPPER_LOCAL`…). Never ship localhost
  URLs.

## Mobile

Native and React Native apps embed the hosted page and lend it the app's wallet over the bridge protocol
([iframe-bridge.md](references/iframe-bridge.md) covers the protocol). Follow the platform reference:
[react-native.md](references/react-native.md), [flutter.md](references/flutter.md),
[ios.md](references/ios.md) and [android.md](references/android.md).

## Never

- Never add a second wallet modal or wallet library. Reuse the app's own, even if it takes more wiring.
- Never ask for, log, store or paste private keys or seed phrases, and never write code that signs without the
  wallet's own confirmation (no "one-tap" auto-approve).
- Never set objects as attributes, and never stringify a provider.
- Never hard-code house / lens / adapter addresses unless the user explicitly wants pinning. The live manifest is
  the source of truth.
- Never load both the CDN script and the npm package on the same page.
- Never edit the widget's internals or shadow DOM. Use the options, CSS variables and `::part()`.
