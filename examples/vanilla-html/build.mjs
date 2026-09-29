// No bundler: copy the page and its assets to dist/. FLIPPER_WIDGET_CDN swaps the jsDelivr <script> for another
// copy of the same file (the examples showcase points it at the local build: /cdn/flipper-widget.js).
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const CDN = "https://cdn.jsdelivr.net/npm/@flipperdotfamily/widget@0/dist/cdn/flipper-widget.js";
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
let html = readFileSync("index.html", "utf8");
if (process.env.FLIPPER_WIDGET_CDN) html = html.replace(CDN, process.env.FLIPPER_WIDGET_CDN);
writeFileSync("dist/index.html", html);
cpSync("assets", "dist/assets", { recursive: true });
console.log("dist/index.html" + (process.env.FLIPPER_WIDGET_CDN ? ` (widget from ${process.env.FLIPPER_WIDGET_CDN})` : ""));
