#!/usr/bin/env node
// Single-file builds for <script> tags and the hosted /embed page (everything bundled, minified).
//   dist/cdn/flipper-widget.js      IIFE: registers <flipper-widget>, global `FlipperWidget` (the module's exports)
//   dist/cdn/flipper-widget.esm.js  the same as an ES module (<script type="module">)
//   dist/cdn/flipper-embed.js       IIFE: the /embed page runtime (widget + bridge), boots itself
//   dist/cdn/flipper-host.js        IIFE: iframe host helper, global `FlipperEmbedHost`
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist/cdn");
mkdirSync(out, { recursive: true });
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const banner = `/*! @flipperdotfamily/widget ${pkg.version} | MIT | https://flipper.family/docs/integrate */`;

// viem's estimateGas can recover EIP-7702 authorization signers, which pulls in secp256k1 (~30 KB). The widget never
// sends authorization lists, so the CDN bundle gets a stub that throws if it's ever reached.
const stubCurves = {
  name: "stub-secp256k1",
  setup(b) {
    b.onResolve({ filter: /^@noble\/curves\/secp256k1(\.js)?$/ }, () => ({ path: "secp256k1-stub", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "const no = () => { throw new Error('secp256k1 is not included in the @flipperdotfamily/widget CDN build'); }; export const secp256k1 = new Proxy({}, { get: no });",
      loader: "js",
    }));
  },
};

// Lit's css`` templates aren't touched by the JS minifier: strip comments and whitespace from them.
const minifyCss = {
  name: "minify-lit-css",
  setup(b) {
    b.onLoad({ filter: /src[\\/]styles\.ts$/ }, async (args) => {
      const { readFile } = await import("node:fs/promises");
      const text = await readFile(args.path, "utf8");
      const contents = text.replace(/css`([\s\S]*?)`/g, (_, body) =>
        "css`" +
        body
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\s+/g, " ")
          .replace(/\s*([{};,>])\s*/g, "$1")
          .replace(/;}/g, "}")
          .trim() +
        "`",
      );
      return { contents, loader: "ts" };
    });
  },
};

const common = {
  plugins: [stubCurves, minifyCss],
  bundle: true,
  minify: true,
  sourcemap: true,
  target: ["es2020", "safari15", "chrome90", "firefox90"],
  legalComments: "none",
  banner: { js: banner },
  logLevel: "warning",
  define: { "process.env.NODE_ENV": '"production"' },
  // viem pulls in optional pieces (e.g. ws transports) the widget never reaches; keep the bundle lean
  conditions: ["browser", "module", "import"],
  mainFields: ["browser", "module", "main"],
};

const jobs = [
  { entryPoints: [join(root, "src/index.ts")], outfile: join(out, "flipper-widget.js"), format: "iife", globalName: "FlipperWidget" },
  { entryPoints: [join(root, "src/index.ts")], outfile: join(out, "flipper-widget.esm.js"), format: "esm" },
  { entryPoints: [join(root, "scripts/embed-boot.ts")], outfile: join(out, "flipper-embed.js"), format: "iife" },
  { entryPoints: [join(root, "src/host/index.ts")], outfile: join(out, "flipper-host.js"), format: "iife", globalName: "FlipperEmbedHost" },
];
const sizes = {};
for (const j of jobs) {
  await build({ ...common, ...j });
  const buf = readFileSync(j.outfile);
  const name = j.outfile.slice(out.length + 1);
  sizes[name] = { raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length, brotli: brotliCompressSync(buf).length };
}
writeFileSync(join(out, "sizes.json"), JSON.stringify(sizes, null, 2) + "\n");
for (const [n, s] of Object.entries(sizes)) console.log(`cdn: ${n.padEnd(24)} ${(s.raw / 1024).toFixed(1).padStart(7)} KB  gzip ${(s.gzip / 1024).toFixed(1).padStart(6)} KB  br ${(s.brotli / 1024).toFixed(1).padStart(6)} KB`);
