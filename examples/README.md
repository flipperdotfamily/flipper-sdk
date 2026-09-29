# flipper examples

Runnable integrations of the flipper.family widget, each dressed as a small partner site that shows off a different
part of it. Each one wires the wallet with the usual library for its ecosystem.

| Example | Site | Stack | Wallet | Shows |
|---|---|---|---|---|
| [`vanilla-html`](./vanilla-html) | **Degen Cat Club**, a memecoin community page | one `<script>` tag from the CDN, no build | EIP-6963 discovery | `mode="single"` on the community token, `brand-name` / `brand-logo`, custom coin faces, the community's accent, `tagline` |
| [`react-vite`](./react-vite) | **Lagoon**, a DEX dashboard | React 19 + Vite + `@flipperdotfamily/react` | wagmi 3 (EIP-6963 connectors, own connect modal) | `mode="picker"` with a `tokens` allowlist, the card variant, a `partner` id, `flip-requested` / `flip-settled` feeding toasts and an activity feed |
| [`vue-vite`](./vue-vite) | **Questline**, a gaming rewards hub | Vue 3 + Vite + `@flipperdotfamily/vue` (plugin defaults) | `@wagmi/vue` | `variant="button"` opening the modal, a light theme, custom `strings` |
| [`svelte-vite`](./svelte-vite) | **Folio**, a portfolio tracker | Svelte 5 (runes) + Vite + `@flipperdotfamily/svelte` | `@wagmi/core` | `variant="compact"`, `fit="fill"` and `size="sm"` in a sidebar pane |
| [`angular`](./angular) | **Casa Fortuna**, a white-label casino (Spanish) | Angular 21, standalone + zoneless, `@flipperdotfamily/angular` | an EIP-6963 wallet service | `branding={false}` with its own logo and coin, font, radius and colours via CSS variables and `::part()`, `locale="es"`, `details` |
| [`nextjs-app-router`](./nextjs-app-router) | **The Block Ledger**, a news article | Next.js 16 App Router, static export | wagmi 3 | the iframe embed (`mountFlipperIframe`, `fit: "fill"`) with the host's wallet bridged in; `/ssr/` renders `<FlipperWidget />` server-side |

RainbowKit and ConnectKit still require wagmi 2, so the wagmi examples use wagmi 3's own EIP-6963 connectors with a
small connect modal. Swap in Reown AppKit or WalletConnect as usual.

## The showcase (dev.sh)

`./dev.sh` builds every example as a production build and serves them all from one static server at
http://localhost:3100 (`EXAMPLES_PORT`). The index page links every site.

| Path | Site |
|---|---|
| `/` | the index |
| `/vanilla/` | Degen Cat Club |
| `/react/` | Lagoon |
| `/vue/` | Questline |
| `/svelte/` | Folio |
| `/angular/` | Casa Fortuna |
| `/next/` | The Block Ledger (`/next/ssr/`: the React component page) |

- **Build and serve:** `scripts/dev/examples-showcase.sh`. It rebuilds the web packages if needed and packs them
  into `.packs/`. It then builds each example sequentially, skipping any whose inputs are unchanged (stamps in
  `.showcase/`), and serves them.
  - Only the sites being rebuilt get their dependencies installed, from this one workspace and lockfile.
  - Afterwards it deletes the build caches and, unless `EXAMPLES_KEEP_DEPS=1`, the `node_modules` and their unused
    pnpm store entries. Between rebuilds that leaves only the builds, about 7 MB.
  - Installs and builds wait while the disk has under 2 GB free (`EXAMPLES_MIN_FREE_MB`).
  - `--build-only` builds without serving. dev.sh runs it in the background, logging to `logs/examples.log`, and
    `./dev.sh --no-examples` skips it.
- **Stack:** the sites don't hard-code a chain. They load `/_showcase/kit.js` (`showcase/kit/`), which reads
  `/stack.json`, then the web app's `/embed/deployment.json` for the chain id, RPC, API and addresses. A different dev
  chain needs no rebuild. Outside the showcase that import fails and the sites fall back to flipper.family's
  production defaults.
- **Dev wallet:** on a local fork, the kit announces **Dev wallet (local fork)** through EIP-6963, so every site's
  normal wallet list offers it.
  - It's a viem local account holding the first funded `DEV_ACCOUNTS` key. It signs in the page and sends raw
    transactions to the fork, with no browser extension.
  - `showcase/fund-dev-wallet.mjs` tops it up with the demo sites' tokens on the fork.
  - It never appears when the chain isn't a local fork.

## Run one on its own

The examples are a separate pnpm workspace that installs the packages from local tarballs, exactly as npm would.
You need Node ≥ 20.19 or ≥ 22.12 (Vite 8, Angular 21, Next 16).

```sh
pnpm build                              # from the repo root: builds every package
cd examples
./pack.sh                               # packs them into examples/.packs/
pnpm install
cd react-vite && pnpm build && pnpm preview
```

Outside this repo, replace nothing: each example's `package.json` asks for the published versions
(`"@flipperdotfamily/react": "^0.1.0"`). The tarball overrides only exist in this folder's root `package.json`.
