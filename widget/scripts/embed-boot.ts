// Entry for dist/cdn/flipper-embed.js: boots the embed as soon as the document has a body.
import { startEmbed } from "../src/embed/index";

const boot = () => startEmbed();
if (document.body) boot();
else document.addEventListener("DOMContentLoaded", boot, { once: true });
