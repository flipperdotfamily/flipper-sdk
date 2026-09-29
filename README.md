# flipper.family SDK

The developer packages for [flipper.family](https://flipper.family): coin flips on whitelisted tokens on Robinhood
Chain, settled by verifiable randomness against a $FLIPPER house bankroll. Integration guide:
[flipper.family/docs/integrate](https://flipper.family/docs/integrate).

| Package | What |
|---|---|
| [`@flipperdotfamily/sdk`](sdk) | headless TypeScript SDK (viem): deployments, flips, odds, token discovery, holder rewards, ABIs |
| [`@flipperdotfamily/widget`](widget) | the drop-in flip widget: a web component, a CDN build and the hosted-embed bridge |
| [`@flipperdotfamily/react`](react) · [`vue`](vue) · [`svelte`](svelte) · [`angular`](angular) | framework wrappers for the widget |
| [`@flipperdotfamily/react-native`](react-native) | React Native / Expo: the hosted embed plus a headless client |
| [`flipper_family`](flutter) (Dart) · [`FlipperWidget`](ios) (Swift) · [`family.flipper:widget`](android) (Kotlin) | mobile SDKs: the hosted embed in a WebView, with the app's wallet |

Also here: [`examples/`](examples) (vanilla HTML, React, Next.js, Vue, Svelte, Angular) and the
[`flipper-sdk` agent skill](skills/flipper-sdk) that teaches coding agents to add flips to an app.

The contracts are in [flipperdotfamily/flipper-contracts](https://github.com/flipperdotfamily/flipper-contracts).
The SDK ships with the Robinhood Chain (4663) deployment's addresses (`FLIPPER_ADDRESSES`, and the house and lens it
pins in `CANONICAL_DEPLOYMENTS`), written from the deployment manifest before each release.

## Develop

Node ≥ 20.9 and pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm build       # every package, in dependency order
pnpm typecheck
pnpm test
pnpm lint        # publint + arethetypeswrong on what would be published (after build)
```

## Release

The npm packages are versioned together with [changesets](.changeset/README.md): add one with `pnpm changeset`,
and the Release workflow (`.github/workflows/release.yml`) opens a "Version Packages" PR. Merging it publishes to npm
with provenance (npm trusted publishing: no token in the repo).

## License

[MIT](LICENSE)
