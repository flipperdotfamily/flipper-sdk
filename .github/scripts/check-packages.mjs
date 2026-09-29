#!/usr/bin/env node
// Lints what we'd publish: publint (package.json / exports / files) and arethetypeswrong (types resolve for ESM
// consumers under node16 and bundler resolution). Run after `pnpm build`.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../..", import.meta.url).pathname;
// this repo's own install, or (checked out as flipper's packages/ submodule) the parent workspace's
const bin = (name) => [root, join(root, "..")].map((d) => join(d, "node_modules/.bin", name)).find((p) => existsSync(p)) ?? name;
// the Svelte package ships .svelte source (types are hand-written), the Angular one is ngc output
const PACKAGES = ["sdk", "widget", "react", "vue", "svelte", "angular"];
let failed = false;
for (const p of PACKAGES) {
  const dir = join(root, p);
  if (!existsSync(join(dir, "dist"))) {
    console.error(`${p}: not built`);
    failed = true;
    continue;
  }
  const name = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name;
  console.log(`\n── ${name}`);
  try {
    execFileSync(bin("publint"), ["--strict", dir], { stdio: "inherit" });
  } catch {
    failed = true;
  }
  if (p === "svelte") continue; // attw can't resolve .svelte entry points
  try {
    execFileSync(bin("attw"), ["--pack", dir, "--profile", "esm-only", "--format", "table-flipped"], { stdio: "inherit" });
  } catch {
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
