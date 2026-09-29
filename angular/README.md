# @flipperdotfamily/angular

Angular (17+) standalone component for [flipper.family](https://flipper.family) coin flips. Its selector is
`flipper-widget`, so the host element *is* the [`<flipper-widget>`](../widget) web component: you get typed inputs
and outputs, and no `CUSTOM_ELEMENTS_SCHEMA`. It is partially compiled (Ivy), so it works in zone.js and zoneless
apps.

```sh
npm i @flipperdotfamily/angular
```

```ts
import { Component, signal } from "@angular/core";
import { FlipperWidgetComponent, type Eip1193Provider, type FlipperEventMap } from "@flipperdotfamily/angular";

@Component({
  selector: "app-flip",
  standalone: true,
  imports: [FlipperWidgetComponent],
  template: `
    <flipper-widget
      [provider]="provider()"
      theme="dark"
      accent="#dd0031"
      partner="acme"
      (connectRequest)="openWalletModal()"
      (flipSettled)="onSettled($event)"
    ></flipper-widget>
  `,
})
export class FlipComponent {
  provider = signal<Eip1193Provider | null>(null); // from your wallet service (Reown AppKit, wagmi core, ethers…)
  openWalletModal() { /* … then provider.set(eip1193Provider) */ }
  onSettled(d: FlipperEventMap["flip-settled"]) { console.log(d.outcome, d.payout); }
}
```

- **Inputs**: every widget option (see the [widget README](../widget#configuration)). Booleans and numbers accept
  attribute strings (`branding="false"`, `radius="12"`, `chainId="robinhood"`).
- **Outputs** carry the `detail`: `flipperReady`, `connectRequest`, `flipRequested`, `flipSettled`,
  `payoutResolved`, `flipperListing`, `flipperError`, `flipperResize`. They're named apart from the element's DOM events
  (`flip-settled`…) on purpose: Angular also binds a native listener for a matching name, which would fire your
  handler twice. Subscribing to `connectRequest` means you open your own wallet UI (the widget skips its
  `eth_requestAccounts` fallback).
- **`@ViewChild(FlipperWidgetComponent)`** gives `.element`, `.open()`, `.close()`, `.refresh()`.
- The coin animation runs outside the Angular zone, so zone.js apps don't run change detection every frame.

Docs: [flipper.family/docs/integrate](https://flipper.family/docs/integrate) · Example: [`examples/angular`](../examples/angular)
