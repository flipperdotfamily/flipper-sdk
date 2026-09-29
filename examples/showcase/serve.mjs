#!/usr/bin/env node
// The examples showcase server: ONE small static server (no dependencies) for every example's production build.
//
//   /                  the showcase index (showcase/index.html)
//   /vanilla/ …/next/  each example's build output
//   /cdn/              the widget's CDN build (widget/dist/cdn): what the plain-HTML example's <script> loads
//   /_showcase/kit.js  the runtime kit (stack + dev wallet), see kit/index.ts
//   /stack.json        where the running stack is: the web app (its /embed/deployment.json has the chain, RPC, API
//                      and addresses) and, on a local fork only, the dev wallet's key
//
// Env: EXAMPLES_PORT (3100), FLIPPER_WEB_URL (http://localhost:3000), DEV_WALLET_KEY (an anvil test key),
// DEV_WALLET_LABEL. Binds to loopback only.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const examples = resolve(here, "..");
const repo = resolve(examples, ".."); // the SDK repo root: one directory per package
const port = Number(process.env.EXAMPLES_PORT || 3100);
const webUrl = (process.env.FLIPPER_WEB_URL || "http://localhost:3000").replace(/\/$/, "");
const devKey = /^0x[0-9a-fA-F]{64}$/.test(process.env.DEV_WALLET_KEY || "") ? process.env.DEV_WALLET_KEY : null;

/** URL prefix → build output directory. */
const APPS = {
  vanilla: join(examples, "vanilla-html/dist"),
  react: join(examples, "react-vite/dist"),
  vue: join(examples, "vue-vite/dist"),
  svelte: join(examples, "svelte-vite/dist"),
  angular: join(examples, "angular/dist/browser"),
  next: join(examples, "nextjs-app-router/out"),
  cdn: join(repo, "widget/dist/cdn"),
  _showcase: join(here, "dist"),
};

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

const isLoopback = (url) => {
  try {
    return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

// Only hand out the dev key while the web app's chain is a local fork (checked against its manifest, cached briefly).
let forkCheck = { at: 0, local: false };
async function stackIsLocal() {
  if (Date.now() - forkCheck.at < 5_000) return forkCheck.local;
  let local = false;
  try {
    const m = await (await fetch(`${webUrl}/embed/deployment.json`, { signal: AbortSignal.timeout(4_000) })).json();
    const d = m.deployments?.[String(m.default)];
    local = !!d && isLoopback(d.rpcUrl);
  } catch {
    /* web app down: no dev wallet */
  }
  forkCheck = { at: Date.now(), local };
  return local;
}

async function stackJson() {
  const local = devKey ? await stackIsLocal() : false;
  return {
    webUrl,
    deploymentUrl: `${webUrl}/embed/deployment.json`,
    embedUrl: `${webUrl}/embed`,
    widgetScriptUrl: "/cdn/flipper-widget.js",
    devWallet: local ? { privateKey: devKey, label: process.env.DEV_WALLET_LABEL || "anvil test key" } : null,
  };
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function sendFile(res, file, method) {
  const type = TYPES[extname(file)] ?? "application/octet-stream";
  // hashed assets can be cached; pages and the kit always revalidate
  const immutable = /[.-][A-Za-z0-9_-]{8,}\.(js|css|woff2|png|svg)$/.test(file) && !file.endsWith("kit.js");
  res.writeHead(200, {
    "content-type": type,
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "x-content-type-options": "nosniff",
  });
  if (method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}

/** A file under `root` for `rel`, trying rel, rel/index.html and rel.html; null when there's none. */
function lookup(root, rel) {
  const base = resolve(root);
  const target = resolve(base, normalize(rel).replace(/^([/\\])+/, ""));
  if (target !== base && !target.startsWith(base + sep)) return null;
  for (const f of [target, join(target, "index.html"), `${target}.html`]) {
    try {
      if (statSync(f).isFile()) return f;
    } catch {
      /* next */
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = decodeURIComponent(url.pathname);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "method not allowed");

    if (path === "/stack.json") return send(res, 200, JSON.stringify(await stackJson(), null, 2), "application/json");
    if (path === "/" || path === "/index.html") return sendFile(res, join(here, "index.html"), req.method);
    if (path === "/favicon.ico" || path === "/favicon.svg") return sendFile(res, join(here, "favicon.svg"), req.method);

    const [, app, ...rest] = path.split("/");
    const root = APPS[app];
    if (!root) return send(res, 404, "not found");
    if (rest.length === 0) {
      res.writeHead(308, { location: `/${app}/${url.search}` });
      return res.end();
    }
    if (!existsSync(root)) return send(res, 503, `/${app}/ isn't built yet (dev.sh builds it; see logs/examples.log)`);
    const rel = rest.join("/");
    const file = lookup(root, rel || "index.html");
    if (file) return sendFile(res, file, req.method);
    // client-side routes: the app's page (never for missing assets)
    if (!extname(rel) && app !== "cdn" && app !== "_showcase") {
      const index = lookup(root, "index.html");
      if (index) return sendFile(res, index, req.method);
    }
    return send(res, 404, "not found");
  } catch (e) {
    return send(res, 500, String(e?.message ?? e));
  }
});

server.on("error", (e) => {
  console.error(e?.code === "EADDRINUSE" ? `examples showcase: port ${port} is already in use (set EXAMPLES_PORT to a free port)` : `examples showcase: ${e?.message ?? e}`);
  process.exit(1);
});
server.listen(port, "127.0.0.1", () => console.log(`examples showcase: http://localhost:${port}  (web app: ${webUrl})`));
// localhost may resolve to ::1 first; answer there too when the machine has IPv6 loopback
createServer((req, res) => server.emit("request", req, res))
  .on("error", () => {})
  .listen(port, "::1");
