import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  Output,
  booleanAttribute,
  numberAttribute,
  type OnChanges,
  type OnDestroy,
  type OnInit,
  type SimpleChanges,
} from "@angular/core";
import "@flipperdotfamily/widget";
import type { FlipperEventMap, FlipperWidget as FlipperWidgetElement, FlipperWidgetConfig } from "@flipperdotfamily/widget";

type Cfg = FlipperWidgetConfig;
const CHAIN_ALIASES: Record<string, number> = { ink: 57073, robinhood: 4663, local: 31337 };
/** Input transforms (function declarations: Angular resolves them statically). */
export function optionalBoolean(v: unknown): boolean | undefined {
  return v === undefined || v === null ? undefined : booleanAttribute(v);
}
/** `tagline` (bare) or "true" → true; "false" → false; any other string is the headline itself. */
export function taglineInput(v: unknown): string | boolean | undefined {
  if (v === undefined || v === null || typeof v === "boolean") return v ?? undefined;
  const t = String(v).trim();
  return t === "" || t === "true" ? true : t === "false" ? false : String(v);
}
export function optionalNumber(v: unknown): number | undefined {
  return v === undefined || v === null || v === "" ? undefined : numberAttribute(v);
}
export function chainAttribute(v: unknown): number | undefined {
  // own keys only: "constructor", "__proto__" and friends aren't chains
  if (typeof v === "string" && Object.prototype.hasOwnProperty.call(CHAIN_ALIASES, v.toLowerCase())) return CHAIN_ALIASES[v.toLowerCase()];
  return optionalNumber(v);
}

const EVENTS = {
  ready: "flipperReady",
  "connect-request": "connectRequest",
  "flip-requested": "flipRequested",
  "flip-settled": "flipSettled",
  "payout-resolved": "payoutResolved",
  listing: "flipperListing",
  error: "flipperError",
  resize: "flipperResize",
} as const;

/**
 * `<flipper-widget>` for Angular (standalone; the host element IS the web component, so no CUSTOM_ELEMENTS_SCHEMA).
 *
 * ```html
 * <flipper-widget [provider]="provider" theme="dark" partner="acme"
 *   (connectRequest)="openWalletModal()" (flipSettled)="onSettled($event)"></flipper-widget>
 * ```
 *
 * Outputs are named apart from the element's DOM events (`flipSettled` vs `flip-settled`) because Angular binds a
 * native listener as well as the output for a matching name, which would call your handler twice.
 */
@Component({
  selector: "flipper-widget",
  standalone: true,
  template: "",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlipperWidgetComponent implements OnInit, OnChanges, OnDestroy {
  @Input() provider: Cfg["provider"];
  @Input() walletClient: Cfg["walletClient"];
  @Input({ transform: chainAttribute }) chainId: number | undefined;
  @Input() rpcUrl: string | undefined;
  @Input() apiUrl: string | null | undefined;
  @Input() deploymentUrl: string | null | undefined;
  @Input() addresses: Cfg["addresses"];
  @Input() token: string | undefined;
  @Input() tokens: string[] | undefined;
  /** "picker" (default) or "single" (needs `token`; the picker isn't rendered). */
  @Input() mode: Cfg["mode"];
  /** @deprecated use `mode="single"` */
  @Input({ transform: optionalBoolean }) hidePicker: boolean | undefined;
  @Input({ transform: optionalBoolean }) eth: boolean | undefined;
  @Input({ transform: optionalBoolean }) listing: boolean | undefined;
  @Input() minAmount: string | undefined;
  @Input() maxAmount: string | undefined;
  @Input() approval: Cfg["approval"];
  @Input() variant: Cfg["variant"];
  /** "auto" (height follows the content) or "fill" (fill the element's height). */
  @Input() fit: Cfg["fit"];
  @Input() size: Cfg["size"];
  /** Show the win chance / payout / fee line under the button (default off). */
  @Input({ transform: optionalBoolean }) details: boolean | undefined;
  /** Idle headline under the coin: true = the built-in one, a string = your own (default none). */
  @Input({ transform: taglineInput }) tagline: string | boolean | undefined;
  @Input() theme: Cfg["theme"];
  @Input() accent: string | undefined;
  @Input({ transform: optionalNumber }) radius: number | undefined;
  @Input({ transform: optionalBoolean }) branding: boolean | undefined;
  @Input() brandName: string | undefined;
  @Input() brandLogo: string | undefined;
  @Input() coinImage: string | undefined;
  @Input() coinImageTails: string | undefined;
  @Input() buttonLabel: string | undefined;
  @Input() locale: string | undefined;
  @Input() strings: Cfg["strings"];
  @Input({ transform: optionalBoolean }) reducedMotion: boolean | undefined;
  @Input() partner: string | undefined;
  /** Handle connect requests yourself (or subscribe to `connectRequest`). */
  @Input() onConnectRequest: Cfg["onConnectRequest"];

  @Output() readonly flipperReady = new EventEmitter<FlipperEventMap["ready"]>();
  @Output() readonly connectRequest = new EventEmitter<FlipperEventMap["connect-request"]>();
  @Output() readonly flipRequested = new EventEmitter<FlipperEventMap["flip-requested"]>();
  @Output() readonly flipSettled = new EventEmitter<FlipperEventMap["flip-settled"]>();
  /** A pending win (WinPending) was paid out: by this widget's Retry payout (`by: "self"`) or someone else. Once per flip. */
  @Output() readonly payoutResolved = new EventEmitter<FlipperEventMap["payout-resolved"]>();
  @Output() readonly flipperListing = new EventEmitter<FlipperEventMap["listing"]>();
  @Output() readonly flipperError = new EventEmitter<FlipperEventMap["error"]>();
  @Output() readonly flipperResize = new EventEmitter<FlipperEventMap["resize"]>();

  private offs: (() => void)[] = [];

  constructor(
    private readonly host: ElementRef<FlipperWidgetElement>,
    private readonly zone: NgZone,
  ) {}

  /** The underlying `<flipper-widget>` element. */
  get element(): FlipperWidgetElement {
    return this.host.nativeElement;
  }
  open(): void {
    void this.element.open?.();
  }
  close(): void {
    this.element.close?.();
  }
  refresh(): void {
    this.element.refresh?.();
  }

  ngOnInit(): void {
    const node = this.element;
    for (const [name, output] of Object.entries(EVENTS)) {
      const emitter = this[output] as EventEmitter<unknown>;
      const fn = (e: Event) => {
        if (!emitter.observed) return;
        // a subscribed (connectRequest) means the app opens its own wallet UI: skip the widget's fallback
        if (name === "connect-request") e.preventDefault();
        this.zone.run(() => emitter.emit((e as CustomEvent).detail));
      };
      node.addEventListener(name, fn);
      this.offs.push(() => node.removeEventListener(name, fn));
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    const node = this.element as unknown as Record<string, unknown>;
    for (const [key, change] of Object.entries(changes)) {
      if (key === "onConnectRequest") {
        const fn = change.currentValue as Cfg["onConnectRequest"];
        node["onConnectRequest"] = fn ? (d: FlipperEventMap["connect-request"]) => this.zone.run(() => fn(d)) : undefined;
        continue;
      }
      if (change.currentValue !== undefined || change.previousValue !== undefined) node[key] = change.currentValue;
    }
  }

  ngOnDestroy(): void {
    this.offs.splice(0).forEach((off) => off());
  }
}
