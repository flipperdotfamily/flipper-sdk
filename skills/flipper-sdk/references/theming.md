# Theming and white label

Three layers style the widget. Later layers win:
1. **CSS custom properties** from the host stylesheet: `flipper-widget { --flipper-accent: #ff5a1f; }`.
2. **The theme object** (`theme` property / prop, typed `FlipperTheme`), plus the shorthands `accent` and
   `radius`. They are applied as inline custom properties on the element, so they beat the stylesheet.
3. **`::part()`**, for anything the tokens don't cover.

Everything is scoped to the widget's Shadow DOM. Host CSS can't leak in, apart from these hooks.

## Decide what to ask

If the user hasn't said, infer these from the app and confirm:

| Question | Where to look | Option |
|---|---|---|
| Light / dark / follow the app? | a theme provider, `next-themes`, a `.dark` class, `prefers-color-scheme` usage | `theme="light" \| "dark" \| "auto"` |
| Brand colour | Tailwind `primary`, shadcn `--primary`, the MUI / Chakra theme, CSS variables | `accent` (plus `accentText` if it isn't hex or rgb) |
| Corner radius | `--radius`, the Tailwind `borderRadius` scale | `radius` (px, 0–40) or `theme.radius` (any CSS length) |
| Font | the body font | `theme.fontFamily: "inherit"` |
| Size / placement | a sidebar, a modal, a page | `variant: "card" \| "compact" \| "button"`, `theme.maxWidth`, `theme.density` |
| White label? | "our brand only", a partner app | `branding={false}`, `brandName`, `brandLogo`, `coinImage`, `coinImageTails`, `strings` |
| Language | i18n setup | `locale: "en" \| "es"`, `strings` |

## Mode

- `"auto"` (the default) follows the **OS** `prefers-color-scheme`. It does not see a `.dark` class or a
  `data-theme` attribute.
- Apps with their own toggle must pass the resolved mode and update it. For example: React
  `theme={isDark ? "dark" : "light"}`, Vue `:theme="isDark ? 'dark' : 'light'"`, vanilla `el.theme = "dark"`.
- In a theme object, use `mode`: `{ mode: isDark ? "dark" : "light", accent: … }`.

## The theme object (`FlipperTheme`)

Every field is optional. Unset colours keep the flipper palette of the current mode.

```ts
import type { FlipperTheme } from "@flipperdotfamily/widget";

const theme: FlipperTheme = {
  mode: "auto",                 // "light" | "dark" | "auto"
  accent: "#ff5a1f",            // CTA, focus ring, links, selection; text on it is picked for contrast
  accentText: "#ffffff",        // set it when the accent isn't hex / rgb (oklch, hsl, var(...))
  background: "#fff8f2",        // the card
  surface: "#ffffff",           // panels inside the card (the token picker)
  field: "#fbefe6",             // input field
  border: "#0000001a",
  text: "#1b1109", textMuted: "#1b110999", textSubtle: "#1b110966",
  win: "#c77700",               // wins: headline, halo, payout
  loss: "#d23a2e",              // errors and rejections
  radius: 16,                   // px number or CSS length; inner controls scale from it (default 24)
  fontFamily: "inherit",        // the host page's font
  displayFontFamily: "Georgia, serif",
  monoFontFamily: "ui-monospace, monospace",
  density: "comfortable",       // "compact" | "comfortable" (default) | "spacious"
  coinSize: 96,                 // px; default scales with the width, 88–132
  shadow: "none",               // card box-shadow
  borderWidth: 0,               // card border width, px
  maxWidth: "none",             // default 460px; "none" fills the container
  light: { background: "#ffffff" },   // per-mode overrides, applied over the flat colours
  dark: { background: "#140c06", text: "#fff3ea" },
};
```

`accent="#hex"` and `radius={16}` are shorthands for `theme.accent` / `theme.radius`. The `radius` shorthand is
clamped to 0–40.

## CSS custom properties

Set these on the element from the app's stylesheet. This is the easiest way to follow design tokens, including
per-mode values:

| Custom property | Theme key |
|---|---|
| `--flipper-accent`, `--flipper-accent-text` | `accent`, `accentText` |
| `--flipper-bg`, `--flipper-surface`, `--flipper-field`, `--flipper-border` | `background`, `surface`, `field`, `border` |
| `--flipper-text`, `--flipper-text-muted`, `--flipper-text-subtle` | `text`, `textMuted`, `textSubtle` |
| `--flipper-win`, `--flipper-loss` | `win`, `loss` |
| `--flipper-check`, `--flipper-check-launchpad` | none (CSS only): the token picker's checkmarks |
| `--flipper-radius`, `--flipper-border-width`, `--flipper-shadow`, `--flipper-max-width` | `radius`, `borderWidth`, `shadow`, `maxWidth` |
| `--flipper-backdrop` | none (CSS only): the default look's faint top light; off once `--flipper-bg` is set, `none` drops it |
| `--flipper-font`, `--flipper-font-display`, `--flipper-font-mono` | `fontFamily`, `displayFontFamily`, `monoFontFamily` |
| `--flipper-coin-size` | `coinSize` |

**shadcn/ui on Tailwind v4** (the tokens are full colours such as `oklch(...)`):

```css
flipper-widget {
  --flipper-accent: var(--primary);
  --flipper-accent-text: var(--primary-foreground);
  --flipper-bg: var(--card);
  --flipper-surface: var(--popover);
  --flipper-field: var(--muted);
  --flipper-border: var(--border);
  --flipper-text: var(--card-foreground);
  --flipper-text-muted: var(--muted-foreground);
  --flipper-radius: var(--radius);
  --flipper-font: var(--font-sans);
}
```

**shadcn/ui on Tailwind v3** (the tokens are bare HSL channels, such as `--primary: 222.2 47.4% 11.2%`): wrap each
one, e.g. `--flipper-accent: hsl(var(--primary)); --flipper-accent-text: hsl(var(--primary-foreground));`.

Keep the widget's `theme` mode in sync with the app's (see Mode). Unset tokens, and mode-specific styling, follow
it.

**Caveats:**
- `--flipper-font: inherit` does **not** inherit the page font: in a custom property, `inherit` inherits the
  property itself. Use `theme.fontFamily: "inherit"` (the object only), or set `--flipper-font` to a real
  font-family list.
- Contrast for the accent's text is computed only when the accent comes from `accent` / `theme.accent` and is hex
  or rgb. If you set `--flipper-accent` in CSS, or use `oklch` / `hsl` / `var()`, set `--flipper-accent-text` /
  `accentText` as well.
- The picker shows at most one checkmark per token row, next to the name. `--flipper-check` (default: the accent)
  colours tokens flipper whitelists, including $FLIPPER and ETH / WETH. `--flipper-check-launchpad` (`#d4fc50` on
  dark, with a dark tick; `#6b8a00` on light) colours launches a recognised launchpad vouches for. They have no
  `theme` key.

## `::part()`

The parts are `root`, `card`, `header`, `brand`, `account`, `coin`, `status`, `result`, `payout` (the pending-payout
block and the pending-wins banner), `field`, `token-button`, `amount-input`, `max-button`, `balance`, `odds`, `note`,
`cta`, `details`, `footer`, `picker`, `picker-search`, `picker-row`, `check` (a picker row's checkmark;
`check-launchpad` too on a launchpad-verified launch), `trigger` (the button variant) and `modal` (the button
variant's dialog).

```css
flipper-widget::part(cta) { text-transform: uppercase; letter-spacing: 0.04em; }
flipper-widget::part(card) { border: 2px solid #1b1109; box-shadow: 6px 6px 0 #1b1109; }
flipper-widget::part(trigger) { font-weight: 700; }
```

Style parts only. Don't reach into the shadow root, because internal class names change.

## White label

```tsx
<FlipperWidget
  branding={false}                          // removes the flipper marks: header dolphin, dolphin/fluke coin faces, footer
  brandName="Acme"                          // header name (replaces "flipper")
  brandLogo="https://acme.example/logo.svg" // header logo (square, ≥ 64 px)
  coinImage="https://acme.example/heads.png"       // heads face (square; transparent PNG / SVG works best)
  coinImageTails="https://acme.example/tails.png"  // tails face
  accent="#ff5a1f"
  tagline="Double or nothing on Acme"      // optional headline under the coin (off by default)
  strings={{ flip: "Flip {amount} {symbol} on Acme" }}
/>
```

The image hosts must be allowed by the page's CSP `img-src`. For the iframe / mobile embed they must be `https:`
URLs.

## Strings and locale

`locale` is `"en"` (the default) or `"es"`; regional tags like `es-MX` fall back to `es`. `strings` overrides
individual keys. `{name}` placeholders are filled in at render time, so keep them in your overrides. Useful keys:

| Key | Default |
|---|---|
| `tagline` / `taglineSub` | "Double or nothing" / "Heads pays {multiple} in {symbol}. Provably fair." (shown only with `tagline={true}`) |
| `connect`, `switchChain` | "Connect wallet", "Switch to {chain}" |
| `flip`, `flipAgain` | "Flip {amount} {symbol}", "Flip again" |
| `won`, `lost`, `refunded` | "You won.", "Not this time.", "Refunded." |
| `resultWon`, `resultLost` | "{amount} {symbol} was sent to your wallet.", "Your {stake} stake went to the house." |
| `payoutSettling`, `payoutOwed`, `retryPayout` | "Payout being settled", "{amount} {symbol} owed", "Retry payout" (a `WinPending` flip; the other `payout*` and `pendingWins*` keys cover the rest of that flow) |
| `checkListed`, `checkLaunchpad` | "Whitelisted by flipper", "Verified launch" (the picker checkmarks' tooltips; `verifiedBy` is deprecated and no longer shown) |
| `openWidget` | "Flip" (the button variant's label prefix; `buttonLabel` replaces the whole label) |
| `poweredBy` | "Powered by" |
| `notLive`, `unreachable`, `loading` | "Not live on this network yet", "Can't reach {chain}", "Loading…" |

The full table (about 110 keys) is `en` in `@flipperdotfamily/widget`: `import { en } from "@flipperdotfamily/widget"`. Unknown keys
and non-string values are ignored. For another language, pass a complete `strings` object built from `en`.

## Layout

- The widget lays out from its own box (container queries), not the viewport, from ~240 px to 1200+ px wide.
  - It is tighter below ~300 px. In picker mode the token button then takes its own row, or shows only its logo on
    short boxes.
  - From 640 px the coin sits beside the form, and the compact variant becomes a one-line bar from 960 px.
  - Type, spacing and the coin scale fluidly. It fills its container's width up to `maxWidth` (1120 px by default;
    `"none"` fills any width).
- Height: by default it follows the content, and `resize` events report it. With `fit="fill"` it takes the element's
  height too (a fixed-size card, a sidebar at `height: 100vh`, a fixed-height iframe with `/embed?fit=fill`):
  - the coin grows or shrinks with the height;
  - short boxes drop the opt-in tagline's second line, then the details and the footer;
  - it lays out down to ~240×360.
- `size="sm" | "md" | "lg"` scales everything (0.88×, 1×, 1.14×) on top of the fluid layout.
- `mode="single"` (with `token`) removes the token picker entirely: the amount row shows the token as a quiet label
  (`::part(token)`). `mode="picker"` is the default.
- `variant="compact"`: a smaller inline coin and denser spacing, for sidebars.
- Clean by default: no headline and no win chance / payout / fee line. When fees trim a flip's odds below the usual,
  a quiet "↓ Odds 0.9 pts below usual" (narrow: "Odds −0.9 pts") shows beside the balance, the deviation only.
  `details` adds the win chance / payout / fee line; `tagline` (`true` or your text) adds a headline under the coin.
- `variant="button"`: a trigger button that opens the card in a native `<dialog>`. Set its label with
  `buttonLabel`; open it with `el.open()` / `el.close()`.
- `reducedMotion` forces reduced motion on or off. By default it follows `prefers-reduced-motion`.
- Reserve space before the element upgrades: `flipper-widget:not(:defined) { display: block; min-height: 560px; }`
  (or give it a fixed size with `fit="fill"`).

## Theming the iframe / mobile embed

CSS variables and `::part()` don't cross an iframe or WebView. The embed takes:
- the URL params `theme` (mode), `accent`, `radius` (0–40), `branding`, `locale` and `compact`;
- everything else through the `config` param or a live `config` message: a full `theme` object, `brandName`,
  `brandLogo`, `coinImage(s)`, `strings`.

`fontFamily: "inherit"` there inherits the embed page's font (Manrope), not the host's. See
[iframe-bridge.md](iframe-bridge.md) and the mobile references.
