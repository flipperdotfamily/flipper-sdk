/**
 * Self-contained widget stylesheet. Every selector is scoped under `.flw` so nothing leaks into (or depends
 * on) the host page; no Tailwind or CSS pipeline is needed. Rendered through React 19's <style href precedence>
 * so it is hoisted into <head> once, SSR included.
 */
export const WIDGET_STYLE_ID = "flipper-widget-v1";

export const WIDGET_CSS = /* css */ `
.flw {
  --flw-bg: #0a1b26; --flw-surface: #0e2230; --flw-field: #13293a; --flw-line: #cdeeff17; --flw-line-2: #cdeeff29;
  --flw-text: #eaf6fb; --flw-muted: #eaf6fb99; --flw-subtle: #eaf6fb66;
  --flw-accent: #4cc2ff; --flw-accent-hover: #69ccff; --flw-accent-ink: #031a2b; --flw-accent-soft: #143447;
  --flw-link: var(--flw-accent);
  --flw-win: #f5c451; --flw-loss: #ff6b5e;
  --flw-shadow: 0 1px 2px #00070c73, 0 8px 24px #00070c66, inset 0 1px 0 #cdeeff12;
  --flw-font: var(--font-manrope, Manrope), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --flw-display: var(--font-satoshi, Satoshi), var(--font-manrope, Manrope), ui-sans-serif, system-ui, sans-serif;
  --flw-mono: var(--font-jetbrains, "JetBrains Mono"), ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --flw-ease: cubic-bezier(.22,1,.36,1);
  position: relative; box-sizing: border-box; width: 100%; max-width: 380px; padding: 18px;
  border-radius: 24px; border: 1px solid var(--flw-line); background: var(--flw-bg); color: var(--flw-text);
  box-shadow: var(--flw-shadow); font: 400 14px/1.45 var(--flw-font); -webkit-font-smoothing: antialiased;
  overflow: hidden; isolation: isolate; text-align: left;
}
.flw[data-theme="light"] {
  --flw-bg: #ffffff; --flw-surface: #f5f9fc; --flw-field: #eef4f8; --flw-line: #0e3a5a1c; --flw-line-2: #0e3a5a2e;
  --flw-text: #0b2239; --flw-muted: #0b2239a6; --flw-subtle: #0b223980;
  --flw-accent: #0a6aa2; --flw-accent-hover: #08588a; --flw-accent-ink: #ffffff; --flw-accent-soft: #e3f2fb;
  --flw-link: #08588a;
  --flw-win: #946200; --flw-loss: #c7372c;
  --flw-shadow: 0 1px 2px #1a4a6e0f, 0 8px 24px #1a4a6e14, inset 0 1px 0 #ffffff;
}
:where(.flw) *, :where(.flw) *::before, :where(.flw) *::after { box-sizing: border-box; }
.flw::before { /* faint sky bloom behind the coin */
  content: ""; position: absolute; z-index: -1; width: 240px; height: 240px; left: -70px; top: -110px; border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--flw-accent) 16%, transparent), transparent 65%);
  pointer-events: none;
}
:where(.flw) button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; padding: 0; margin: 0; }
:where(.flw) button:disabled { cursor: not-allowed; }
.flw :focus-visible { outline: 2px solid var(--flw-accent); outline-offset: 2px; }

.flw-head { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
.flw-title { font: 700 20px/1.05 var(--flw-display); letter-spacing: -0.03em; margin: 0; }
.flw-sub { margin: 3px 0 0; font-size: 12px; color: var(--flw-muted); }
.flw-sub a { color: inherit; text-decoration: none; border-bottom: 1px solid var(--flw-line-2); }

.flw-field { display: flex; align-items: center; gap: 10px; padding: 10px 10px 10px 14px; border-radius: 14px;
  background: var(--flw-field); border: 1px solid var(--flw-line); transition: border-color .18s, box-shadow .18s; }
.flw-field:focus-within { border-color: color-mix(in srgb, var(--flw-accent) 90%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--flw-accent) 18%, transparent); }
.flw-input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--flw-text);
  font: 500 26px/1.1 var(--flw-mono); letter-spacing: -0.03em; font-variant-numeric: tabular-nums; padding: 2px 0; }
.flw-input::placeholder { color: var(--flw-subtle); }
.flw .flw-input:focus, .flw .flw-input:focus-visible { outline: none; box-shadow: none; } /* the field draws the ring */
.flw-sym { font: 600 13px/1 var(--flw-font); color: var(--flw-muted); }
.flw-max { padding: 6px 9px; border-radius: 10px; background: var(--flw-accent-soft); color: var(--flw-link);
  font: 600 11px/1 var(--flw-font); letter-spacing: .06em; }
.flw-max:disabled { opacity: .45; }

.flw-meta { display: flex; justify-content: space-between; gap: 8px; margin: 8px 2px 0; font-size: 12px; color: var(--flw-muted); }
.flw-num { font-family: var(--flw-mono); font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }

.flw-odds { display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; margin: 14px 2px 0; font-size: 13px; }
.flw-odds dt { color: var(--flw-muted); margin: 0; }
.flw-odds dd { margin: 0; text-align: right; font-family: var(--flw-mono); font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.flw-odds dd.flw-strong { color: var(--flw-text); font-weight: 600; }
.flw-odds dd.flw-shifted { color: var(--flw-win); }

.flw-note { margin: 12px 0 0; padding: 10px 12px; border-radius: 12px; font-size: 12.5px; line-height: 1.45;
  background: color-mix(in srgb, var(--flw-win) 9%, transparent); border: 1px solid color-mix(in srgb, var(--flw-win) 30%, transparent); }
.flw-note b { font-weight: 600; }
.flw-note--error { background: color-mix(in srgb, var(--flw-loss) 9%, transparent); border-color: color-mix(in srgb, var(--flw-loss) 30%, transparent); }
.flw-link { color: var(--flw-link); font-weight: 600; text-decoration: underline; text-underline-offset: 2px; }

.flw-cta { position: relative; display: block; width: 100%; min-height: 50px; margin-top: 14px; border-radius: 16px;
  background: var(--flw-accent); color: var(--flw-accent-ink); font: 600 16px/1 var(--flw-font);
  letter-spacing: -0.01em; transition: background .18s, transform .12s, box-shadow .18s, opacity .18s; overflow: hidden; }
.flw-cta:hover:not(:disabled) { background: var(--flw-accent-hover);
  box-shadow: 0 8px 28px color-mix(in srgb, var(--flw-accent) 30%, transparent); }
.flw-cta:active:not(:disabled) { transform: scale(.985); }
.flw-cta:disabled { opacity: .45; }
.flw-cta[data-busy="true"] { opacity: 1; cursor: progress; }
.flw-cta[data-busy="true"]::after { content: ""; position: absolute; left: 0; bottom: 0; height: 3px; width: 42%;
  background: color-mix(in srgb, var(--flw-accent-ink) 55%, transparent); border-radius: 3px; animation: flw-load 1.15s ease-in-out infinite; }
@keyframes flw-load { 0% { transform: translateX(-100%); } 100% { transform: translateX(240%); } }

.flw-result { margin: 14px 2px 0; }
.flw-headline { margin: 0; font: 700 28px/1 var(--flw-display); letter-spacing: -0.03em; }
.flw-headline[data-tone="win"] { color: var(--flw-win); }
.flw-headline[data-tone="loss"] { color: var(--flw-muted); }
.flw-detail { margin: 6px 0 0; font-size: 13px; color: var(--flw-muted); }
.flw-fair { margin: 6px 0 0; font: 400 11px/1.3 var(--flw-mono); color: var(--flw-subtle); }
.flw-foot { display: flex; justify-content: space-between; margin-top: 12px; font-size: 11px; color: var(--flw-subtle); }
.flw-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* mini coin: CSS 3D. No filter/opacity/mask on .flw-coin or .flw-coin-lift (they would flatten preserve-3d). */
.flw-stage { position: relative; flex: none; width: 64px; height: 64px; perspective: 420px; }
.flw-halo { position: absolute; inset: -60%; border-radius: 50%; pointer-events: none;
  background: radial-gradient(circle, color-mix(in srgb, var(--flw-win) 60%, transparent), transparent 60%); filter: blur(10px); }
.flw-coin-lift { position: absolute; inset: 0; transform-style: preserve-3d; }
.flw-coin { position: absolute; inset: 0; transform-style: preserve-3d; }
.flw-rim { position: absolute; inset: 0; border-radius: 50%;
  background: repeating-conic-gradient(from 0deg, #ffffff22 0 3deg, #00000033 3deg 6deg), linear-gradient(180deg, #f4f4ef, #9d9d97 45%, #2a2a28); }
.flw-face { position: absolute; inset: 0; border-radius: 50%; overflow: hidden; backface-visibility: hidden; -webkit-backface-visibility: hidden;
  transform: translateZ(3px);
  background: radial-gradient(circle, transparent 0 62%, #00000029 72%, transparent 73%),
    linear-gradient(calc(158deg + var(--flw-spec, 0) * 40deg), #fbfbf8 0%, #e4e4de 20%, #9a9a94 34%, #3c3c39 35.5%, #2a2a28 46%, #6d6d68 60%, #e9e9e3 63%, #b8b8b1 78%, #4a4a46 100%);
  box-shadow: inset 0 0 0 1px #ffffff40, inset 0 0 0 3px #00000026; }
.flw-face--tails { transform: rotateX(180deg) translateZ(3px); }
.flw-glyph { position: absolute; inset: 16%; width: 68%; height: 68%; overflow: visible;
  filter: drop-shadow(0 1px 0 #ffffffb3) drop-shadow(0 -1px 0 #00000080); }
`;
