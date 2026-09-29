import {
  FlipStatus,
  formatDuration,
  formatMultiple,
  formatTokenAmount,
  formatWinChance,
  oddsShift,
  parseChainId,
  payoutBps,
  rejectReason,
  safeHttpUrl,
  shortAddress,
  type Settlement,
} from "@flipperdotfamily/sdk";
import { LitElement, html, nothing, svg, type PropertyValues, type TemplateResult } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { CoinAnimator, type CoinState } from "./coin";
import { FlipperController, type PendingPayout, type WidgetToken } from "./controller";
import { DOLPHIN_D, FLUKE_D, dolphin, icons } from "./icons";
import { chainLabel, neutral } from "./neutral";
import { en, fmt, stringsFor, type FlipperStrings } from "./strings";
import { styles } from "./styles";
import { normalizeColor, parseTheme, resolveMode, themeVars } from "./theme";
import { TokenListModel } from "./tokens";
import type { FlipperEventMap, FlipperFit, FlipperMode, FlipperSize, FlipperTheme, FlipperThemeMode, FlipperVariant, FlipperWidgetConfig } from "./types";

// ── attribute converters ───────────────────────────────────────────────────────────────────────────────
const trueUnlessFalse = { fromAttribute: (v: string | null) => !(v !== null && /^(false|0|off|no)$/i.test(v.trim())) };
const optionalBool = { fromAttribute: (v: string | null) => (v === null ? undefined : !/^(false|0|off|no)$/i.test(v.trim())) };
/** `tagline` (bare, "true") → the built-in headline; "false" / "off" → none; anything else is the text itself */
const taglineAttr = {
  fromAttribute: (v: string | null) => (v === null ? undefined : /^(|true)$/i.test(v.trim()) ? true : /^(false|0|off|no|none)$/i.test(v.trim()) ? false : v),
};
const list = { fromAttribute: (v: string | null) => (v ? v.split(/[\s,]+/).filter(Boolean) : undefined) };
const json = {
  fromAttribute: (v: string | null) => {
    if (!v) return undefined;
    try {
      return JSON.parse(v);
    } catch {
      return undefined;
    }
  },
};
const chain = { fromAttribute: (v: string | null) => parseChainId(v ?? undefined) };
const nullable = { fromAttribute: (v: string | null) => (v === null ? undefined : /^(null|none|off)$/i.test(v.trim()) ? null : v) };

const NETWORK_KEYS = ["chainId", "rpcUrl", "apiUrl", "deploymentUrl", "addresses"] as const;
const THEME_KEYS = ["theme", "accent", "radius"] as const;
let uid = 0;

/**
 * `<flipper-widget>`: the drop-in flip UI. Wallets come from the host (`provider` or `walletClient`); reads use the
 * widget's own RPC. See the README for every option, event and CSS hook.
 *
 * @fires ready
 * @fires connect-request - cancelable; call preventDefault() when you open your own wallet UI
 * @fires flip-requested
 * @fires flip-settled
 * @fires payout-resolved - a pending win (WinPending) was paid out: by this widget's Retry payout, or by someone else
 * @fires listing
 * @fires error
 * @fires resize
 * @csspart root, card, header, brand, account, coin, status, result, payout, field, token-button, amount-input, max-button,
 *   balance, odds, note, cta, details, footer, picker, picker-search, picker-row, check, check-launchpad,
 *   trigger, modal
 */
export class FlipperWidget extends LitElement {
  static override styles = styles;
  static override properties = {
    provider: { attribute: false },
    walletClient: { attribute: false },
    onConnectRequest: { attribute: false },
    chainId: { attribute: "chain-id", converter: chain },
    rpcUrl: { attribute: "rpc-url" },
    apiUrl: { attribute: "api-url", converter: nullable },
    deploymentUrl: { attribute: "deployment-url", converter: nullable },
    allowUnpinnedDeployment: { attribute: false },
    addresses: { converter: json },
    token: {},
    tokens: { converter: list },
    mode: {},
    fit: { reflect: true },
    size: {},
    details: { converter: optionalBool },
    tagline: { converter: taglineAttr },
    hidePicker: { attribute: "hide-picker", type: Boolean },
    eth: { converter: trueUnlessFalse },
    listing: { converter: trueUnlessFalse },
    minAmount: { attribute: "min-amount" },
    maxAmount: { attribute: "max-amount" },
    approval: {},
    variant: { reflect: true },
    theme: { converter: { fromAttribute: (v: string | null) => (v ? parseTheme(v) : undefined) } },
    accent: {},
    radius: { type: Number },
    branding: { converter: trueUnlessFalse },
    brandName: { attribute: "brand-name" },
    brandLogo: { attribute: "brand-logo" },
    coinImage: { attribute: "coin-image" },
    coinImageTails: { attribute: "coin-image-tails" },
    buttonLabel: { attribute: "button-label" },
    locale: {},
    strings: { attribute: false },
    reducedMotion: { attribute: "reduced-motion", converter: optionalBool },
    partner: {},
    _picker: { state: true },
    _active: { state: true },
    _modal: { state: true },
    _mode: { state: true },
    _prefReduced: { state: true },
  };

  declare provider: FlipperWidgetConfig["provider"];
  declare walletClient: FlipperWidgetConfig["walletClient"];
  declare onConnectRequest: FlipperWidgetConfig["onConnectRequest"];
  declare chainId: number | undefined;
  declare rpcUrl: string | undefined;
  declare apiUrl: string | null | undefined;
  declare deploymentUrl: string | null | undefined;
  /** property only (never an attribute or URL param): accept a manifest that isn't the SDK's pinned deployment */
  declare allowUnpinnedDeployment: boolean | undefined;
  declare addresses: FlipperWidgetConfig["addresses"];
  declare token: string | undefined;
  declare tokens: string[] | undefined;
  declare mode: FlipperMode | undefined;
  declare fit: FlipperFit | undefined;
  declare size: FlipperSize | undefined;
  declare details: boolean | undefined;
  declare tagline: string | boolean | undefined;
  /** @deprecated use `mode="single"` */
  declare hidePicker: boolean;
  declare eth: boolean;
  declare listing: boolean;
  declare minAmount: string | undefined;
  declare maxAmount: string | undefined;
  declare approval: "max" | "exact" | undefined;
  declare variant: FlipperVariant;
  declare theme: FlipperThemeMode | FlipperTheme | undefined;
  declare accent: string | undefined;
  declare radius: number | undefined;
  declare branding: boolean;
  declare brandName: string | undefined;
  declare brandLogo: string | undefined;
  declare coinImage: string | undefined;
  declare coinImageTails: string | undefined;
  declare buttonLabel: string | undefined;
  declare locale: string | undefined;
  declare strings: Partial<FlipperStrings> | undefined;
  declare reducedMotion: boolean | undefined;
  declare partner: string | undefined;
  declare private _picker: boolean;
  declare private _active: number;
  declare private _modal: boolean;
  declare private _mode: "light" | "dark";
  declare private _prefReduced: boolean;

  /** @internal */
  readonly ctl: FlipperController;
  private tokenList: TokenListModel;
  private s: FlipperStrings = en;
  private coin?: CoinAnimator;
  private themeProps = new Set<string>();
  private mqDark?: MediaQueryList;
  private mqReduced?: MediaQueryList;
  private ro?: ResizeObserver;
  private io?: IntersectionObserver;
  private lastSize = "";
  private uidp = `fw${++uid}`;
  private configured = false;
  private initialPending = false;

  constructor() {
    super();
    this.hidePicker = false;
    this.eth = true;
    this.listing = true;
    this.branding = true;
    this.variant = "card";
    this._picker = false;
    this._active = 0;
    this._modal = false;
    this._mode = "dark";
    this._prefReduced = false;
    this.ctl = new FlipperController(this);
    this.tokenList = new TokenListModel(this.ctl, () => this.requestUpdate());
  }

  /** The effective configuration (properties merged). */
  get cfg(): FlipperWidgetConfig {
    return {
      provider: this.provider,
      walletClient: this.walletClient,
      onConnectRequest: this.onConnectRequest,
      chainId: this.chainId,
      rpcUrl: this.rpcUrl,
      apiUrl: this.apiUrl,
      deploymentUrl: this.deploymentUrl,
      allowUnpinnedDeployment: this.allowUnpinnedDeployment,
      addresses: this.addresses,
      token: this.token,
      tokens: this.tokens,
      mode: this.mode,
      hidePicker: this.hidePicker,
      eth: this.eth,
      listing: this.listing,
      minAmount: this.minAmount,
      maxAmount: this.maxAmount,
      approval: this.approval,
      variant: this.variant,
      theme: this.theme,
      branding: this.branding,
      partner: this.partner,
    };
  }

  /** The underlying @flipperdotfamily/sdk client (read-only use; recreated when the chain or wallet changes). */
  get client() {
    return this.ctl.client;
  }

  /** Button variant: open / close the modal. */
  async open() {
    if (this.variant !== "button") return;
    this._modal = true;
    await this.updateComplete;
    const d = this.renderRoot.querySelector("dialog");
    if (d && !d.open) d.showModal();
  }
  close() {
    const d = this.renderRoot.querySelector("dialog");
    if (d?.open) d.close();
    this._modal = false;
    // reopening starts on the card, not on a picker left open
    this._picker = false;
  }
  /** Re-read the wallet's accounts and chain, and balances (e.g. right after your app connected the provider). */
  refresh() {
    void this.ctl.resync();
  }

  /** Dispatches a (non-bubbling) CustomEvent; returns false when a listener called preventDefault(). */
  emit<K extends keyof FlipperEventMap>(name: K, detail: FlipperEventMap[K], cancelable = false): boolean {
    return this.dispatchEvent(new CustomEvent(name, { detail, cancelable }));
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────────────────────────────────
  override connectedCallback() {
    super.connectedCallback();
    if (typeof matchMedia !== "undefined") {
      this.mqDark = matchMedia("(prefers-color-scheme: dark)");
      this.mqReduced = matchMedia("(prefers-reduced-motion: reduce)");
      this.mqDark.addEventListener("change", this.onMedia);
      this.mqReduced.addEventListener("change", this.onMedia);
      this._prefReduced = this.mqReduced.matches;
    }
    this.applyTheme();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.mqDark?.removeEventListener("change", this.onMedia);
    this.mqReduced?.removeEventListener("change", this.onMedia);
    this.ro?.disconnect();
    this.ro = undefined;
    this.io?.disconnect();
    this.coin?.destroy();
    this.coin = undefined;
  }

  private onMedia = () => {
    this._prefReduced = !!this.mqReduced?.matches;
    this.applyTheme();
    this.coin?.refresh();
  };

  private get reduced() {
    return this.reducedMotion ?? this._prefReduced;
  }

  protected override willUpdate(changed: PropertyValues) {
    if (changed.has("locale") || changed.has("strings") || !this.configured) this.s = stringsFor(this.locale, this.strings);
    if (THEME_KEYS.some((k) => changed.has(k))) this.applyTheme();
    if (!this.configured) {
      // Resolve the deployment one task later: frameworks set their properties right after mounting (React layout
      // effects, Vue mounted, Svelte effects, Angular inputs), and the first resolve should see them.
      this.configured = true;
      this.initialPending = true;
      setTimeout(() => {
        this.initialPending = false;
        void this.ctl.setWallet();
        void this.ctl.configure();
      }, 0);
      return;
    }
    if (this.initialPending) return;
    if (NETWORK_KEYS.some((k) => changed.has(k))) {
      this.tokenList.reset();
      void this.ctl.configure();
    } else if (changed.has("token") || changed.has("tokens") || changed.has("eth") || changed.has("mode") || changed.has("hidePicker")) {
      this.tokenList.reset();
      void this.ctl.setTokenOption();
    }
    if (changed.has("provider") || changed.has("walletClient")) void this.ctl.setWallet();
    if ((changed.has("mode") || changed.has("hidePicker") || changed.has("tokens")) && this.singleMode) this._picker = false;
    if (changed.has("partner")) {
      this.ctl.refreshPartner();
      this.tokenList.reset();
    }
  }

  protected override updated() {
    // (re)attach the coin animator whenever the coin's DOM was (re)created (variant switch, modal open)
    const stage = this.renderRoot.querySelector<HTMLElement>(".coin-stage");
    if (stage && this.coin && this.coin.stage !== stage) {
      this.coin.destroy();
      this.coin = undefined;
    }
    if (stage && !this.coin) {
      const q = <T extends HTMLElement>(sel: string) => stage.querySelector<T>(sel)!;
      this.coin = new CoinAnimator(
        { stage, lift: q(".coin-lift"), coin: q(".coin"), halo: q(".coin-halo"), shadow: q(".coin-shadow"), fx: q(".coin-fx") },
        () => this.reduced,
      );
      this.coin.onLanded = (_won, key) => this.ctl.landed(key);
    } else if (!stage && this.coin) {
      this.coin.destroy();
      this.coin = undefined;
    }
    this.coin?.setState(this.coinState());
    // resize events (iframe / WebView hosts size themselves from these)
    const root = this.renderRoot.querySelector<HTMLElement>(".fw");
    if (root && !this.ro && typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => this.reportSize());
      this.ro.observe(root);
      const card = root.querySelector(".card, .trigger");
      if (card) this.ro.observe(card);
    }
    // infinite scroll in the picker
    const sentinel = this.renderRoot.querySelector(".sentinel");
    const listEl = this.renderRoot.querySelector(".list");
    if (sentinel && listEl && typeof IntersectionObserver !== "undefined") {
      this.io?.disconnect();
      this.io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && void this.tokenList.loadMore(), { root: listEl, rootMargin: "0px 0px 240px 0px" });
      this.io.observe(sentinel);
    } else if (!sentinel) {
      this.io?.disconnect();
      this.io = undefined;
    }
  }

  private reportSize() {
    requestAnimationFrame(() => {
      if (!this.isConnected) return;
      const el = this.renderRoot.querySelector<HTMLElement>(".fw");
      if (!el) return;
      const r = this.getBoundingClientRect();
      const box = el.firstElementChild?.getBoundingClientRect();
      const width = Math.round(r.width);
      const height = Math.ceil(Math.max(r.height, box?.height ?? 0));
      const key = `${width}x${height}`;
      if (key === this.lastSize) return;
      this.lastSize = key;
      this.emit("resize", { width, height });
    });
  }

  private applyTheme() {
    const t: FlipperTheme = { ...parseTheme(this.theme) };
    const accent = normalizeColor(this.accent);
    if (accent) t.accent = accent;
    if (this.radius !== undefined && this.radius !== null && !Number.isNaN(this.radius)) t.radius = Math.max(0, Math.min(40, Number(this.radius)));
    this._mode = resolveMode(t.mode ?? "auto", this.mqDark ? this.mqDark.matches : true);
    const vars = themeVars(t, this._mode);
    for (const k of this.themeProps) if (!(k in vars)) this.style.removeProperty(k);
    for (const [k, v] of Object.entries(vars)) this.style.setProperty(k, v);
    this.themeProps = new Set(Object.keys(vars));
    this.density = t.density ?? "comfortable";
    this.inheritFont = t.fontFamily === "inherit";
  }
  private density: string = "comfortable";
  private inheritFont = false;

  // ── coin state ────────────────────────────────────────────────────────────────────────────────────────
  private coinState(): CoinState {
    const p = this.ctl.phase;
    // a deferred flip's coin has landed, but its result isn't known until it settles after the pause
    if (p.kind === "drawing" && p.deferred) return { status: "idle" };
    if (p.kind === "drawing" || (p.kind === "working" && (p.step === "flip-sent" || p.step === "requested" || p.step === "batch-sent"))) return { status: "spinning" };
    if (p.kind === "done") {
      const face = faceOf(p.settlement);
      if (face) return { status: "revealed", side: face, won: face === "heads", key: p.settlement.flipId.toString() };
      return { status: "idle" };
    }
    return { status: "idle" };
  }

  // ── render ────────────────────────────────────────────────────────────────────────────────────────────
  protected override render() {
    const variant = this.variant === "compact" || this.variant === "button" ? this.variant : "card";
    const body =
      variant === "button"
        ? html`${this.renderTrigger()}
            <dialog part="modal" aria-label=${this.s.dialogLabel} @close=${this.onDialogClose} @click=${this.onDialogClick}>
              ${this._modal ? this.renderCard("card", true) : nothing}
            </dialog>`
        : this.renderCard(variant, false);
    const fit = this.fit === "fill" && variant !== "button" ? "fill" : "auto";
    const size = this.size === "sm" || this.size === "lg" ? this.size : "md";
    return html`<div
      class="fw"
      part="root"
      data-mode=${this._mode}
      data-variant=${variant}
      data-fit=${fit}
      data-size=${size}
      data-density=${this.density}
      data-font=${this.inheritFont ? "inherit" : nothing}
      ?data-reduced=${this.reduced}
    >
      ${body}
    </div>`;
  }

  private onDialogClose = () => {
    this._modal = false;
    this._picker = false;
  };
  private onDialogClick = (e: MouseEvent) => {
    // a click on the backdrop (the dialog box itself, outside the card) closes it
    if (e.target === e.currentTarget) this.close();
  };

  private renderTrigger() {
    const t = this.ctl.token;
    const label = this.buttonLabel ?? (t ? `${this.s.openWidget} ${t.symbol}` : this.s.openWidget);
    const owed = this.ctl.pendingPayouts().filter((e) => !e.paid).length;
    const owedLabel = owed ? (owed === 1 ? this.s.pendingWinsOne : fmt(this.s.pendingWinsMany, { count: owed })) : "";
    return html`<button class="trigger" part="trigger" aria-haspopup="dialog" aria-description=${owedLabel || nothing} @click=${() => void this.open()}>
      <span class="mini" aria-hidden="true">${this.branding ? dolphin() : svg`<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>`}</span>
      <span class="trigger-label">${label}</span>${owed ? html`<span class="trigger-dot" title=${owedLabel}></span>` : nothing}
    </button>`;
  }

  private renderCard(variant: "card" | "compact", inModal: boolean) {
    const compact = variant === "compact";
    return html`<section class="card" part="card" aria-label=${this.s.dialogLabel} ?data-picker=${this._picker && this.pickerAvailable}>
      ${compact ? this.renderCompactTop(inModal) : this.renderHeader(inModal)}
      <div class="body">
        ${compact ? nothing : this.renderHero()}
        <div class="panel">${this.renderForm(inModal)}</div>
      </div>
      ${this.branding ? this.renderFooter() : nothing} ${this._picker && this.pickerAvailable ? this.renderPicker() : nothing}
    </section>`;
  }

  private renderBrand() {
    const name = this.brandName ?? (this.branding ? this.s.brand : "");
    const logo = this.brandLogo
      ? html`<img class="brand-logo" src=${this.brandLogo} alt="" referrerpolicy="no-referrer" />`
      : this.branding
        ? html`<span class="brand-mark">${dolphin()}</span>`
        : nothing;
    if (!name && logo === nothing) return html`<span></span>`;
    return html`<span class="brand" part="brand">${logo}${name ? html`<span class="brand-name">${name}</span>` : nothing}</span>`;
  }

  private renderAccount(inModal: boolean) {
    const c = this.ctl;
    const s = this.s;
    const close = inModal
      ? html`<button class="icon-btn" aria-label=${s.close} @click=${() => this.close()}>${icons.close}</button>`
      : nothing;
    if (!c.account) {
      const busy = c.connecting;
      return html`<span class="head-end"
        ><button class="chip" part="account" aria-label=${s.connect} ?disabled=${busy || c.status !== "ready"} @click=${() => void c.connect("connect")}>
          ${icons.wallet} ${busy ? s.connecting : html`<span class="long">${s.connect}</span><span class="short">${s.connectShort}</span>`}</button
        >${close}</span
      >`;
    }
    return html`<span class="head-end"
      ><button
        class="chip num"
        part="account"
        ?data-warn=${c.wrongChain}
        title=${c.account}
        aria-label=${c.wrongChain ? s.wrongNetwork : c.account}
        @click=${() => (c.wrongChain ? void c.switchChain() : void c.connect("connect"))}
      >
        <span class="dot"></span>${c.wrongChain
          ? s.wrongNetwork
          : html`<span class="long">${this.variant === "compact" ? shortAddress(c.account, 4, 4) : shortAddress(c.account, 6, 4)}</span><span class="short"
                >${shortAddress(c.account, 4, 2)}</span
              >`}</button
      >${close}</span
    >`;
  }

  private renderHeader(inModal: boolean) {
    return html`<div class="head" part="header">${this.renderBrand()}${this.renderAccount(inModal)}</div>`;
  }

  private renderCoin() {
    const s = this.s;
    const st = this.coinState();
    const label = st.status === "revealed" ? (st.won ? s.coinHeads : s.coinTails) : st.status === "spinning" ? s.coinSpinning : s.coinIdle;
    return html`<div class="coin-stage" part="coin" role="img" aria-label=${label}>
      <div class="coin-halo"></div>
      <div class="coin-shadow"></div>
      <div class="coin-lift">
        <div class="coin">
          ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => html`<div class="coin-rim" style="transform: translateZ(calc(var(--_coin) * ${(-0.035 + (i + 0.5) * 0.007).toFixed(4)}))"></div>`)}
          ${this.renderFace("heads")} ${this.renderFace("tails")}
        </div>
      </div>
      <div class="coin-fx"></div>
    </div>`;
  }

  private renderFace(side: "heads" | "tails") {
    const img = side === "heads" ? (this.coinImage ?? (!this.branding ? this.brandLogo : undefined)) : this.coinImageTails;
    const gid = `${this.uidp}-${side}`;
    let content: TemplateResult | typeof nothing;
    if (img) content = html`<img class="coin-img" src=${img} alt="" referrerpolicy="no-referrer" draggable="false" />`;
    else if (this.branding)
      content = html`<svg class="coin-glyph" viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <linearGradient id=${gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#f0faff" />
            <stop offset=".5" style="stop-color: var(--_accent)" />
            <stop offset="1" style="stop-color: var(--_win)" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="44" fill="none" stroke="#00000033" stroke-width="1.2" stroke-dasharray="1.2 3.2" />
        ${side === "heads"
          ? svg`<path fill=${`url(#${gid})`} fill-rule="evenodd" transform="translate(11 26) scale(.41)" d=${DOLPHIN_D} />`
          : svg`<path fill=${`url(#${gid})`} d=${FLUKE_D} />`}
      </svg>`;
    else content = html`<span class="coin-letter" aria-hidden="true">${side === "heads" ? "★" : "◆"}</span>`;
    return html`<div class="coin-face ${side}"><div class="coin-iris"></div>${content}<div class="coin-sheen"></div></div>`;
  }

  private renderHero() {
    const empty = this.statusEmpty;
    return html`<div class="hero" ?data-quiet=${empty}>
      ${this.renderCoin()}
      <div class="status" part="status" aria-live="polite" ?data-empty=${empty}><div class="status-in">${this.renderStatus(false)}</div></div>
    </div>`;
  }

  private renderCompactTop(inModal: boolean) {
    return html`<div class="compact-top" part="header">
      ${this.renderCoin()}
      <div class="compact-text" part="status" aria-live="polite" ?data-empty=${this.statusEmpty}>${this.renderStatus(true)}</div>
      ${this.renderAccount(inModal)}
    </div>`;
  }

  /**
   * Idle with no `tagline`: the coin carries the idle state on its own, so the status slot takes no room. It opens
   * (animated) as the coin starts spinning, so the draw's text doesn't shift the layout mid-toss.
   */
  private get statusEmpty() {
    const k = this.ctl.phase.kind;
    return k !== "done" && k !== "drawing" && !this.tagline && this.coinState().status === "idle";
  }

  /** What sits under (or beside) the coin: the draw or the result; while idle, only the opt-in `tagline`. */
  private renderStatus(compact: boolean) {
    const c = this.ctl;
    const s = this.s;
    const p = c.phase;
    if (p.kind === "done" && p.landed) return this.renderResult(p.settlement, p.token, compact);
    if (p.kind === "done") return html`<p class="tagline" style="opacity:.55">${s.landing}</p>`;
    if (p.kind === "drawing" && p.deferred) return this.renderDeferred(compact);
    if (p.kind === "drawing") {
      const slow = Date.now() - p.since > 60_000;
      return html`<p class="tagline">${Date.now() - p.since > 10_000 ? s.stillDrawing : s.drawing}</p>
        <p class="tiny">${s.waitingRandomness} · ${this.txLink(p.flipHash)}</p>
        ${slow && !compact ? html`<p class="sub">${s.slowRandomness}</p>` : nothing}`;
    }
    const tag = this.tagline;
    if (!tag) return nothing;
    // your own text: just that line
    if (typeof tag === "string") return html`<p class="tagline">${tag}</p>`;
    // `true`: the built-in headline and its payout line (both overridable through `strings`)
    const t = c.token;
    const multiple = t && c.house ? formatMultiple(payoutBps(t.address, c.house.flipper, c.house.terms), this.locale) : "2×";
    return html`<p class="tagline">${s.tagline}</p>
      ${t && s.taglineSub ? html`<p class="sub pitch">${fmt(s.taglineSub, { multiple, symbol: t.native ? "WETH" : t.symbol })}</p>` : nothing}`;
  }

  private renderResult(st: Settlement, t: WidgetToken, compact = false) {
    const s = this.s;
    const c = this.ctl;
    const face = faceOf(st);
    const won = st.status === FlipStatus.Won || st.status === FlipStatus.WonFallback || st.status === FlipStatus.WinPending;
    const amt = (v: bigint, d = t.decimals) => formatTokenAmount(v, d);
    const stake = `${amt(st.flip.amount)} ${t.symbol}`;
    const ev = st.event;
    let headline = s.refunded;
    let detail = fmt(s.resultRefunded, { stake });
    if (st.status === FlipStatus.Won) {
      headline = s.won;
      let paid: bigint;
      if (st.resolved) paid = st.flip.amount + st.resolved.tokenPaid;
      else if (t.isFlipper) paid = st.flip.amount + (ev?.flipperPaid ?? (st.flip.amount * BigInt(st.flip.payoutBps - 10_000)) / 10_000n);
      else paid = ev && ev.tokenPaid > 0n ? ev.tokenPaid : 2n * st.flip.amount;
      detail = fmt(st.safeMode || ev?.safeMode ? s.resultWonClaim : s.resultWon, { amount: amt(paid), symbol: t.native ? "WETH" : t.symbol });
    } else if (st.status === FlipStatus.WonFallback) {
      headline = s.won;
      const bonus = st.resolved?.flipperPaid ?? ev?.flipperPaid;
      detail = fmt(s.resultWonFallback, { stake, bonus: `${bonus !== undefined ? amt(bonus, c.flipperMeta?.decimals ?? 18) : ""} ${c.flipperMeta?.symbol ?? "FLIPPER"}`.trim() });
    } else if (st.status === FlipStatus.WinPending) {
      headline = s.won;
      detail = fmt(s.resultWinPending, { stake });
    } else if (st.status === FlipStatus.Lost || st.status === FlipStatus.LostInventory) {
      headline = s.lost;
      detail = fmt(s.resultLost, { stake });
    }
    return html`<div class="fade-in" part="result">
      <p class="headline" data-tone=${won ? "win" : "loss"}>
        ${face === "heads" ? html`<span class="face-heads">${s.heads} </span>` : face === "tails" ? html`<span class="face-tails">${s.tails} </span>` : nothing}<span
          class="rest"
          >${headline}</span
        >
      </p>
      <p class="sub">${detail}${t.native && won ? html` ${s.wethPayout}` : nothing}</p>
      ${st.status === FlipStatus.WinPending ? this.renderResultPayout(st, compact) : nothing}
    </div>`;
  }

  /**
   * WinPending in the result: "Payout being settled · X owed" and Retry payout. The compact variant has no room
   * beside its coin, so it says "settling winnings…" there and puts the block with the form's notes.
   */
  private renderResultPayout(st: Settlement, compact: boolean) {
    const e = this.ctl.payouts.get(st.flipId.toString());
    if (compact || !e) return html`<p class="tiny"><span class="pending-dot"></span>${this.s.settling}</p>`;
    return html`<div class="payout" part="payout">${this.renderPayout(e, "line")}</div>`;
  }

  /**
   * One pending win: Retry payout, enabled while a dry run passes; otherwise why not, and when it pays itself.
   * `line`: "Payout being settled · X owed" above the button (the result). `inline`: "X owed" beside it (the banner).
   */
  private renderPayout(e: PendingPayout, owed: "line" | "inline") {
    const s = this.s;
    const c = this.ctl;
    const amount = fmt(s.payoutOwed, { amount: formatTokenAmount(e.flip.amount, e.decimals), symbol: e.symbol }).trim();
    const line = owed === "line" ? html`<p class="payout-line"><span class="pending-dot"></span><span>${s.payoutSettling} ·</span> <span class="num">${amount}</span></p>` : nothing;
    const lead = owed === "inline" ? html`<span class="payout-owed num">${amount}</span>` : nothing;
    if (e.paid || (e.check && !e.check.ok && e.check.notPending)) {
      // our own retry: what it paid (the winnings, or $FLIPPER after the timeout); anyone else's: "Already paid out."
      const own = e.paid?.by === "self" ? e.paid : undefined;
      const f = c.flipperMeta;
      const text =
        own?.tokenPaid && own.tokenPaid > 0n
          ? fmt(s.payoutPaid, { amount: formatTokenAmount(own.tokenPaid, e.decimals), symbol: e.symbol })
          : own?.flipperPaid && own.flipperPaid > 0n
            ? fmt(s.payoutPaid, { amount: formatTokenAmount(own.flipperPaid, f?.decimals ?? 18), symbol: f?.symbol ?? "FLIPPER" })
            : s.payoutAlreadyPaid;
      return html`${line}
        <div class="payout-row">${lead}<p class="payout-done" role="status">${icons.check}<span>${text}</span></p></div>`;
    }
    const ready = e.check?.ok === true;
    const now = Math.floor(Date.now() / 1000) + c.skew;
    const auto =
      e.resolveAt === undefined ? null : e.resolveAt > now ? fmt(s.payoutAuto, { time: this.when(e.resolveAt), duration: formatDuration(e.resolveAt - now) }) : s.payoutDue;
    const why = !e.check ? s.payoutChecking : e.check.ok ? s.payoutReady : e.check.tooEarly ? s.payoutNotYet : neutral(e.check.reason);
    const id = `${this.uidp}-po-${e.flipId}`;
    const blocked = !ready && !e.busy;
    return html`${line}
      <div class="payout-row">
        ${lead}
        <button
          class="payout-btn"
          ?disabled=${!ready || e.busy || !c.account || c.wrongChain}
          ?data-busy=${e.busy}
          title=${why}
          aria-describedby=${id}
          @click=${() => void c.retryPayout(e.flipId.toString())}
        >
          ${e.busy ? s.payingOut : s.retryPayout}
        </button>
      </div>
      ${blocked
        ? html`<p class="payout-auto" id=${id}>${e.check && !e.check.ok ? html`<span class="payout-why">${why}</span> ` : nothing}${auto ?? nothing}</p>`
        : html`<span class="sr" id=${id}>${why}</span>`}
      ${e.error ? html`<p class="payout-err" role="alert">${neutral(e.error)}</p>` : nothing}`;
  }

  /**
   * A flip whose randomness arrived while the protocol was locked: it has no result until it's settled, market-free,
   * after the unlock (anyone may: Settle now). The compact variant puts the action with the form's notes.
   */
  private renderDeferred(compact: boolean) {
    const s = this.s;
    if (compact) {
      return html`<p class="tagline">${s.deferredTitle}</p>
        ${this.ctl.locked ? html`<p class="tiny"><span class="pending-dot"></span>${s.settleWaiting}</p>` : nothing}`;
    }
    return html`<div class="fade-in" part="result">
      <p class="tagline">${s.deferredTitle}</p>
      <p class="sub">${s.deferredBody}</p>
      <div class="payout" part="payout">${this.renderSettleRow(false)}</div>
    </div>`;
  }

  /** Settle now, enabled while a dry run of `settleDeferred` passes; otherwise why not (usually: still locked). */
  private renderSettleRow(titleLine = true) {
    const c = this.ctl;
    const s = this.s;
    const check = c.deferredCheck;
    const ready = check?.ok === true;
    const why = !check ? s.payoutChecking : check.ok ? s.settleReady : check.locked ? s.lockedNote : check.reason;
    const id = `${this.uidp}-settle`;
    return html`${titleLine ? html`<p class="payout-line"><span class="pending-dot"></span><span>${s.deferredTitle}</span></p>` : nothing}
      <div class="payout-row">
        <button
          class="payout-btn"
          ?disabled=${!ready || c.settlingDeferred || !c.account || c.wrongChain}
          ?data-busy=${c.settlingDeferred}
          title=${why}
          aria-describedby=${id}
          @click=${() => void c.settleDeferredFlip()}
        >
          ${c.settlingDeferred ? s.settlingNow : s.settleNow}
        </button>
      </div>
      ${ready || c.settlingDeferred
        ? html`<span class="sr" id=${id}>${why}</span>`
        : html`<p class="payout-auto" id=${id}>${check && !check.ok && !check.locked ? html`<span class="payout-why">${why}</span> ` : nothing}${s.settleWaiting}</p>`}
      ${c.deferredError ? html`<p class="payout-err" role="alert">${c.deferredError}</p>` : nothing}`;
  }

  /** "Sep 26, 3:40 PM" in the widget's locale */
  private when(unix: number) {
    const d = new Date(unix * 1000);
    const o: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
    try {
      return d.toLocaleString(this.locale || undefined, o);
    } catch {
      return d.toLocaleString(undefined, o);
    }
  }

  private txLink(hash: string) {
    // only an https (or localhost) explorer becomes a link: never a `javascript:` URL from a tampered manifest
    const base = safeHttpUrl(this.ctl.chain?.blockExplorers?.default.url);
    const short = shortAddress(hash, 6, 4);
    return base
      ? html`<a href=${`${base.replace(/\/$/, "")}/tx/${hash}`} target="_blank" rel="noopener noreferrer" title=${this.s.viewTx}>${short}</a>`
      : html`<span title=${hash}>${short}</span>`;
  }

  // ── form ──────────────────────────────────────────────────────────────────────────────────────────────
  /** Single-token mode: `mode="single"`, the deprecated `hidePicker`, or an allowlist of one token. */
  get singleMode(): boolean {
    if (this.mode === "single" || this.hidePicker) return true;
    if (this.mode === "picker") return false;
    return this.ctl.allowlist?.length === 1;
  }

  private get pickerAvailable() {
    return !this.singleMode;
  }

  private renderForm(inModal = false) {
    const c = this.ctl;
    const s = this.s;
    const t = c.token;
    const busy = c.phase.kind === "working" || c.phase.kind === "drawing";
    const cta = this.cta();
    const pickable = this.pickerAvailable && c.status === "ready" && !!c.house;
    return html`<div class="form">
      ${this.singleMode ? this.renderSingleField(inModal, cta.action) : this.renderPickerField(inModal, cta.action, pickable)}
      <div class="meta">
        <span class="bal" part="balance"
          >${s.balance} <span class="num">${c.balance !== undefined && t ? formatTokenAmount(c.balance, t.decimals) : "–"}</span> ${t?.symbol ?? ""}</span
        >
        ${this.renderOddsShift()}
      </div>
      ${this.renderNotes()}
      <button
        class="cta"
        part="cta"
        ?disabled=${!cta.action}
        ?data-busy=${cta.busy}
        ?data-drawing=${cta.drawing}
        aria-busy=${cta.busy || cta.drawing ? "true" : "false"}
        @click=${() => cta.action?.()}
      >
        ${keyed(cta.label, html`<span class="cta-label swap">${cta.label}</span>`)}
      </button>
      ${cta.hint ? html`<p class="hint">${cta.hint}</p>` : nothing} ${this.details ? this.renderDetails() : nothing}
    </div>`;
  }

  private amountInput(_inModal: boolean, submit?: () => void) {
    const c = this.ctl;
    const t = c.token;
    const busy = c.phase.kind === "working" || c.phase.kind === "drawing";
    return html`<label class="sr" for=${`${this.uidp}-amt`}>${fmt(this.s.amountLabel, { symbol: t?.symbol ?? "" })}</label>
      <input
        id=${`${this.uidp}-amt`}
        class="amount"
        part="amount-input"
        inputmode="decimal"
        autocomplete="off"
        spellcheck="false"
        placeholder="0.00"
        .value=${c.text}
        ?disabled=${busy || !t || t.section !== "listed"}
        @input=${(e: InputEvent) => {
          const el = e.target as HTMLInputElement;
          c.setText(el.value);
          if (el.value !== c.text) el.value = c.text;
        }}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter" && submit) submit();
        }}
      />`;
  }

  private maxButton() {
    const c = this.ctl;
    const busy = c.phase.kind === "working" || c.phase.kind === "drawing";
    return html`<button class="max" part="max-button" ?disabled=${!c.balance || busy || c.maxing || c.token?.section !== "listed"} @click=${() => void c.fillMax()}>
      ${c.maxing ? "…" : this.s.max}
    </button>`;
  }

  /** Picker mode: [token ▾] [amount] [MAX]. */
  private renderPickerField(inModal: boolean, submit: (() => void) | undefined, pickable: boolean) {
    const c = this.ctl;
    const t = c.token;
    const busy = c.phase.kind === "working" || c.phase.kind === "drawing";
    return html`<div class="field" part="field">
      <button
        class="token-btn"
        part="token-button"
        ?disabled=${!pickable || busy}
        aria-haspopup="listbox"
        aria-expanded=${String(this._picker)}
        @click=${this.openPicker}
      >
        ${t ? this.avatar(t, 26) : html`<span class="avatar" style="--s:26px;background:var(--_hairline)"></span>`}
        <span class="sym">${t?.symbol ?? "…"}</span>
        <span class="chev">${icons.chevron}</span>
      </button>
      ${this.amountInput(inModal, submit)} ${this.maxButton()}
    </div>`;
  }

  /** Single-token mode: a plain amount input; the token is a quiet label after it, nothing to open. */
  private renderSingleField(inModal: boolean, submit: (() => void) | undefined) {
    const t = this.ctl.token;
    return html`<div class="field single" part="field">
      ${this.amountInput(inModal, submit)}
      <span class="suffix" part="token">
        ${t ? this.avatar(t, 20) : html`<span class="avatar" style="--s:20px;background:var(--_hairline)"></span>`}
        <span class="sym">${t?.symbol ?? ""}</span>
      </span>
      ${this.maxButton()}
    </div>`;
  }

  /** Only when fees trim this flip's odds below the house's usual: by how much, never the odds themselves. */
  private renderOddsShift() {
    const c = this.ctl;
    const s = this.s;
    const amount = c.amount;
    if (!c.house || !c.preview || !amount || amount <= 0n) return nothing;
    const shift = oddsShift(c.preview, c.house.terms).shiftBps;
    const p = Math.round(shift / 10) / 10;
    if (p <= 0) return nothing;
    const pts = p.toFixed(1);
    return html`<span class="odds-shift" part="odds" ?data-pending=${c.previewPending} title=${fmt(s.oddsBelowHelp, { points: pts })}>
      ${icons.arrowDown}<span class="odds-long">${fmt(s.oddsBelow, { points: pts })}</span><span class="odds-short">${fmt(s.oddsBelowShort, { points: pts })}</span>
    </span>`;
  }

  /** Opt-in (`details`): win chance, payout and randomness fee. Off by default; the odds deviation covers the default. */
  private renderDetails() {
    const c = this.ctl;
    const s = this.s;
    const t = c.token;
    if (!t || !c.house || t.section !== "listed") return nothing;
    const win = c.preview && c.preview.code === 0 ? c.preview.winChanceBps : BigInt(c.house.terms.baseWinChanceBps);
    const mult = formatMultiple(payoutBps(t.address, c.house.flipper, c.house.terms), this.locale);
    const fee = c.fee ?? c.preview?.randomnessFee;
    const native = c.deployment?.nativeSymbol ?? "ETH";
    return html`<p class="details" part="details">
      <span>${s.winChance} <b class="num">${formatWinChance(win)}</b></span>
      <span>${s.pays} <b class="num">${mult}</b></span>
      ${fee !== undefined ? html`<span>${s.fee} <b class="num">${formatTokenAmount(fee, 18)}</b> ${native}</span>` : nothing}
    </p>`;
  }

  private renderNotes() {
    const c = this.ctl;
    const s = this.s;
    const t = c.token;
    const out: TemplateResult[] = [];
    if (c.status === "error" && c.configError) out.push(html`<p class="note" part="note" data-tone="loss" role="alert">${neutral(c.configError)}</p>`);
    if (c.tokenError) {
      const [before, after = ""] = s.singleNeedsToken.split("`token`");
      out.push(html`<p class="note" part="note" data-tone="loss" role="alert">${before}<code>token</code>${after}</p>`);
    }
    else if (c.houseError && !c.house) out.push(html`<p class="note" part="note" data-tone="loss" role="alert">${neutral(c.houseError)}</p>`);
    if (t && t.section === "unsupported") {
      out.push(html`<p class="note" part="note">${fmt(s.unsupported, { symbol: t.symbol, reason: neutral(t.reason ?? "").replace(/\.$/, "") || "—" })}</p>`);
    }
    if (t && t.section === "eligible") {
      const l = c.listing;
      if (this.listing === false) out.push(html`<p class="note" part="note">${fmt(s.listingOff, { symbol: t.symbol })}</p>`);
      else if (l.kind === "blocked") out.push(html`<p class="note" part="note">${fmt(s.listBlocked, { symbol: t.symbol, reason: neutral(l.reason).replace(/\.$/, "") })}</p>`);
      else if (l.kind === "error") out.push(html`<p class="note" part="note" data-tone="loss" role="alert">${neutral(l.message)}</p>`);
      else if (l.kind !== "done")
        out.push(html`<div class="note" part="note" data-tone="win"><b>${fmt(s.listTitle, { symbol: t.symbol })}</b><br />${s.listBody}</div>`);
    }
    if (t && t.section === "listed" && c.listing.kind === "done") out.push(html`<p class="note" part="note" data-tone="win">${fmt(s.listDone, { symbol: t.symbol })}</p>`);
    const pv = c.preview;
    if (t && pv && pv.code !== 0 && c.amount && c.amount > 0n) {
      const r = rejectReason(pv.code, { symbol: t.symbol, amount: c.amount ?? undefined, minStake: c.minStake ?? undefined, decimals: t.decimals });
      if (r) out.push(html`<p class="note" part="note" data-tone="loss">${neutral(r.message)}</p>`);
    } else if (t && !pv && c.previewError && !c.previewPending && c.amount && c.amount > 0n) {
      out.push(html`<p class="note" part="note" data-tone="loss">${neutral(c.previewError)}</p>`);
    }
    if (c.phase.kind === "error") out.push(html`<p class="note" part="note" data-tone="loss" role="alert">${neutral(c.phase.message)}</p>`);
    if (c.locked && !(c.phase.kind === "drawing" && c.phase.deferred)) out.push(html`<p class="note" part="note">${s.lockedNote}</p>`);
    if (c.phase.kind === "drawing" && c.phase.deferred && this.variant === "compact") {
      out.push(html`<div class="note payout-note" part="note payout" data-tone="win">${this.renderSettleRow()}</div>`);
    }
    out.push(...this.renderPayoutNotes());
    if (t?.native && c.wethBalance && c.wethBalance > 0n && c.phase.kind !== "working" && c.phase.kind !== "drawing") {
      out.push(html`<div class="note note-row" part="note">
        <span>${fmt(s.unwrapNote, { amount: formatTokenAmount(c.wethBalance, 18) })}</span>
        <button class="link-btn" ?disabled=${c.unwrapping || !c.account || c.wrongChain} @click=${() => void c.unwrap()}>${c.unwrapping ? s.unwrapping : s.unwrap}</button>
      </div>`);
    } else if (t?.native && c.unwrapDone) out.push(html`<p class="note" part="note">${s.unwrapped}</p>`);
    return out;
  }

  /**
   * Pending wins in the form's notes: the compact variant's own result (no room beside its coin), then a quiet banner
   * of the wallet's other pending wins (earlier flips, other sessions). Nothing when there are none.
   */
  private renderPayoutNotes(): TemplateResult[] {
    const c = this.ctl;
    const s = this.s;
    const out: TemplateResult[] = [];
    const p = c.phase;
    // the result's own flip is the result's business (pending or just paid), never the banner's
    const shown = p.kind === "done" ? p.settlement.flipId : undefined;
    if (p.kind === "done" && p.landed && p.settlement.status === FlipStatus.WinPending && this.variant === "compact") {
      const e = c.payouts.get(p.settlement.flipId.toString());
      if (e) out.push(html`<div class="note payout-note" part="note payout" data-tone="win">${this.renderPayout(e, "line")}</div>`);
    }
    if (!c.account) return out;
    const others = c.pendingPayouts(shown);
    if (!others.length) return out;
    // one row, however many are owed (the title counts them): a just-paid one first (its confirmation), else the
    // first retryable, else the oldest. The next takes its place once it's paid.
    const open = others.filter((e) => !e.paid);
    const row = others.find((e) => e.paid) ?? open.find((e) => e.check?.ok) ?? open[0]!;
    const title = open.length === 0 ? null : open.length === 1 ? s.pendingWinsOne : fmt(s.pendingWinsMany, { count: open.length });
    out.push(html`<div class="note payout-note" part="note payout" data-tone="win" role="region" aria-label=${title ?? s.payoutSettling}>
      ${title ? html`<p class="payout-title"><span class="pending-dot"></span>${title}</p>` : nothing} ${this.renderPayout(row, "inline")}
    </div>`);
    return out;
  }

  /** The main button: its label, and what it does (none = disabled). Mirrors flipper.family's bet card. */
  private cta(): { label: string; action?: () => void; busy?: boolean; drawing?: boolean; hint?: string } {
    const c = this.ctl;
    const s = this.s;
    const t = c.token;
    const chainName = chainLabel(c.chain?.name);
    if (c.status === "loading") return { label: s.loading };
    if (c.status === "error") return { label: s.notLive, action: () => void c.configure() };
    if (!c.house) return c.houseError ? { label: fmt(s.unreachable, { chain: chainName }), action: () => void c.configure() } : { label: s.loading };
    const p = c.phase;
    if (p.kind === "working") {
      const sym = p.token.native ? "WETH" : p.token.symbol;
      const labels: Record<string, string> = {
        previewing: s.stepPreviewing,
        approving: fmt(s.stepApproving, { symbol: sym }),
        "approve-sent": fmt(s.stepApproveSent, { symbol: sym }),
        signing: s.stepSigning,
        "flip-sent": s.stepFlipSent,
        requested: s.drawing,
        wrapping: s.stepWrapping,
        "wrap-sent": s.stepWrapSent,
        "batch-signing": s.stepBatch,
        "batch-sent": s.stepFlipSent,
      };
      return { label: labels[p.step] ?? s.stepFlipSent, busy: true };
    }
    if (p.kind === "drawing" && p.deferred) return { label: s.deferredCta };
    if (p.kind === "drawing") return { label: s.drawing, drawing: true };
    if (p.kind === "done" && !p.landed && !this.reduced) return { label: s.landing, drawing: true };
    // the drawdown circuit breaker: nothing can be flipped until the protocol is unlocked
    if (c.locked) return { label: s.locked };
    if (c.tokenError) return { label: s.tokenNotSet };
    if (c.tokenLoading) return { label: s.loading };
    if (!t) return { label: s.selectToken, action: this.pickerAvailable ? this.openPicker : undefined };
    if (c.house.paused) return { label: s.paused };
    if (t.section === "unsupported") return { label: fmt(s.notFlippable, { symbol: t.symbol }), action: this.pickerAvailable ? this.openPicker : undefined };
    if (t.section === "eligible" && (this.listing === false || c.listing.kind === "blocked")) {
      return { label: fmt(s.notFlippable, { symbol: t.symbol }), action: this.pickerAvailable ? this.openPicker : undefined };
    }
    if (!c.account) return { label: c.connecting ? s.connecting : s.connect, action: c.connecting ? undefined : () => void c.connect(t.section === "eligible" ? "list" : "flip") };
    if (c.wrongChain) return { label: c.switching ? s.switching : fmt(s.switchChain, { chain: chainName }), action: c.switching ? undefined : () => void c.switchChain() };
    if (t.section === "eligible") {
      const l = c.listing;
      if (l.kind === "checking" || l.kind === "idle") return { label: s.listChecking, busy: true };
      if (l.kind === "confirm") return { label: s.listConfirm, busy: true };
      if (l.kind === "sending") return { label: fmt(s.listSending, { symbol: t.symbol }), busy: true };
      if (l.kind === "ready" || l.kind === "error") return { label: fmt(s.listButton, { symbol: t.symbol }), action: () => void c.list() };
    }
    const amount = c.amount;
    if (!amount || amount <= 0n) return { label: s.enterAmount };
    const min = c.minAmount;
    const max = c.maxAmount;
    if (min !== null && amount < min) return { label: fmt(s.belowMin, { amount: formatTokenAmount(min, t.decimals), symbol: t.symbol }) };
    if (max !== null && amount > max) return { label: fmt(s.aboveMax, { amount: formatTokenAmount(max, t.decimals), symbol: t.symbol }) };
    if (c.balance !== undefined && amount > c.balance) return { label: fmt(s.insufficient, { symbol: t.symbol }) };
    const fee = c.fee ?? c.preview?.randomnessFee ?? 0n;
    const feeToSend = c.feeToSend(c.preview?.randomnessFee ?? fee); // exact for a flat fee, padded if gas-priced
    const needEth = t.native ? amount + feeToSend : feeToSend;
    if (c.ethBalance !== undefined && fee > 0n && c.ethBalance < needEth) {
      return { label: t.native ? fmt(s.insufficient, { symbol: "ETH" }) : fmt(s.needFee, { native: c.deployment?.nativeSymbol ?? "ETH" }) };
    }
    const pv = c.preview;
    if (!pv) {
      if (c.previewPending) return { label: s.pricing };
      if (c.previewError) return { label: s.cantPrice, action: () => c.setText(c.text) };
      return { label: s.pricing };
    }
    if (pv.code !== 0) return { label: rejectReason(pv.code, { symbol: t.symbol })?.title ?? s.cantPrice };
    return { label: fmt(s.flip, { amount: formatTokenAmount(amount, t.decimals), symbol: t.symbol }), action: () => void c.flip() };
  }

  private avatar(t: WidgetToken, size: number) {
    const st = `--s:${size}px`;
    if (t.isFlipper) return html`<span class="avatar flipper" style=${st} aria-hidden="true">${this.branding ? dolphin() : t.symbol.slice(0, 1)}</span>`;
    if (t.native) return html`<span class="avatar eth" style=${st} aria-hidden="true">${icons.eth}</span>`;
    let h = 0;
    for (let i = 2; i < t.address.length; i++) h = (h * 31 + t.address.toLowerCase().charCodeAt(i)) % 360;
    const bg = `background: radial-gradient(circle at 30% 25%, hsl(${h} 70% 58%), hsl(${(h + 40) % 360} 60% 26%))`;
    return html`<span class="avatar" style=${`${st};${bg}`} aria-hidden="true"
      >${(t.symbol || "?").replace(/^\$/, "").slice(0, 1).toUpperCase()}${t.logo
        ? html`<img src=${t.logo} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error=${(e: Event) => (e.target as HTMLElement).remove()} />`
        : nothing}</span
    >`;
  }

  // ── picker ────────────────────────────────────────────────────────────────────────────────────────────
  private openPicker = async () => {
    if (!this.pickerAvailable) return;
    this._picker = true;
    this._active = 0;
    this.tokenList.open();
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLInputElement>(".search input")?.focus();
  };

  private closePicker = async () => {
    this._picker = false;
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLButtonElement>(".token-btn")?.focus();
  };

  private selectable(t: WidgetToken) {
    if (t.section === "unsupported") return false;
    if (t.section === "eligible" && this.listing === false) return false;
    return true;
  }

  private pick(t: WidgetToken) {
    if (!this.selectable(t)) return;
    void this.ctl.select(t);
    void this.closePicker();
  }

  private onPickerKey = (e: KeyboardEvent) => {
    const rows = this.tokenList.rows;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      void this.closePicker();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!rows.length) return;
      const dir = e.key === "ArrowDown" ? 1 : -1;
      let i = this._active;
      for (let n = 0; n < rows.length; n++) {
        i = (i + dir + rows.length) % rows.length;
        if (this.selectable(rows[i]!)) break;
      }
      this._active = i;
      void this.updateComplete.then(() => this.renderRoot.querySelector(`#${this.uidp}-opt-${i}`)?.scrollIntoView({ block: "nearest" }));
    } else if (e.key === "Enter") {
      const t = rows[this._active];
      if (t) {
        e.preventDefault();
        this.pick(t);
      }
    }
  };

  private renderPicker() {
    const s = this.s;
    const m = this.tokenList;
    const c = this.ctl;
    const titles: Record<string, string> = { listed: s.sectionListed, eligible: s.sectionEligible, unsupported: s.sectionUnsupported };
    const rows: TemplateResult[] = [];
    let last = "";
    m.rows.forEach((t, i) => {
      if (t.section !== last && !c.allowlist) {
        last = t.section;
        const n = m.sections[t.section as keyof typeof m.sections];
        rows.push(html`<div class="section" role="presentation"><span>${titles[t.section]}</span>${n !== undefined ? html`<span class="num">${n.toLocaleString()}</span>` : nothing}</div>`);
      }
      const selected = !!c.token && c.token.address.toLowerCase() === t.address.toLowerCase() && !!c.token.native === !!t.native;
      const ok = this.selectable(t);
      // icon, name (and at most one check), "TICKER · 0x3a4f…9c21"; why a token can't be flipped is the row's tooltip
      const sub = t.native ? t.symbol : `${t.symbol} · ${shortAddress(t.address, 6, 4)}`;
      const tip =
        t.section === "unsupported" && t.reason
          ? neutral(t.reason)
          : t.native
            ? s.nativeEth
            : t.isFlipper
              ? fmt(s.houseToken, { multiple: c.house ? formatMultiple(c.house.terms.flipperPayoutBps, this.locale) : "" }).replace(/ · (paga )?$/, "")
              : undefined;
      const check = checkOf(t, c.weth);
      rows.push(html`<div
        id=${`${this.uidp}-opt-${i}`}
        class="row"
        part="picker-row"
        role="option"
        aria-selected=${selected ? "true" : "false"}
        aria-disabled=${ok ? "false" : "true"}
        title=${tip ?? nothing}
        ?data-active=${i === this._active}
        @click=${() => this.pick(t)}
        @pointerenter=${() => (this._active = i)}
      >
        ${this.avatar(t, 34)}
        <span class="row-main">
          <span class="row-top"
            ><span class="s">${t.name || t.symbol}</span>${check
              ? html`<span class="check" data-kind=${check} part=${check === "listed" ? "check" : `check check-${check}`} title=${s[CHECK_TITLE[check]]}>${icons.check}</span>`
              : nothing}</span
          >
          <span class="row-sub num">${sub}</span>
        </span>
        ${t.section === "eligible" && ok ? html`<span class="row-tag">${fmt(s.listButton, { symbol: "" }).trim()}</span>` : nothing}
      </div>`);
    });
    const active = m.rows[this._active] ? `${this.uidp}-opt-${this._active}` : undefined;
    return html`<div class="picker" part="picker" role="dialog" aria-modal="true" aria-label=${s.chooseToken} @keydown=${this.onPickerKey}>
      <div class="picker-head">
        <h2 class="picker-title">${s.chooseToken}</h2>
        <button class="icon-btn" aria-label=${s.close} @click=${this.closePicker}>${icons.close}</button>
      </div>
      <label class="search" part="picker-search">
        ${icons.search}
        <input
          type="search"
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls=${`${this.uidp}-list`}
          aria-activedescendant=${active ?? nothing}
          aria-label=${s.searchTokens}
          placeholder=${s.searchTokens}
          autocomplete="off"
          spellcheck="false"
          .value=${m.query}
          @input=${(e: InputEvent) => {
            this._active = 0;
            m.setQuery((e.target as HTMLInputElement).value);
          }}
        />
      </label>
      <div class="list" id=${`${this.uidp}-list`} role="listbox" aria-label=${s.chooseToken}>
        ${rows}
        ${m.loading ? html`<div class="list-msg">${s.loadingTokens}</div>` : nothing}
        ${m.error
          ? html`<div class="list-msg">${s.tokensError} <button class="link-btn" @click=${() => void m.load(true)}>${s.retry}</button></div>`
          : nothing}
        ${!m.loading && !m.error && m.loaded && m.rows.length === 0 ? html`<div class="list-msg">${fmt(s.noResults, { query: m.query })}</div>` : nothing}
        ${m.next !== null ? html`<div class="sentinel"></div>` : nothing}
      </div>
    </div>`;
  }

  private renderFooter() {
    return html`<div class="foot" part="footer">
      <a href="https://flipper.family" target="_blank" rel="noopener">${this.s.poweredBy} <span class="brand-mark">${dolphin()}</span>flipper.family</a>
    </div>`;
  }
}

/**
 * The picker's one checkmark: "launchpad" (lime) for a launch that a recognised launchpad vouches for (the ListingPolicy's
 * `vettedBy.launchpad`), "listed" (the accent) for everything else the house whitelists or the ListingPolicy vetted
 * ($FLIPPER, ETH / WETH, owner listings, any other path or launchpad). Nothing otherwise.
 */
type CheckKind = "listed" | "launchpad";
const CHECK_TITLE = { listed: "checkListed", launchpad: "checkLaunchpad" } as const satisfies Record<CheckKind, keyof FlipperStrings>;
/** vettedBy.launchpad ids that get the launchpad check */
const LAUNCHPAD_CHECKS: ReadonlySet<string> = new Set(["pons"]);
function checkOf(t: WidgetToken, weth: string | undefined): CheckKind | null {
  if (t.isFlipper || t.native || (weth && t.address.toLowerCase() === weth.toLowerCase())) return "listed";
  const v = t.api?.vettedBy;
  if (v) return v.launchpad && LAUNCHPAD_CHECKS.has(v.launchpad) ? "launchpad" : "listed";
  // listed by the house's owner: listed, with no permissionless listing (ListingVetted) behind it
  if (t.api ? t.api.listed : t.section === "listed") return "listed";
  return null;
}

function faceOf(s: Settlement): "heads" | "tails" | null {
  if (s.status === FlipStatus.Won || s.status === FlipStatus.WonFallback || s.status === FlipStatus.WinPending) return "heads";
  if (s.status === FlipStatus.Lost || s.status === FlipStatus.LostInventory) return "tails";
  return null;
}

declare global {
  interface HTMLElementTagNameMap {
    "flipper-widget": FlipperWidget;
  }
  interface HTMLElementEventMap {
    "connect-request": CustomEvent<FlipperEventMap["connect-request"]>;
    "flip-requested": CustomEvent<FlipperEventMap["flip-requested"]>;
    "flip-settled": CustomEvent<FlipperEventMap["flip-settled"]>;
    "payout-resolved": CustomEvent<FlipperEventMap["payout-resolved"]>;
    listing: CustomEvent<FlipperEventMap["listing"]>;
  }
}
