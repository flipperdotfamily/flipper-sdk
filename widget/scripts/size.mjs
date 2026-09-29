#!/usr/bin/env node
// Prints the bundle sizes recorded by the last build (dist/cdn/sizes.json).
import { readFileSync } from "node:fs";
const s = JSON.parse(readFileSync(new URL("../dist/cdn/sizes.json", import.meta.url), "utf8"));
for (const [n, v] of Object.entries(s)) console.log(`${n.padEnd(24)} ${(v.raw / 1024).toFixed(1)} KB, gzip ${(v.gzip / 1024).toFixed(1)} KB, brotli ${(v.brotli / 1024).toFixed(1)} KB`);
