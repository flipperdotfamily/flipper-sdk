# Angular 17+: `@flipperdotfamily/angular`

`FlipperWidgetComponent` is a standalone component with the selector `flipper-widget`. Its host element **is** the
`<flipper-widget>` custom element, so no `CUSTOM_ELEMENTS_SCHEMA` is needed. On Angular < 17, use the raw element
(see [vanilla.md](vanilla.md) §5).

```sh
pnpm add @flipperdotfamily/angular      # or npm i / yarn add
# types (strict pnpm): pnpm add @flipperdotfamily/widget@<the version @flipperdotfamily/angular uses>
```

## API

```html
<flipper-widget [provider]="provider" theme="dark" partner="acme"
  (connectRequest)="open()" (flipSettled)="onSettled($event)"></flipper-widget>
```

- **Inputs:** the widget options in camelCase: `[provider]`, `[walletClient]`, `[chainId]`, `[theme]`, `accent`,
  `[radius]`, `partner`, `[tokens]`, `[branding]`, `brandName`, `[strings]`, `[addresses]`, `deploymentUrl`, …
  Static strings can be plain attributes (`theme="dark"`); anything else needs `[binding]`.
- **Outputs:** the payload is the event detail.

| Output | DOM event |
|---|---|
| `flipperReady` | `ready` |
| `connectRequest` | `connect-request` |
| `flipRequested` | `flip-requested` |
| `flipSettled` | `flip-settled` |
| `payoutResolved` | `payout-resolved` |
| `flipperListing` | `listing` |
| `flipperError` | `error` |
| `flipperResize` | `resize` |

The outputs are deliberately named apart from the DOM events. Binding the DOM name, e.g. `(flip-settled)`, also
works, but it gives the raw `CustomEvent` (`$event.detail`). **Bind one or the other, never both**, or the handler
runs twice.

- **`@ViewChild(FlipperWidgetComponent)`** gives `.element` (the custom element), `.open()`, `.close()` and
  `.refresh()`.
- **NgModule apps:** add `FlipperWidgetComponent` to the module's `imports` array. Standalone components can be
  imported into NgModules.

## 1. Wallet service (wagmi core; also Reown AppKit's Wagmi adapter)

```ts
// src/app/flipper-wallet.ts
import { getAccount, watchAccount, type Config } from "@wagmi/core";
import type { Eip1193Provider } from "@flipperdotfamily/widget";

/** Calls `onChange` with the connected wallet's EIP-1193 provider, or null while disconnected. Returns an unsubscribe. */
export function watchFlipperProvider(config: Config, onChange: (p: Eip1193Provider | null) => void): () => void {
  let seq = 0;
  const update = async () => {
    const id = ++seq;
    const { address, connector } = getAccount(config);
    let p: Eip1193Provider | null = null;
    if (address && connector) {
      try {
        p = (await connector.getProvider()) as Eip1193Provider;
      } catch {
        p = null;
      }
    }
    if (id === seq) onChange(p);
  };
  void update();
  return watchAccount(config, { onChange: () => void update() });
}
```

On wagmi 3, the actions are `getConnection` / `watchConnection`.

```ts
// src/app/flipper-wallet.service.ts
import { DestroyRef, Injectable, NgZone, PLATFORM_ID, inject, signal } from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import type { Eip1193Provider } from "@flipperdotfamily/widget";
import { watchFlipperProvider } from "./flipper-wallet";
import { wagmiConfig, modal } from "./wallet"; // the app's existing wallet setup (AppKit: wagmiAdapter.wagmiConfig)

@Injectable({ providedIn: "root" })
export class FlipperWalletService {
  /** The connected wallet's provider; null while disconnected (the widget is read-only then). */
  readonly provider = signal<Eip1193Provider | null>(null);

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return; // SSR: no wallet on the server
    const zone = inject(NgZone);
    const stop = watchFlipperProvider(wagmiConfig, (p) => zone.run(() => this.provider.set(p)));
    inject(DestroyRef).onDestroy(stop);
  }

  openConnect(): void {
    void modal.open(); // or whatever opens the app's connect UI
  }
}
```

- `zone.run` makes sure wallet events that fire outside Angular's zone still update the view.
- Add Robinhood Chain (4663) to the wagmi `chains` / AppKit `networks`, using the chain from
  [react.md](react.md) §1 (viem) or [vue.md](vue.md) §2 (AppKit).

## 2. A complete component

```ts
// src/app/flip/flip.component.ts
import { Component, ViewChild, inject } from "@angular/core";
import { FlipperWidgetComponent } from "@flipperdotfamily/angular";
import type { FlipperEventMap, FlipperTheme } from "@flipperdotfamily/widget";
import { FlipperWalletService } from "../flipper-wallet.service";

const THEME: FlipperTheme = { mode: "auto", accent: "#7c5cff", radius: 16, fontFamily: "inherit" };

@Component({
  selector: "app-flip",
  standalone: true,
  imports: [FlipperWidgetComponent],
  template: `
    <flipper-widget
      [provider]="wallet.provider()"
      [theme]="theme"
      partner="acme"
      (connectRequest)="wallet.openConnect()"
      (flipSettled)="onSettled($event)"
      (flipperError)="onError($event)"
    ></flipper-widget>
  `,
  styles: [`:host { display: block; max-width: 460px; margin: 0 auto; }`],
})
export class FlipComponent {
  readonly wallet = inject(FlipperWalletService);
  readonly theme = THEME;
  @ViewChild(FlipperWidgetComponent) flipper?: FlipperWidgetComponent;
  private readonly seen = new Set<string>();

  onSettled(d: FlipperEventMap["flip-settled"]): void {
    if (d.pending || this.seen.has(d.flipId)) return; // WinPending: a final flip-settled follows
    this.seen.add(d.flipId);
    // refresh the app's balances (a service call / signal), show a toast, track analytics…
  }

  onError(e: FlipperEventMap["error"]): void {
    if (e.code !== "user-rejected") console.warn("flipper:", e.context, e.message);
  }
}
```

- **Injected only:** in the service, `this.provider.set((window as any).ethereum ?? null)` inside the browser
  check, and no `(connectRequest)` handler: the widget calls `eth_requestAccounts`.
- **Button variant:** `variant="button"`, then `this.flipper?.open()` from the app's own button.

## 3. SSR (`@angular/ssr`)

- The component renders the `<flipper-widget>` tag on the server, and it upgrades in the browser.
- Keep wallet code behind `isPlatformBrowser`, as in the service, or in `afterNextRender(() => …)`.
- Hydration: if the app uses `provideClientHydration()` and Angular reports a mismatch on this component, add
  `ngSkipHydration` to it: `<flipper-widget ngSkipHydration …>`.
- Reserve space in the global styles: `flipper-widget:not(:defined) { display: block; min-height: 560px; }`.

## 4. Theming and config

- Hoist objects (`theme`, `strings`, `tokens`, `addresses`) into fields or constants, as above. A new object from
  a template expression on every change-detection pass re-applies it, and for `addresses` it reloads the
  deployment.
- To follow the app's dark mode, bind `[theme]="isDark() ? 'dark' : 'light'"`. `"auto"` follows the OS.
- Local dev, from `environment.ts`: `[chainId]="env.flipperLocal ? 31337 : undefined"` and
  `[deploymentUrl]="env.flipperLocal ? 'http://localhost:3000/embed/deployment.json' : undefined"`. `ng serve`
  defaults to :4200, which doesn't clash with flipper's :3000.
- CSP: add the sources from [vanilla.md](vanilla.md) §7 to the app's policy.

## 5. Gotchas

- **Double handlers.** `(flipSettled)` plus `(flip-settled)` on the same tag fires twice, once with the detail and
  once with the `CustomEvent`. Pick one; prefer the outputs.
- **`(error)` / `(ready)` / `(resize)` / `(listing)`** bind the raw DOM events (a `CustomEvent`). The outputs are
  `flipperError`, `flipperReady`, `flipperResize` and `flipperListing`.
- **Don't add `CUSTOM_ELEMENTS_SCHEMA`.** It hides binding typos, and the component doesn't need it.
- **Zoneless apps** (`provideExperimentalZonelessChangeDetection` / `provideZonelessChangeDetection`): signals
  update the view on their own, and `zone.run` is harmless.
