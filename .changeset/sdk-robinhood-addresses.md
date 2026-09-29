---
"@flipperdotfamily/sdk": minor
---

The SDK ships with Robinhood Chain (4663)'s deployment: `FLIPPER_ADDRESSES[4663]` holds its contracts, so
`resolveDeployment()` works there without fetching the manifest, and `CANONICAL_DEPLOYMENTS[4663]` pins its house and
lens (a fetched manifest that disagrees is refused).
