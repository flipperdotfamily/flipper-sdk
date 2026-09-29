# Changesets

The npm packages (`@flipperdotfamily/sdk`, `@flipperdotfamily/widget`, `@flipperdotfamily/react`, `@flipperdotfamily/vue`, `@flipperdotfamily/svelte`,
`@flipperdotfamily/angular`, `@flipperdotfamily/react-native`) are released with [changesets](https://github.com/changesets/changesets)
and versioned together (a "fixed" group): a partner who installs `@flipperdotfamily/react@0.4.2` gets `@flipperdotfamily/widget@0.4.2`.

1. `pnpm changeset`: describe your change and pick patch / minor / major. It writes a markdown file here; commit it
   with the PR.
2. On `main`, the Release workflow (`.github/workflows/release.yml`) opens a "Version Packages" PR that bumps the
   versions and writes the CHANGELOGs.
3. Merging that PR publishes to npm with provenance (npm trusted publishing, OIDC; no token in the repo).

The embed bridge protocol has its own version (`BRIDGE.md`, `v: 1`). Bump it only for breaking protocol changes,
together with the mobile SDKs (Flutter, iOS and Android release from their own directories).
