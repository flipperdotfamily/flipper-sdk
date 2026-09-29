// Writes assets/avatars/<animal>.svg: every avatar silhouette on its own, in the exact format of the site icon
// (apps/web/src/app/icon.svg) with its default navy disc and sky gradient. For review and for design tools.
// Run after `pnpm build`: node scripts/gen-avatar-assets.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { AVATAR_SILHOUETTES } from "../dist/avatar.js";

const out = new URL("../assets/avatars/", import.meta.url);
mkdirSync(out, { recursive: true });

const icon = (d) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <radialGradient id="b" cx=".36" cy=".24" r=".84"><stop offset="0" stop-color="#0e3a57"/><stop offset=".5" stop-color="#082536"/><stop offset="1" stop-color="#04121c"/></radialGradient>
    <radialGradient id="h"><stop offset="0" stop-color="#9be0ff" stop-opacity=".16"/><stop offset="1" stop-color="#9be0ff" stop-opacity="0"/></radialGradient>
    <linearGradient id="f" x1=".2" y1="0" x2=".8" y2="1"><stop offset="0" stop-color="#9be0ff"/><stop offset="1" stop-color="#4cc2ff"/></linearGradient>
  </defs>
  <circle cx="32" cy="32" r="30" fill="url(#b)" stroke="#4cc2ff" stroke-opacity=".4" stroke-width="2"/>
  <ellipse cx="27" cy="13" rx="15" ry="7" fill="url(#h)"/>
  <path fill="url(#f)" fill-rule="evenodd" d="${d}"/>
</svg>
`;

for (const { name, d } of AVATAR_SILHOUETTES) {
  const file = `${name.replace(/\s+/g, "-")}.svg`;
  writeFileSync(new URL(file, out), icon(d));
}
console.log(`wrote ${AVATAR_SILHOUETTES.length} files to assets/avatars/`);
