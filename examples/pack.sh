#!/usr/bin/env bash
# Packs the local @flipperdotfamily/* packages (built) into examples/.packs/ for the examples workspace.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/.." && pwd)" # the SDK repo root: one directory per package
mkdir -p "$here/.packs"
for pkg in sdk widget react vue svelte angular; do
  dir="$repo/$pkg"
  [ -d "$dir/dist" ] || { echo "$pkg isn't built (pnpm build)"; exit 1; }
  tgz="$(cd "$dir" && pnpm pack --pack-destination "$here/.packs" | tail -1)"
  mv -f "$tgz" "$here/.packs/flipper-$pkg.tgz"
  echo "packed @flipperdotfamily/$pkg → .packs/flipper-$pkg.tgz"
done

# The lockfile pins each tarball's integrity: forget the old ones so the next install picks up the new builds.
for lock in "$here/pnpm-lock.yaml" "$here/node_modules/.pnpm/lock.yaml"; do
  [ -f "$lock" ] && sed -i.bak -E '/flipper-[a-z]+\.tgz/ s/integrity: [^,]+, //' "$lock" && rm -f "$lock.bak"
done
rm -rf "$here"/node_modules/.pnpm/@flipperdotfamily+*
echo "now: pnpm install"
