#!/usr/bin/env node
// Publishes every public workspace package whose version isn't on npm yet: `pnpm pack` (which rewrites
// `workspace:` ranges to real versions), then `npm publish <tarball>`. In CI (the Release workflow) with `--provenance`:
// npm ≥ 11.5.1 authenticates with the workflow's OIDC token (npm trusted publishing, no NPM_TOKEN). Prints "New tag:"
// lines for changesets/action.
//
//   node .github/scripts/publish-packages.mjs [--dry-run] [--local]      (from this repo's root)
//
// --local: the first release, from flipper's launch script (contracts/script/mainnet.sh release): no provenance (npm
// only generates it in CI). npm authenticates with its own config: the launch script's NPM_ACCESS_TOKEN, or your
// `npm login` (then npm asks for your 2FA code on each publish). Packages go out in dependency order
// (the SDK, then the widget, then the framework wrappers), so a failure never leaves one pointing at a missing release.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCOPE = "@flipperdotfamily/";
const FIRST = [`${SCOPE}sdk`, `${SCOPE}widget`];

const root = new URL("../..", import.meta.url).pathname; // the repository root: one directory per package
const out = mkdtempSync(join(tmpdir(), "flipper-pack-"));
const dryRun = process.argv.includes("--dry-run");
const local = process.argv.includes("--local");
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", ...opts });

const pkgs = readdirSync(root)
  .map((d) => join(root, d))
  .filter((d) => existsSync(join(d, "package.json")))
  .map((dir) => ({ dir, pkg: JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) }))
  .filter(({ pkg }) => !pkg.private && pkg.name?.startsWith(SCOPE))
  .sort((a, b) => {
    const ra = FIRST.indexOf(a.pkg.name), rb = FIRST.indexOf(b.pkg.name);
    return (ra < 0 ? FIRST.length : ra) - (rb < 0 ? FIRST.length : rb) || a.pkg.name.localeCompare(b.pkg.name);
  });

let published = 0;
for (const { dir, pkg } of pkgs) {
  let onNpm = false;
  try {
    onNpm = run("npm", ["view", `${pkg.name}@${pkg.version}`, "version"], { stdio: ["ignore", "pipe", "ignore"] }).trim() === pkg.version;
  } catch {
    onNpm = false; // 404: never published
  }
  if (onNpm) {
    console.log(`skip ${pkg.name}@${pkg.version} (already on npm)`);
    continue;
  }
  const tgz = run("pnpm", ["pack", "--pack-destination", out], { cwd: dir }).trim().split("\n").pop();
  const tag = /-/.test(pkg.version) ? "next" : "latest";
  const args = ["publish", tgz, "--access", "public", "--tag", tag];
  args.push(local ? "--provenance=false" : "--provenance");
  if (dryRun) args.push("--dry-run");
  run("npm", args, { stdio: "inherit" }); // inherits stdin: npm asks for the 2FA code here
  published++;
  console.log(`New tag: ${pkg.name}@${pkg.version}`);
}
console.log(`${dryRun ? "would publish" : "published"} ${published} of ${pkgs.length} package(s)`);
