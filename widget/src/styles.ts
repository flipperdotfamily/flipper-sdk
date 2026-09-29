import { css } from "lit";

/**
 * All styles live in the shadow root: nothing leaks into the host page and nothing from it leaks in, except the
 * `--flipper-*` custom properties (the public theming surface) and, with `fontFamily: "inherit"`, the host's font.
 *
 * Layout is driven by container queries on the widget's own box, never the viewport:
 * - `.fw` (and the modal's `<dialog>`) are containers named `fw`. With `fit="fill"`, `.fw` is a size container, so
 *   height queries apply too; otherwise only the width counts, and the height follows the content. The button variant
 *   is the exception: its `.fw` is no container (containment would collapse the inline host to zero width, so the
 *   button spilled out of it); only its `<dialog>` is.
 * - `.hero` and `.panel` are inline-size containers, so the coin and the form scale with the room they actually have.
 * - Sizes are fluid `clamp()`s over container units, times `--_d` (the `size` preset times the theme's density).
 */
export const styles = css`
  :host {
    display: block;
    -webkit-tap-highlight-color: transparent;
  }
  :host([hidden]) {
    display: none;
  }
  /* the host wraps the button like any inline control (and never grows past its line) */
  :host([variant="button"]) {
    display: inline-block;
    max-width: 100%;
    vertical-align: middle;
  }
  :host([fit="fill"]:not([variant="button"])) {
    height: 100%;
  }
  * {
    box-sizing: border-box;
  }

  .fw {
    --_dens: 1;
    --_sz: 1;
    --_d: calc(var(--_dens) * var(--_sz));
    --_r: var(--flipper-radius, 24px);
    --_font: var(--flipper-font, "Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif);
    --_display: var(--flipper-font-display, "Satoshi", var(--_font));
    --_mono: var(--flipper-font-mono, "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
    --_bw: var(--flipper-border-width, 1px);
    --_maxw: var(--flipper-max-width, 1120px);
    --_ease: cubic-bezier(0.22, 1, 0.36, 1);
    --_soft: color-mix(in srgb, var(--_accent) 15%, transparent);
    --_hover: color-mix(in srgb, var(--_accent) 84%, #fff);
    --_link: var(--_accent);
    container: fw / inline-size;
    color: var(--_text);
    font: 400 14px / 1.45 var(--_font);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-align: left;
  }
  .fw[data-variant="button"] {
    container: none;
  }
  .fw[data-fit="fill"]:not([data-variant="button"]) {
    container: fw / size;
    height: 100%;
    /* a fill widget whose host has no height would collapse under size containment: keep a usable floor */
    min-height: 300px;
  }
  /* the defaults: deep ocean (dark) and a daylight lagoon (light). Every colour is a --flipper-* property */
  .fw[data-mode="dark"] {
    --_accent: var(--flipper-accent, #4cc2ff);
    --_accent-text: var(--flipper-accent-text, #031a2b);
    --_bg: var(--flipper-bg, #0a1b26);
    --_surface: var(--flipper-surface, #0e2230);
    --_field: var(--flipper-field, #13293a);
    --_border: var(--flipper-border, #cdeeff17);
    --_text: var(--flipper-text, #eaf6fb);
    --_muted: var(--flipper-text-muted, #eaf6fb99);
    --_subtle: var(--flipper-text-subtle, #eaf6fb66);
    --_win: var(--flipper-win, #f5c451);
    --_loss: var(--flipper-loss, #ff6b5e);
    --_shadow: var(--flipper-shadow, 0 1px 2px #00070c73, 0 12px 32px #00070c66, inset 0 1px 0 #cdeeff12);
    --_hairline: color-mix(in srgb, var(--_text) 9%, transparent);
    --_check-launchpad: var(--flipper-check-launchpad, #d4fc50);
    /* light falling from the surface, with a soft caustic shimmer (see .card::after) */
    --_backdrop:
      radial-gradient(130% 70% at 50% -16%, color-mix(in srgb, var(--_accent) 12%, transparent), transparent 66%),
      radial-gradient(36% 18% at 26% 5%, #cdeeff12, transparent 72%),
      radial-gradient(28% 14% at 71% 12%, #cdeeff0d, transparent 72%),
      linear-gradient(180deg, #cdeeff08, transparent 40% 62%, #00060a40);
    color-scheme: dark;
  }
  .fw[data-mode="light"] {
    --_accent: var(--flipper-accent, #0a6aa2);
    --_accent-text: var(--flipper-accent-text, #ffffff);
    --_bg: var(--flipper-bg, #ffffff);
    --_surface: var(--flipper-surface, #f5f9fc);
    --_field: var(--flipper-field, #eef4f8);
    --_border: var(--flipper-border, #0e3a5a1c);
    --_text: var(--flipper-text, #0b2239);
    --_muted: var(--flipper-text-muted, #0b2239a6);
    --_subtle: var(--flipper-text-subtle, #0b223980);
    --_win: var(--flipper-win, #946200);
    --_loss: var(--flipper-loss, #c7372c);
    --_shadow: var(--flipper-shadow, 0 1px 2px #1a4a6e0f, 0 10px 28px #1a4a6e14, inset 0 1px 0 #ffffff);
    --_hairline: color-mix(in srgb, var(--_text) 8%, transparent);
    --_link: color-mix(in srgb, var(--_accent) 55%, #000);
    --_check-launchpad: var(--flipper-check-launchpad, #6b8a00);
    /* daylight entering from the surface: a soft sky-aqua light at the top, two sun glints, clean white below */
    --_backdrop:
      radial-gradient(130% 70% at 50% -18%, #cfeefb, transparent 64%),
      radial-gradient(36% 18% at 26% 5%, #ffffffb3, transparent 72%),
      radial-gradient(28% 14% at 71% 12%, #ffffff99, transparent 72%);
    color-scheme: light;
  }
  .fw[data-density="compact"] {
    --_dens: 0.9;
  }
  .fw[data-density="spacious"] {
    --_dens: 1.1;
  }
  .fw[data-size="sm"] {
    --_sz: 0.88;
  }
  .fw[data-size="lg"] {
    --_sz: 1.14;
  }
  .fw[data-font="inherit"] {
    --_font: inherit;
    font-family: inherit;
  }
  .fw[data-font="inherit"] .display {
    font-family: inherit;
  }

  button,
  input {
    font: inherit;
    color: inherit;
  }
  button {
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
  }
  button:disabled {
    cursor: not-allowed;
  }
  :focus-visible {
    outline: 2px solid var(--_accent);
    outline-offset: 2px;
  }
  a {
    color: var(--_link);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .num {
    font-family: var(--_mono);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }
  .display {
    font-family: var(--_display);
    letter-spacing: -0.03em;
  }

  /* ── card ─────────────────────────────────────────────────────────────────────────────────────── */
  .card {
    /* fluid scale: container units resolve where these are used (the card, the hero, the panel) */
    --_pad: calc(clamp(12px, 4.4cqi, 22px) * var(--_d));
    --_gap: calc(clamp(7px, 2.4cqi, 11px) * var(--_d));
    --_fs: calc(clamp(12.5px, 3.6cqi, 14px) * var(--_d));
    --_fs-s: calc(clamp(10.5px, 3cqi, 12px) * var(--_d));
    --_fs-tag: calc(clamp(16px, 5.8cqi, 22px) * var(--_d));
    --_fs-head: calc(clamp(20px, 8cqi, 30px) * var(--_d));
    --_fs-amt: calc(clamp(20px, 8.6cqi, 32px) * var(--_d));
    --_h-cta: calc(clamp(42px, 13cqi, 54px) * var(--_d));
    --_h-ctl: calc(clamp(36px, 11cqi, 42px) * var(--_d));
    --_coin: var(--flipper-coin-size, calc(clamp(64px, 38cqi, 148px) * var(--_d)));
    position: relative;
    isolation: isolate;
    display: flex;
    flex-direction: column;
    gap: var(--_gap);
    width: 100%;
    max-width: var(--_maxw);
    margin-inline: auto;
    padding: var(--_pad);
    border-radius: var(--_r);
    border: var(--_bw) solid var(--_border);
    background: var(--_bg);
    box-shadow: var(--_shadow);
    font-size: var(--_fs);
    overflow: hidden;
  }
  .card::before {
    /* faint accent bloom behind the coin */
    content: "";
    position: absolute;
    z-index: -1;
    inset: -40% -30% auto;
    height: 70%;
    border-radius: 50%;
    background: radial-gradient(closest-side, color-mix(in srgb, var(--_accent) 13%, transparent), transparent);
    pointer-events: none;
  }
  .fw[data-mode="light"] .card::before {
    background: radial-gradient(closest-side, color-mix(in srgb, var(--_accent) 18%, transparent), transparent);
  }
  .card::after {
    /* the default look's backdrop: over the bloom, under the content. A host's --flipper-backdrop always wins; without
       one, setting --flipper-bg turns it off ("<colour> <gradient>" isn't a valid background-image: it computes to none) */
    content: "";
    position: absolute;
    z-index: -1;
    inset: 0;
    border-radius: inherit;
    background-image: var(--flipper-backdrop, var(--flipper-bg,) var(--_backdrop));
    pointer-events: none;
  }
  /* the picker needs room: an auto-height card grows while it's open (a fill card already has its size) */
  .fw:not([data-fit="fill"]) .card[data-picker],
  dialog .card[data-picker] {
    min-height: min(460px, 100dvh - 24px);
  }
  .fw[data-fit="fill"]:not([data-variant="button"]) > .card {
    height: 100%;
    max-width: none;
    /* never overlap: if a host makes it smaller than the smallest layout, it scrolls */
    overflow-y: auto;
    scrollbar-width: none;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 30px;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    color: var(--_text);
    text-decoration: none;
  }
  .brand-mark {
    display: inline-block;
    width: 30px;
    height: 18px;
    color: var(--_accent);
    flex: none;
  }
  .brand-logo {
    width: 24px;
    height: 24px;
    border-radius: calc(var(--_r) * 0.3);
    object-fit: cover;
    flex: none;
  }
  .brand-name {
    font: 700 calc(17px * var(--_d)) / 1 var(--_display);
    letter-spacing: -0.03em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .head-end {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: none;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px;
    border-radius: 999px;
    border: 1px solid var(--_border);
    background: color-mix(in srgb, var(--_field) 70%, transparent);
    color: var(--_muted);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  }
  .chip .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--_accent);
    box-shadow: 0 0 8px var(--_accent);
  }
  .chip[data-warn] .dot {
    background: var(--_win);
    box-shadow: 0 0 8px var(--_win);
  }
  button.chip:hover:not(:disabled) {
    color: var(--_text);
    border-color: color-mix(in srgb, var(--_accent) 40%, var(--_border));
  }
  .short {
    display: none;
  }
  .icon-btn {
    display: inline-grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 999px;
    color: var(--_muted);
    font-size: 18px;
  }
  .icon-btn:hover {
    color: var(--_text);
    background: var(--_hairline);
  }

  /* ── body: the hero (coin + status) and the panel (the form) ───────────────────────────────────── */
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--_gap);
  }
  .card > *,
  .body > *,
  .hero > * {
    flex-shrink: 0;
  }
  .hero {
    container: hero / inline-size;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
  }
  .hero > .coin-stage {
    /* the toss rises about a third of the coin: keep that much air above it (sized in the hero's own units) */
    margin: calc(var(--_coin) * 0.26) 0 calc(var(--_coin) * 0.08);
    transition: margin 0.4s var(--_ease);
  }
  .panel {
    container: panel / inline-size;
    min-width: 0;
  }
  .status {
    /* a 0fr → 1fr row: the slot grows open (and closes) instead of jumping */
    display: grid;
    grid-template-rows: 1fr;
    min-height: calc(var(--_fs-tag) * 2.4);
    margin-top: calc(var(--_coin) * 0.2 + 4px);
    max-width: 100%;
    transition:
      grid-template-rows 0.4s var(--_ease),
      min-height 0.4s var(--_ease),
      margin-top 0.4s var(--_ease);
  }
  .status-in {
    min-height: 0;
    overflow: hidden;
    /* room for descenders and tight letter-spacing inside the clip, without changing the layout */
    padding: 4px;
    margin: -4px;
  }
  /* idle without a tagline: the coin says it all, the slot takes no room */
  .status[data-empty] {
    grid-template-rows: 0fr;
    min-height: 0;
    margin-top: 0;
  }
  .headline {
    margin: 0;
    font: 700 var(--_fs-head) / 1.04 var(--_display);
    letter-spacing: -0.035em;
    text-wrap: balance;
  }
  .headline .face-heads {
    color: var(--_win);
  }
  .headline .face-tails {
    color: var(--_subtle);
  }
  .headline[data-tone="loss"] .rest {
    color: var(--_muted);
  }
  .tagline {
    margin: 0;
    font: 600 var(--_fs-tag) / 1.15 var(--_display);
    letter-spacing: -0.03em;
    color: var(--_text);
  }
  .sub {
    margin: 6px auto 0;
    max-width: 36ch;
    font-size: var(--_fs);
    color: var(--_muted);
    text-wrap: pretty;
  }
  .tiny {
    margin: 6px 0 0;
    font-size: var(--_fs-s);
    color: var(--_subtle);
    overflow-wrap: anywhere;
  }
  .tiny a {
    color: inherit;
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, currentColor 35%, transparent);
    text-underline-offset: 2px;
  }
  .pending-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-right: 6px;
    border-radius: 50%;
    background: var(--_win);
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
  .fade-in {
    animation: fade-in 0.5s var(--_ease) both;
  }
  @keyframes fade-in {
    from {
      opacity: 0;
      transform: translateY(8px);
      filter: blur(6px);
    }
  }

  /* the coin (CSS 3D). Never put filter / opacity / overflow on .coin-lift or .coin: they flatten preserve-3d */
  .coin-stage {
    position: relative;
    flex: none;
    width: var(--_coin);
    aspect-ratio: 1;
    perspective: calc(var(--_coin) * 4.4);
  }
  .coin-halo {
    position: absolute;
    inset: -45%;
    border-radius: 50%;
    opacity: 0;
    pointer-events: none;
    background: radial-gradient(circle, color-mix(in srgb, var(--_win) 50%, transparent) 0%, transparent 58%);
    filter: blur(calc(var(--_coin) * 0.08));
  }
  .coin-shadow {
    position: absolute;
    left: 15%;
    right: 15%;
    bottom: -14%;
    height: 11%;
    border-radius: 50%;
    pointer-events: none;
    background: radial-gradient(closest-side, #000000c0, transparent);
    filter: blur(5px);
  }
  .fw[data-mode="light"] .coin-shadow {
    background: radial-gradient(closest-side, color-mix(in srgb, var(--_text) 40%, transparent), transparent);
  }
  .coin-lift {
    position: absolute;
    inset: 0;
    transform-style: preserve-3d;
    transform-origin: 50% 100%;
    will-change: transform;
  }
  .coin {
    position: absolute;
    inset: 0;
    transform-style: preserve-3d;
    will-change: transform;
  }
  .coin-rim {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background:
      repeating-conic-gradient(from 0deg, #ffffff1f 0 1.6deg, #00000029 1.6deg 3.2deg),
      linear-gradient(180deg, #f4f4ef 0%, #b8b8b1 30%, #5b5b57 62%, #1f1f1d 100%);
  }
  .coin-face {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    overflow: hidden;
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
    transform: translateZ(calc(var(--_coin) * 0.035));
    background:
      radial-gradient(circle, transparent 0 60%, #00000026 71%, transparent 72%),
      repeating-radial-gradient(circle, #ffffff0a 0 0.6px, transparent 0.6px 2.4px),
      linear-gradient(
        calc(158deg + var(--spec, 0) * 40deg),
        #fbfbf8 0%,
        #e4e4de 20%,
        #9a9a94 34%,
        #3c3c39 35.5%,
        #2a2a28 46%,
        #6d6d68 60%,
        #e9e9e3 63%,
        #b8b8b1 78%,
        #4a4a46 100%
      );
    box-shadow: inset 0 0 0 1px #ffffff40;
  }
  /* daylight: the same silver, reflecting a bright sky and water instead of the deep (no dark band); matches the site */
  .fw[data-mode="light"] .coin-rim {
    background:
      repeating-conic-gradient(from 0deg, #ffffff33 0 1.6deg, #1a4a6e1f 1.6deg 3.2deg),
      linear-gradient(180deg, #f8fbfc 0%, #cbd6dd 30%, #86a0b1 62%, #4d6778 100%);
  }
  .fw[data-mode="light"] .coin-face {
    background:
      radial-gradient(circle, transparent 0 60%, #1a4a6e21 71%, transparent 72%),
      repeating-radial-gradient(circle, #ffffff14 0 0.6px, transparent 0.6px 2.4px),
      linear-gradient(
        calc(158deg + var(--spec, 0) * 40deg),
        #ffffff 0%,
        #e9f0f3 20%,
        #b3c5d1 34%,
        #7d98aa 35.5%,
        #6f8ca0 46%,
        #a9c0cf 60%,
        #f1f6f8 63%,
        #cad6de 78%,
        #859cac 100%
      );
  }
  .fw[data-mode="light"] .coin-face::before {
    background: conic-gradient(
      from calc(210deg + var(--spec, 0) * 120deg),
      #fff,
      #a6b8c4 12%,
      #f6f9fb 24%,
      #6f8a9d 38%,
      #e3eaef 52%,
      #86a0b1 66%,
      #fbfdfe 80%,
      #98acb9 90%,
      #fff
    );
  }
  .coin-face.tails {
    transform: rotateX(180deg) translateZ(calc(var(--_coin) * 0.035));
  }
  .coin-face::before {
    /* raised outer rim band, lit by rotation */
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: conic-gradient(
      from calc(210deg + var(--spec, 0) * 120deg),
      #fff,
      #8a8a84 12%,
      #f4f4ef 24%,
      #3a3a37 38%,
      #dcdcd6 52%,
      #5a5a56 66%,
      #fafaf6 80%,
      #77776f 90%,
      #fff
    );
    -webkit-mask: radial-gradient(circle, transparent 0 83%, #000 83.6% 100%);
    mask: radial-gradient(circle, transparent 0 83%, #000 83.6% 100%);
  }
  .coin-face::after {
    content: "";
    position: absolute;
    inset: 8.2%;
    border-radius: 50%;
    pointer-events: none;
    box-shadow:
      0 0 0 1px #00000073,
      inset 0 2px 3px #0000008c,
      0 -1px 0 1px #ffffff40;
  }
  .coin-iris {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    mix-blend-mode: color;
    opacity: 0.16;
    background: conic-gradient(from calc(var(--spec, 0) * 360deg), var(--_accent), #7ce7ff, #b69cff, var(--_win), var(--_accent));
  }
  .coin-sheen {
    position: absolute;
    inset: -30%;
    mix-blend-mode: soft-light;
    background: linear-gradient(115deg, transparent 38%, #ffffffd9 50%, transparent 62%);
    transform: translateX(calc((var(--spec, 0) - 0.5) * 90%));
  }
  .coin-glyph {
    position: absolute;
    inset: 14%;
    width: 72%;
    height: 72%;
    overflow: visible;
    filter: drop-shadow(0 1.5px 0 #ffffffb3) drop-shadow(0 -1.5px 0 #00000080) drop-shadow(0 4px 8px #0000004d);
  }
  .coin-img {
    position: absolute;
    inset: 16%;
    width: 68%;
    height: 68%;
    object-fit: contain;
    border-radius: 50%;
    filter: drop-shadow(0 1px 0 #ffffff99) drop-shadow(0 -1px 0 #00000066);
  }
  .coin-letter {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font: 700 calc(var(--_coin) * 0.36) / 1 var(--_display);
    color: #3b3b37;
    text-shadow:
      0 1.5px 0 #ffffffb3,
      0 -1px 0 #00000059;
  }
  .coin-fx {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 0;
    height: 0;
    pointer-events: none;
  }
  .coin-fx .drop {
    position: absolute;
    left: 0;
    top: 0;
    border-radius: 2px;
  }
  .drop--0 {
    background: var(--_win);
    box-shadow: 0 0 6px var(--_win);
  }
  .drop--1 {
    background: #ffe29a;
  }
  .drop--2 {
    background: #eaf6fb;
  }
  .drop--3 {
    background: #bcd9e6;
  }
  .drop--4 {
    background: var(--_accent);
    box-shadow: 0 0 6px var(--_accent);
  }
  .coin-fx .burst-ring {
    position: absolute;
    left: calc(var(--_coin) * -0.5);
    top: calc(var(--_coin) * -0.5);
    width: var(--_coin);
    height: var(--_coin);
    border-radius: 50%;
    border: 1.5px solid color-mix(in srgb, var(--_win) 80%, transparent);
    box-shadow: 0 0 20px color-mix(in srgb, var(--_win) 45%, transparent);
  }
  .coin-fx .ripple {
    position: absolute;
    left: 0;
    top: calc(var(--_coin) * 0.5);
    width: calc(var(--_coin) * 0.9);
    aspect-ratio: 3.2;
    border-radius: 50%;
    border: 1.5px solid color-mix(in srgb, var(--_accent) 75%, transparent);
    box-shadow: 0 0 12px color-mix(in srgb, var(--_accent) 35%, transparent);
  }
  .coin-fx .ripple--win {
    border-color: color-mix(in srgb, var(--_win) 70%, transparent);
  }

  /* ── form ─────────────────────────────────────────────────────────────────────────────────────── */
  .form {
    display: grid;
    gap: var(--_gap);
  }
  .field {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: calc(var(--_h-ctl) + 14px);
    padding: 6px;
    border-radius: calc(var(--_r) * 0.6);
    background: var(--_field);
    border: 1px solid var(--_border);
    transition:
      border-color 0.18s,
      box-shadow 0.18s;
  }
  .field:focus-within {
    border-color: color-mix(in srgb, var(--_accent) 90%, transparent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--_accent) 18%, transparent);
  }
  .token-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    flex: none;
    min-width: 0;
    max-width: 52%;
    height: var(--_h-ctl);
    padding: 0 10px 0 6px;
    border-radius: calc(var(--_r) * 0.45);
    background: color-mix(in srgb, var(--_bg) 55%, var(--_field));
    border: 1px solid var(--_hairline);
    font-weight: 700;
    font-size: calc(var(--_fs) + 1px);
    letter-spacing: -0.01em;
  }
  .token-btn:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--_accent) 45%, transparent);
  }
  .token-btn:disabled {
    cursor: default;
  }
  .token-btn .sym,
  .suffix .sym {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .token-btn .chev {
    color: var(--_muted);
    font-size: 15px;
    flex: none;
  }
  .amount {
    flex: 1;
    min-width: 0;
    width: 100%;
    border: 0;
    outline: 0;
    background: transparent;
    text-align: right;
    padding: 0 4px;
    font: 500 var(--_fs-amt) / 1.1 var(--_mono);
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
  }
  .amount::placeholder {
    color: var(--_subtle);
  }
  .amount:focus-visible {
    outline: none;
  }
  .amount:disabled {
    opacity: 0.6;
  }
  /* single-token mode: a plain input, the token shown quietly after the number */
  .field.single {
    padding-inline-start: calc(var(--_pad) * 0.6);
  }
  .field.single .amount {
    text-align: left;
    padding: 0;
  }
  .suffix {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 0 1 auto;
    min-width: 0;
    max-width: 45%;
    color: var(--_muted);
    font-size: var(--_fs);
    font-weight: 600;
    user-select: none;
  }
  .max {
    flex: none;
    height: calc(var(--_h-ctl) * 0.74);
    padding: 0 9px;
    border-radius: calc(var(--_r) * 0.4);
    background: var(--_soft);
    color: var(--_link);
    font: 700 11px/1 var(--_font);
    letter-spacing: 0.06em;
  }
  .max:hover:not(:disabled) {
    filter: brightness(1.15);
  }
  .max:disabled {
    opacity: 0.4;
  }
  .meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 16px;
    padding: 0 4px;
    font-size: var(--_fs-s);
    line-height: 1.2;
    color: var(--_subtle);
  }
  .meta .bal {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta .bal .num {
    color: var(--_muted);
  }
  .odds-shift {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: none;
    color: var(--_win);
  }
  .odds-shift[data-pending] {
    opacity: 0.5;
  }
  .odds-short {
    display: none;
  }

  .note {
    margin: 0;
    padding: 9px 12px;
    border-radius: calc(var(--_r) * 0.5);
    border: 1px solid var(--_border);
    background: var(--_hairline);
    color: var(--_muted);
    font-size: calc(var(--_fs) - 1px);
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  .note[data-tone="loss"] {
    color: var(--_text);
    border-color: color-mix(in srgb, var(--_loss) 32%, transparent);
    background: color-mix(in srgb, var(--_loss) 8%, transparent);
  }
  .note[data-tone="win"] {
    color: var(--_text);
    border-color: color-mix(in srgb, var(--_win) 32%, transparent);
    background: color-mix(in srgb, var(--_win) 8%, transparent);
  }
  .note b {
    color: var(--_text);
    font-weight: 700;
  }
  .note code {
    font-family: var(--_mono);
    font-size: 0.95em;
  }
  .note-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }
  .link-btn {
    color: var(--_link);
    font-weight: 700;
    font-size: calc(var(--_fs) - 1px);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .link-btn:disabled {
    opacity: 0.5;
    text-decoration: none;
  }

  /* ── pending wins: "Payout being settled · X owed" + Retry payout ─────────────────────────────── */
  .payout {
    display: grid;
    justify-items: center;
    gap: 8px;
    margin-top: 10px;
  }
  .payout-line {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    column-gap: 4px;
    font-size: var(--_fs-s);
    line-height: 1.35;
    color: var(--_win);
  }
  .payout-line .pending-dot,
  .payout-title .pending-dot {
    margin-right: 2px;
  }
  .payout-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 6px 10px;
    min-width: 0;
  }
  .payout-btn {
    flex: none;
    min-height: 32px;
    padding: 0 14px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--_win) 22%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--_win) 60%, transparent);
    color: var(--_text);
    font: 700 calc(var(--_fs) - 1px) / 1.1 var(--_font);
    white-space: nowrap;
    transition:
      background 0.15s var(--_ease),
      opacity 0.15s var(--_ease);
  }
  .payout-btn:not(:disabled):hover {
    background: color-mix(in srgb, var(--_win) 34%, transparent);
  }
  .payout-btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
  .payout-btn[data-busy] {
    opacity: 0.8;
    cursor: progress;
  }
  .payout-auto {
    margin: 0;
    min-width: 0;
    font-size: var(--_fs-s);
    line-height: 1.35;
    color: var(--_subtle);
    text-align: center;
    text-wrap: pretty;
    overflow-wrap: anywhere;
  }
  .payout-why {
    color: var(--_muted);
  }
  .payout-err {
    margin: 0;
    font-size: var(--_fs-s);
    line-height: 1.35;
    color: var(--_loss);
    overflow-wrap: anywhere;
  }
  .payout-done {
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--_fs-s);
    font-weight: 600;
    color: var(--_win);
  }
  /* in the notes (the banner, and the compact variant's result): left-aligned, quieter */
  .payout-note {
    display: grid;
  }
  .payout-note .payout-line,
  .payout-note .payout-row {
    justify-content: flex-start;
  }
  .payout-note .payout-auto {
    text-align: left;
  }
  .payout-note {
    gap: 6px;
  }
  .payout-title {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    font-weight: 700;
    color: var(--_text);
  }
  /* the banner's row: "X owed" and its button (or "Paid out") side by side, wrapping when narrow */
  .payout-owed {
    flex: 1 1 auto;
    min-width: 0;
    color: var(--_text);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .payout-note .payout-owed + .payout-btn,
  .payout-note .payout-owed + .payout-done {
    margin-left: auto;
  }

  .cta {
    position: relative;
    isolation: isolate;
    display: block;
    width: 100%;
    min-height: var(--_h-cta);
    padding: 0 16px;
    border-radius: calc(var(--_r) * 0.75);
    background: var(--_accent);
    color: var(--_accent-text);
    font: 700 calc(var(--_fs) + 2px) / 1.15 var(--_font);
    letter-spacing: -0.01em;
    transition:
      background 0.18s,
      box-shadow 0.18s,
      opacity 0.18s,
      transform 0.12s;
  }
  .cta:hover:not(:disabled):not([data-busy]) {
    background: var(--_hover);
    box-shadow: 0 8px 26px color-mix(in srgb, var(--_accent) 32%, transparent);
  }
  .cta:active:not(:disabled) {
    transform: scale(0.985);
  }
  .cta:disabled:not([data-busy]):not([data-drawing]) {
    opacity: 0.45;
  }
  .cta[data-busy] {
    cursor: progress;
    overflow: hidden;
  }
  .cta[data-busy]::after {
    content: "";
    position: absolute;
    left: 0;
    bottom: 0;
    height: 3px;
    width: 42%;
    border-radius: 3px;
    background: color-mix(in srgb, var(--_accent-text) 55%, transparent);
    animation: load 1.15s ease-in-out infinite;
  }
  .cta[data-drawing] {
    cursor: progress;
    background: color-mix(in srgb, var(--_field) 92%, var(--_win));
    color: var(--_win);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--_win) 30%, transparent);
  }
  .cta[data-drawing]::before {
    content: "";
    position: absolute;
    inset: -2px;
    border-radius: inherit;
    padding: 2px;
    background: conic-gradient(from var(--orbit, 0deg), transparent 0 62%, var(--_win) 78%, #fff8e0 84%, transparent 92%);
    -webkit-mask:
      linear-gradient(#000 0 0) content-box,
      linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask:
      linear-gradient(#000 0 0) content-box,
      linear-gradient(#000 0 0);
    mask-composite: exclude;
    animation: orbit 1.6s linear infinite;
    z-index: -1;
  }
  @property --orbit {
    syntax: "<angle>";
    initial-value: 0deg;
    inherits: false;
  }
  @keyframes orbit {
    to {
      --orbit: 360deg;
    }
  }
  @keyframes load {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(240%);
    }
  }
  .cta-label {
    display: block;
    padding: 10px 0;
  }
  .cta-label.swap {
    animation: label-in 0.22s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
  }
  @keyframes label-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  .hint {
    margin: 0;
    text-align: center;
    font-size: var(--_fs-s);
    color: var(--_subtle);
  }
  .details {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 2px 14px;
    margin: 0;
    font-size: var(--_fs-s);
    color: var(--_subtle);
  }
  .details b {
    font-weight: 500;
    color: var(--_muted);
  }
  .foot {
    display: flex;
    justify-content: center;
    font-size: var(--_fs-s);
    color: var(--_subtle);
  }
  .foot a {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: inherit;
    text-decoration: none;
  }
  .foot a:hover {
    color: var(--_muted);
  }
  .foot .brand-mark {
    width: 20px;
    height: 12px;
  }

  /* ── avatars ──────────────────────────────────────────────────────────────────────────────────── */
  .avatar {
    position: relative;
    display: inline-grid;
    place-items: center;
    flex: none;
    width: var(--s, 28px);
    height: var(--s, 28px);
    border-radius: 50%;
    overflow: hidden;
    color: #ffffffe6;
    font: 700 calc(var(--s, 28px) * 0.42) / 1 var(--_display);
    box-shadow: inset 0 0 0 1px #ffffff1a;
  }
  .avatar img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
    background: #0a1b26;
  }
  .avatar.flipper {
    background: radial-gradient(circle at 30% 25%, #1b3d55, #07141d);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--_accent) 40%, transparent);
    color: var(--_accent);
  }
  .avatar.flipper svg {
    width: 72%;
    height: 44%;
  }
  .avatar.eth {
    background: radial-gradient(circle at 30% 25%, #8a92b2, #3c3c3d);
    color: #fff;
    font-size: calc(var(--s, 28px) * 0.62);
  }
  /* the picker's one checkmark: whitelisted (the accent), or a launch its launchpad vouches for (lime) */
  .check {
    display: inline-flex;
    flex: none;
    font-size: 13px;
    color: var(--flipper-check, var(--_accent));
  }
  .check[data-kind="launchpad"] {
    color: var(--_check-launchpad);
  }
  /* the dark mode's lime is light: a dark tick on it (light mode's darker lime keeps the background's tick) */
  .fw[data-mode="dark"] .check[data-kind="launchpad"] svg path + path {
    stroke: #1d2400;
  }

  /* ── picker (a panel over the card) ───────────────────────────────────────────────────────────── */
  .picker {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: flex;
    flex-direction: column;
    background: var(--_bg);
    border-radius: inherit;
    animation: sheet-in 0.26s var(--_ease) both;
  }
  @keyframes sheet-in {
    from {
      opacity: 0;
      transform: translateY(14px);
    }
  }
  .picker-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: var(--_pad) var(--_pad) 8px;
  }
  .picker-title {
    flex: 1;
    margin: 0;
    font: 700 16px/1.2 var(--_display);
    letter-spacing: -0.02em;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 var(--_pad) 8px;
    padding: 0 12px;
    height: var(--_h-ctl);
    border-radius: calc(var(--_r) * 0.55);
    background: var(--_field);
    border: 1px solid var(--_border);
    color: var(--_subtle);
  }
  .search:focus-within {
    border-color: color-mix(in srgb, var(--_accent) 90%, transparent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--_accent) 18%, transparent);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    font-size: 14px;
    color: var(--_text);
  }
  .search input::placeholder {
    color: var(--_subtle);
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 max(4px, calc(var(--_pad) - 8px)) 10px;
    scrollbar-width: thin;
    scrollbar-color: var(--_border) transparent;
  }
  .section {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    justify-content: space-between;
    padding: 10px 8px 6px;
    background: var(--_bg);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--_subtle);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px;
    border-radius: calc(var(--_r) * 0.5);
    text-align: left;
    cursor: pointer;
  }
  .row[aria-selected="true"] {
    background: var(--_soft);
  }
  .row[data-active] {
    background: var(--_hairline);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--_accent) 35%, transparent);
  }
  .row[aria-disabled="true"] {
    cursor: not-allowed;
    opacity: 0.55;
  }
  .row-main {
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  .row-top {
    display: flex;
    align-items: center;
    gap: 5px;
    font-weight: 700;
    font-size: 14px;
  }
  .row-top .s {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-sub {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11.5px;
    color: var(--_subtle);
  }
  .row-tag {
    flex: none;
    padding: 3px 7px;
    border-radius: 999px;
    font-size: 10.5px;
    font-weight: 700;
    color: var(--_link);
    background: var(--_soft);
  }
  .list-msg {
    padding: 18px 10px;
    text-align: center;
    color: var(--_muted);
    font-size: 13px;
  }
  .sentinel {
    height: 1px;
  }

  /* ── compact variant ──────────────────────────────────────────────────────────────────────────── */
  .fw[data-variant="compact"] .card {
    --_coin: var(--flipper-coin-size, calc(clamp(40px, 13cqi, 56px) * var(--_d)));
  }
  .compact-top {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .compact-top .coin-stage {
    margin: 4px 2px;
  }
  .compact-text {
    flex: 1;
    min-width: 0;
  }
  .compact-text .headline {
    font-size: calc(var(--_fs-tag) * 0.95);
  }
  .compact-text .tagline {
    font-size: calc(var(--_fs-tag) * 0.85);
  }
  .compact-text .sub {
    margin: 2px 0 0;
    font-size: var(--_fs-s);
    max-width: none;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .compact-text .tagline,
  .compact-text .headline {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .compact-top .chip {
    padding: 0 8px;
  }

  /* ── button variant ───────────────────────────────────────────────────────────────────────────── */
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    height: 46px;
    padding: 0 18px 0 8px;
    border-radius: 999px;
    background: var(--_accent);
    color: var(--_accent-text);
    font: 700 15px/1 var(--_font);
    letter-spacing: -0.01em;
    white-space: nowrap;
    max-width: 100%;
    box-shadow: 0 6px 20px color-mix(in srgb, var(--_accent) 28%, transparent);
    transition:
      transform 0.12s,
      background 0.18s;
  }
  .trigger:hover {
    background: var(--_hover);
  }
  .trigger-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .trigger:active {
    transform: scale(0.98);
  }
  .trigger-dot {
    width: 8px;
    height: 8px;
    margin-left: -4px;
    border-radius: 50%;
    background: var(--_win);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--_accent-text) 70%, transparent);
    animation: pulse 1.2s ease-in-out infinite;
  }
  .trigger .mini {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #fbfbf8, #9a9a94 55%, #3c3c39);
    box-shadow: inset 0 0 0 2px #ffffff55;
    display: grid;
    place-items: center;
    color: #2d2d2a;
  }
  .trigger .mini svg {
    width: 70%;
    height: 45%;
  }
  dialog {
    /* the modal is its own container: the card inside sizes from the dialog, not the trigger */
    container: fw / inline-size;
    width: min(460px, calc(100vw - 24px));
    max-width: none;
    max-height: calc(100dvh - 24px);
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    overflow: visible;
  }
  /* wide, short screens: a wider modal, so the card lays out side by side instead of scrolling */
  @media (min-width: 720px) and (max-height: 720px) {
    dialog {
      width: min(880px, calc(100vw - 48px));
    }
  }
  @media (max-height: 520px) {
    dialog .card {
      --_coin: calc(clamp(44px, 15vh, 96px) * var(--_d));
      --_gap: calc(6px * var(--_d));
    }
    dialog .hero .pitch,
    dialog .hero .tiny {
      display: none;
    }
  }
  @media (max-height: 400px) {
    dialog .details,
    dialog .foot {
      display: none;
    }
    @container panel (max-width: 300px) {
      dialog .field:not(.single) {
        flex-wrap: nowrap;
      }
      dialog .field:not(.single) .token-btn {
        flex: none;
        padding: 0 6px 0 4px;
      }
      dialog .field:not(.single) .token-btn .sym {
        display: none;
      }
      dialog .field:not(.single) .amount {
        text-align: right;
      }
    }
  }
  dialog::backdrop {
    background: #05060899;
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }
  dialog[open] .card {
    animation: sheet-in 0.3s var(--_ease) both;
    max-width: none;
    max-height: calc(100dvh - 24px);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  /* ── width: narrow ────────────────────────────────────────────────────────────────────────────── */
  @container fw (max-width: 300px) {
    .long {
      display: none;
    }
    .short {
      display: inline;
    }
    .brand-mark {
      width: 26px;
      height: 16px;
    }
    .chip {
      padding: 0 8px;
      gap: 5px;
    }
    .details {
      gap: 2px 10px;
    }
  }
  @container fw (max-width: 260px) {
    .chip .long,
    .chip .short {
      display: none !important;
    }
    .chip {
      padding: 0 9px;
    }
  }
  @container fw (max-width: 330px) {
    .fw[data-variant="compact"] .chip .long,
    .fw[data-variant="compact"] .chip .short {
      display: none !important;
    }
    .fw[data-variant="compact"] .chip {
      padding: 0 9px;
    }
  }
  @container panel (max-width: 210px) {
    /* single mode, very narrow: the token's logo alone (the balance line names it) */
    .suffix .sym {
      display: none;
    }
  }
  @container panel (max-width: 300px) {
    /* picker mode: the token button takes its own row above the amount */
    .field:not(.single) {
      flex-wrap: wrap;
    }
    .field:not(.single) .token-btn {
      flex: 1 1 100%;
      max-width: none;
    }
    .field:not(.single) .amount {
      text-align: left;
      padding-inline-start: 6px;
    }
  }
  @container panel (max-width: 360px) {
    /* narrow: "Odds −0.9 pts" (the tooltip says the rest) so the balance keeps its room */
    .odds-long {
      display: none;
    }
    .odds-short {
      display: inline;
    }
  }

  /* ── width: wide. The coin moves beside the form ──────────────────────────────────────────────── */
  @container fw (min-width: 640px) {
    .fw[data-variant="card"] .card,
    dialog .card {
      --_pad: calc(clamp(20px, 3cqi, 32px) * var(--_d));
      --_coin: var(--flipper-coin-size, calc(clamp(120px, 42cqi, 260px) * var(--_d)));
    }
    .fw[data-variant="card"] .body,
    dialog .body {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(280px, min(420px, 48%));
      align-items: center;
      column-gap: clamp(20px, 4cqi, 56px);
    }
    /* idle, nothing under the coin: centre it against the form (the toss air goes back when it spins) */
    .fw[data-variant="card"] .hero[data-quiet] > .coin-stage,
    dialog .hero[data-quiet] > .coin-stage {
      margin-block: calc(var(--_coin) * 0.12);
    }
    .fw[data-variant="card"] .picker,
    dialog .picker {
      left: auto;
      width: min(440px, 50%);
      border-left: 1px solid var(--_border);
      border-radius: 0 var(--_r) var(--_r) 0;
    }
  }
  /* compact, medium: status on top, then amount and button side by side */
  @container fw (min-width: 560px) {
    .fw[data-variant="compact"] .form {
      grid-template-columns: minmax(0, 1fr) minmax(160px, 32%);
      align-items: center;
      column-gap: 12px;
    }
    .fw[data-variant="compact"] .field {
      grid-column: 1;
      grid-row: 1;
    }
    .fw[data-variant="compact"] .cta {
      grid-column: 2;
      grid-row: 1;
      height: 100%;
    }
    .fw[data-variant="compact"] .meta {
      grid-column: 1;
      grid-row: 2;
    }
    .fw[data-variant="compact"] .details {
      grid-column: 2;
      grid-row: 2;
    }
    .fw[data-variant="compact"] .note,
    .fw[data-variant="compact"] .hint {
      grid-column: 1 / -1;
    }
    .fw[data-variant="compact"] .picker {
      left: auto;
      width: min(440px, 60%);
      border-left: 1px solid var(--_border);
    }
  }
  /* compact, wide: one bar. Coin and status | amount | button */
  @container fw (min-width: 960px) {
    .fw[data-variant="compact"] .card {
      display: grid;
      grid-template-columns: minmax(300px, 34%) minmax(0, 1fr);
      align-items: center;
      align-content: center;
      column-gap: 24px;
    }
    .fw[data-variant="compact"] .foot {
      grid-column: 1 / -1;
    }
    .fw[data-variant="compact"] .chip .long {
      display: none;
    }
    .fw[data-variant="compact"] .chip .short {
      display: inline;
    }
    .fw[data-variant="compact"] .picker {
      width: min(440px, 50%);
    }
  }

  /* ── fill: the widget takes the host's height, and the coin grows or shrinks with it ──────────── */
  .fw[data-fit="fill"]:not([data-variant="button"]) > .card {
    --_coin: var(--flipper-coin-size, calc(clamp(48px, min(38cqi, 26cqh), 300px) * var(--_d)));
  }
  .fw[data-fit="fill"][data-variant="card"] > .card > .body {
    flex: 1;
  }
  .fw[data-fit="fill"][data-variant="card"] .hero {
    flex: 1;
  }
  .fw[data-fit="fill"][data-variant="compact"] > .card {
    justify-content: center;
    --_coin: var(--flipper-coin-size, calc(clamp(40px, min(13cqi, 14cqh), 64px) * var(--_d)));
  }
  @container fw (min-width: 640px) {
    .fw[data-fit="fill"][data-variant="card"] > .card {
      --_coin: var(--flipper-coin-size, calc(clamp(96px, min(42cqi, 40cqh), 320px) * var(--_d)));
    }
  }
  /* short: drop the extras first, then tighten */
  @container fw (max-height: 560px) {
    .fw[data-fit="fill"][data-variant="card"] > .card {
      --_coin: var(--flipper-coin-size, calc(clamp(44px, min(36cqi, 20cqh), 220px) * var(--_d)));
    }
    .fw[data-fit="fill"][data-variant="card"] .hero .pitch {
      display: none;
    }
    .fw[data-fit="fill"][data-variant="card"] .hero .sub:not(.pitch) {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      margin-top: 4px;
    }
    .fw[data-fit="fill"][data-variant="card"] .status {
      min-height: 0;
    }
  }
  @container fw (max-height: 560px) and (min-width: 640px) {
    .fw[data-fit="fill"][data-variant="card"] > .card {
      --_coin: var(--flipper-coin-size, calc(clamp(80px, min(40cqi, 34cqh), 220px) * var(--_d)));
    }
    .fw[data-fit="fill"][data-variant="card"] .hero .pitch {
      display: block;
    }
  }
  @container fw (max-height: 500px) and (max-width: 639px) {
    .fw[data-fit="fill"][data-variant] > .card {
      --_gap: calc(6px * var(--_d));
    }
    .fw[data-fit="fill"][data-variant="card"] .details {
      display: none;
    }
  }
  @container fw (max-height: 440px) {
    .fw[data-fit="fill"][data-variant] > .card {
      --_gap: calc(6px * var(--_d));
      --_pad: calc(12px * var(--_d));
    }
  }
  /* (single column only: side by side, the coin has the column's full height) */
  @container fw (max-height: 440px) and (max-width: 639px) {
    .fw[data-fit="fill"][data-variant] > .card {
      --_coin: var(--flipper-coin-size, calc(clamp(40px, min(34cqi, 17cqh), 160px) * var(--_d)));
    }
    .fw[data-fit="fill"][data-variant="card"] .details,
    .fw[data-fit="fill"][data-variant="card"] .hero .tiny {
      display: none;
    }
  }
  @container fw (max-height: 380px) and (max-width: 639px) {
    .fw[data-fit="fill"][data-variant] > .card {
      --_coin: var(--flipper-coin-size, calc(clamp(36px, min(30cqi, 14cqh), 120px) * var(--_d)));
    }
  }
  @container fw (max-height: 380px) {
    .fw[data-fit="fill"] .foot {
      display: none;
    }
  }
  /* small and short: the token button shrinks to its logo instead of taking its own row (the balance line names it) */
  @container fw (max-height: 480px) {
    @container panel (max-width: 300px) {
      .fw[data-fit="fill"] .field:not(.single) {
        flex-wrap: nowrap;
      }
      .fw[data-fit="fill"] .field:not(.single) .token-btn {
        flex: none;
        padding: 0 6px 0 4px;
      }
      .fw[data-fit="fill"] .field:not(.single) .token-btn .sym {
        display: none;
      }
      .fw[data-fit="fill"] .field:not(.single) .amount {
        text-align: right;
      }
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .cta[data-busy]::after,
    .cta[data-drawing]::before,
    .pending-dot,
    .trigger-dot {
      animation: none;
    }
    .fade-in,
    .picker,
    .cta-label.swap,
    dialog[open] .card {
      animation: none;
    }
    .status,
    .hero > .coin-stage {
      transition: none;
    }
  }
  .fw[data-reduced] .status,
  .fw[data-reduced] .hero > .coin-stage {
    transition: none;
  }
  .fw[data-reduced] .fade-in,
  .fw[data-reduced] .picker,
  .fw[data-reduced] .cta-label.swap,
  .fw[data-reduced] .cta[data-busy]::after,
  .fw[data-reduced] .cta[data-drawing]::before,
  .fw[data-reduced] .pending-dot,
  .fw[data-reduced] .trigger-dot {
    animation: none;
  }
`;
