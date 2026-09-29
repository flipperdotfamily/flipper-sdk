---
"@flipperdotfamily/sdk": minor
---

Add `@flipperdotfamily/sdk/avatar`: deterministic default profile pictures in the flipper.family icon's format. Each address
gets one of 25 flippered animals' silhouettes on a deep-ocean gradient disc, the same one everywhere (33,600
combinations in version 2). `avatarSvg(address, { size, title, idPrefix })`, `avatarDataUri(…)` and
`avatarSpec(address)` work without any dependencies, and a separate subpath keeps them out of the main entry.
