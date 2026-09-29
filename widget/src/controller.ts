import {
  FlipStatus,
  FlipperApiError,
  INK_CHAIN_ID,
  RejectCode,
  createFlipperApi,
  createFlipperClient,
  flipperChain,
  isWinStatus,
  listingTargetFromApi,
  paddedRandomnessFee,
  parseAmount,
  pendingWinResolveAt,
  pollingIntervalFor,
  resolveDeployment,
  rpcErrorCode,
  switchWalletChain,
  toFlipperError,
  tokenSection,
  type ApiToken,
  type ApiTokenSection,
  type Eip1193Provider,
  type EthFlipStep,
  type FlipperApi,
  type FlipperClient,
  type FlipperDeployment,
  type FlipperPublicClient,
  type FlipperWalletClient,
  type FlipView,
  type HouseView,
  type ListingTarget,
  type Preview,
  type Settlement,
} from "@flipperdotfamily/sdk";
import type { ReactiveController } from "lit";
import { getAddress, http, isAddress, isAddressEqual, type Address, type Chain, type Hash } from "viem";
import { leanPublicClient, leanWalletClient } from "./viem-lean";
import type { FlipperEventMap, FlipperWidgetConfig } from "./types";

export const VERSION = "0.1.0";

/** A token as the widget handles it. For native ETH, `address` is WETH (what the house actually flips). */
export interface WidgetToken {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  logo?: string | null;
  verified?: boolean;
  verifiedBy?: string[];
  section: ApiTokenSection;
  /** plain-English reason for `unsupported` */
  reason?: string | null;
  isFlipper?: boolean;
  /** native ETH (wrapped into WETH to flip) */
  native?: boolean;
  /** the API record (listing needs its pool) */
  api?: ApiToken;
}

export type Phase =
  | { kind: "idle" }
  | { kind: "working"; step: EthFlipStep["step"]; approveHash?: Hash; flipHash?: Hash; token: WidgetToken }
  /** `deferred`: the randomness arrived while the protocol was locked; it settles after the unlock (`settleDeferred`) */
  | { kind: "drawing"; flipId: bigint; flipHash: Hash; since: number; token: WidgetToken; deferred?: boolean }
  | { kind: "done"; settlement: Settlement; flipHash: Hash; fromBlock: bigint; token: WidgetToken; landed: boolean; stake: bigint }
  | { kind: "error"; message: string };

/** A pending win (WinPending) of the connected wallet: the stake came back at settlement, the winnings are owed. */
export interface PendingPayout {
  flipId: bigint;
  flip: FlipView;
  token: Address;
  /** what the winnings are paid in: "WETH" for a native-ETH flip */
  symbol: string;
  decimals: number;
  /** the stake was native ETH (known for this widget's own flips; an earlier session's reads as WETH) */
  native?: boolean;
  /** unix seconds from which it can always be resolved (in $FLIPPER if the token still can't be bought) */
  resolveAt?: number;
  /** the latest dry run of `resolvePendingWin` (undefined until the first one answers) */
  check?: Awaited<ReturnType<FlipperClient["canResolvePendingWin"]>>;
  busy: boolean;
  error?: string;
  /** a retry in flight: the resolution watcher waits for it, to tell "self" from "other" */
  retrying?: Promise<void>;
  /** paid out, by this widget's retry or by someone else (usually the payout worker, within seconds) */
  paid?: { by: "self" | "other"; tokenPaid?: bigint; flipperPaid?: bigint };
  paidAt?: number;
}

/** How long a paid banner row stays ("Paid out: …" / "Already paid out.") before it goes. */
const PAID_ROW_MS = 6_000;

export type ListingState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "ready"; target: ListingTarget }
  | { kind: "blocked"; reason: string }
  | { kind: "confirm"; target: ListingTarget }
  | { kind: "sending"; target: ListingTarget; hash: Hash }
  | { kind: "done" }
  | { kind: "error"; message: string; target: ListingTarget };

/** What the controller needs from its element. */
export interface WidgetHost {
  addController(c: ReactiveController): void;
  requestUpdate(): void;
  readonly cfg: Readonly<FlipperWidgetConfig>;
  emit<K extends keyof FlipperEventMap>(name: K, detail: FlipperEventMap[K], cancelable?: boolean): boolean;
}

const MIN_SPIN_MS = 1200; // keep the suspense even when randomness lands in ~2 s
const STATUS_NAME: Record<number, FlipperEventMap["flip-settled"]["status"]> = {
  [FlipStatus.Won]: "Won",
  [FlipStatus.WonFallback]: "WonFallback",
  [FlipStatus.WinPending]: "WinPending",
  [FlipStatus.Lost]: "Lost",
  [FlipStatus.LostInventory]: "LostInventory",
  [FlipStatus.Refunded]: "Refunded",
};

const isEthKey = (v: string | undefined | null) => !!v && /^(eth|native|0xe{40})$/i.test(v.trim());
const addr = (v: string | undefined | null): Address | undefined => (v && isAddress(v.trim(), { strict: false }) ? getAddress(v.trim()) : undefined);
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export class FlipperController implements ReactiveController {
  // resolved deployment
  status: "loading" | "ready" | "error" = "loading";
  configError?: string;
  deployment?: FlipperDeployment;
  chain?: Chain;
  pc?: FlipperPublicClient;
  api?: FlipperApi;
  client?: FlipperClient;
  house?: HouseView;
  houseError?: string;
  flipperMeta?: { symbol: string; decimals: number; name: string };
  weth?: Address;

  // wallet
  provider?: Eip1193Provider;
  account?: Address;
  walletChainId?: number;
  connecting = false;
  switching = false;

  // token + amount
  token?: WidgetToken;
  tokenLoading = false;
  balance?: bigint;
  ethBalance?: bigint;
  wethBalance?: bigint;
  text = "";
  preview?: Preview;
  previewPending = false;
  previewError?: string;
  fee?: bigint;
  /** whether the house's randomness fee moves with the gas price (padded when sent); undefined until probed */
  feeGasPriced?: boolean;
  /** the smallest stake of the current token the house accepts (reject code 2 below it), once a preview hit it */
  minStake?: bigint | null;
  maxing = false;
  unwrapping = false;
  unwrapDone = false;

  phase: Phase = { kind: "idle" };
  listing: ListingState = { kind: "idle" };
  /** the drawdown circuit breaker has locked the protocol: flips are paused */
  locked = false;
  /** a deferred flip's settlement: the latest dry run, a settle in flight, its error */
  deferredCheck?: Awaited<ReturnType<FlipperClient["canSettleDeferred"]>>;
  settlingDeferred = false;
  deferredError?: string;

  // pending wins (WinPending), by flip id: the result view's and earlier ones (the banner)
  payouts = new Map<string, PendingPayout>();
  /** seconds the chain's clock runs ahead of the wall clock: countdowns use wall + skew (the SDK's `now()`) */
  skew = 0;
  private payoutTimer?: ReturnType<typeof setInterval>;
  private payoutTick = 0;
  private payoutSeq = 0;
  private payoutEmitted = new Set<string>();
  /** flip ids whose resolution a result view is watching (it emits for them) */
  private following = new Set<string>();
  private follows = new Set<AbortController>();
  private metaCache = new Map<string, { symbol: string; decimals: number }>();

  private gen = 0; // bumps on reconfigure: stale async results are dropped
  private previewSeq = 0;
  private previewTimer?: ReturnType<typeof setTimeout>;
  private pollTimer?: ReturnType<typeof setInterval>;
  private abort?: AbortController;
  private unsub?: () => void;
  private readyEmitted = false;
  private connected = false;

  constructor(private host: WidgetHost) {
    host.addController(this);
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────────────────────────────
  hostConnected() {
    this.connected = true;
    this.pollTimer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void this.refreshLocked();
      if (this.phase.kind === "working" || this.phase.kind === "drawing") return;
      void this.refreshBalances();
    }, 12_000);
    this.payoutTimer = setInterval(() => this.payoutLoop(), 5_000);
  }

  hostDisconnected() {
    this.connected = false;
    clearInterval(this.pollTimer);
    clearInterval(this.payoutTimer);
    clearTimeout(this.previewTimer);
    this.abort?.abort();
    for (const f of this.follows) f.abort();
    this.follows.clear();
    this.unsub?.();
    this.unsub = undefined;
  }

  private get cfg() {
    return this.host.cfg;
  }
  private get partner() {
    return this.cfg.partner?.trim() || null;
  }
  private update() {
    this.host.requestUpdate();
  }

  /** (Re)resolves the deployment and clients: chain, RPC, API, addresses. */
  async configure() {
    const gen = ++this.gen;
    this.status = "loading";
    this.configError = undefined;
    this.house = undefined;
    this.houseError = undefined;
    this.resetPayouts();
    this.update();
    try {
      const d = await resolveDeployment({
        chainId: this.cfg.chainId,
        rpcUrl: this.cfg.rpcUrl || undefined,
        apiUrl: this.cfg.apiUrl || undefined,
        addresses: this.cfg.addresses as never,
        deploymentUrl: this.cfg.deploymentUrl,
        allowUnpinnedDeployment: this.cfg.allowUnpinnedDeployment === true,
      });
      if (gen !== this.gen) return;
      this.deployment = d;
      this.chain = flipperChain(d);
      const blockTime = d.blockTimeMs ?? 2_000;
      this.pc = leanPublicClient(this.chain, http(d.rpcUrl, { batch: { wait: 16 }, retryCount: 1, timeout: 45_000 }), Math.max(250, pollingIntervalFor(blockTime)));
      const apiUrl = this.cfg.apiUrl === null ? undefined : this.cfg.apiUrl || d.apiUrl;
      this.api = apiUrl ? createFlipperApi({ url: apiUrl, partner: this.partner }) : undefined;
      this.weth = addr(d.addresses.weth);
      this.rebuildClient();
      this.status = "ready";
      this.update();
      await this.loadHouse(gen);
      if (gen !== this.gen) return;
      void this.refreshPayouts();
      await this.selectInitialToken(gen);
    } catch (err) {
      if (gen !== this.gen) return;
      this.status = "error";
      this.configError = (err as Error)?.message || "Couldn't load flipper.";
      this.emitError(err, "config", "config");
      this.update();
    } finally {
      if (gen === this.gen && !this.readyEmitted) {
        this.readyEmitted = true;
        this.host.emit("ready", {
          version: VERSION,
          chainId: this.chain?.id ?? this.cfg.chainId ?? null,
          account: this.account ?? null,
          token: this.token?.native ? "ETH" : (this.token?.address ?? null),
          variant: this.cfg.variant ?? "card",
          partner: this.partner,
        });
      }
    }
  }

  /** A new partner id: the API's attribution header, and the client's onchain suffix, without a full reconfigure. */
  refreshPartner() {
    const url = this.api?.url;
    if (url) this.api = createFlipperApi({ url, partner: this.partner });
    this.rebuildClient();
    this.schedulePreview(0);
  }

  private rebuildClient() {
    if (!this.pc || !this.deployment) return;
    const d = this.deployment;
    let wc: FlipperWalletClient | undefined;
    const host = this.cfg.walletClient;
    if (host && this.account) {
      // a full WalletClient signs through its own actions (local accounts included); a bare client goes through request
      wc =
        typeof (host as { writeContract?: unknown }).writeContract === "function"
          ? (host as unknown as FlipperWalletClient)
          : this.chain
            ? leanWalletClient({ request: (a) => host.request(a) }, this.chain, this.account)
            : undefined;
    }
    else if (this.provider && this.account && this.chain) wc = leanWalletClient(this.provider, this.chain, this.account);
    this.client = createFlipperClient({
      publicClient: this.pc,
      walletClient: wc,
      addresses: d.addresses,
      hookitRoutes: (d.liveChainId ?? d.chainId) === INK_CHAIN_ID,
      // a partner code the registry can hold goes onchain too: an ERC-8021 suffix on every flip (and preview)
      partner: this.partner,
    });
  }

  /** The drawdown circuit breaker's lock (an older house without it reads as unlocked). */
  async refreshLocked() {
    const client = this.client;
    if (!client) return;
    const locked = await client.locked().catch(() => undefined);
    if (locked === undefined || client !== this.client || locked === this.locked) return;
    this.locked = locked;
    if (!locked) this.schedulePreview(0);
    this.update();
  }

  private async loadHouse(gen: number) {
    const client = this.client;
    if (!client) return;
    try {
      const house = await client.house();
      if (gen !== this.gen) return;
      this.house = house;
      this.houseError = undefined;
      void this.refreshLocked();
      const meta = await client.tokenMeta(house.flipper);
      if (gen !== this.gen) return;
      this.flipperMeta = meta;
      if (!this.weth) this.weth = await client.weth().catch(() => undefined);
    } catch (err) {
      if (gen !== this.gen) return;
      this.houseError = toFlipperError(err).message;
      this.emitError(err, "config", "network");
    }
    this.update();
  }

  // ── wallet ──────────────────────────────────────────────────────────────────────────────────────────
  /** Called when `provider` / `walletClient` change. */
  async setWallet() {
    this.unsub?.();
    this.unsub = undefined;
    const wc = this.cfg.walletClient;
    const p = this.cfg.provider ?? (wc ? ({ request: (a: { method: string; params?: unknown }) => wc.request(a as never) } as Eip1193Provider) : undefined);
    this.provider = p ?? undefined;
    if (!p) {
      this.applyAccounts([], undefined);
      return;
    }
    if (wc?.account) {
      this.applyAccounts([wc.account.address], wc.chain?.id);
      if (!wc.chain) void this.readChain();
      return;
    }
    const onAccounts = (a: unknown) => this.applyAccounts(Array.isArray(a) ? (a as string[]) : [], this.walletChainId);
    const onChain = (c: unknown) => {
      this.walletChainId = typeof c === "string" ? Number.parseInt(c, 16) : Number(c);
      this.rebuildClient();
      this.update();
    };
    const onDisconnect = () => this.applyAccounts([], this.walletChainId);
    // some providers only announce `connect` after eth_requestAccounts: re-read the accounts then
    const onConnect = () => void this.resync();
    p.on?.("accountsChanged", onAccounts);
    p.on?.("chainChanged", onChain);
    p.on?.("disconnect", onDisconnect);
    p.on?.("connect", onConnect);
    this.unsub = () => {
      p.removeListener?.("accountsChanged", onAccounts);
      p.removeListener?.("chainChanged", onChain);
      p.removeListener?.("disconnect", onDisconnect);
      p.removeListener?.("connect", onConnect);
    };
    try {
      const [accounts, chainId] = await Promise.all([p.request({ method: "eth_accounts" }), p.request({ method: "eth_chainId" }).catch(() => undefined)]);
      if (this.provider !== p) return;
      this.applyAccounts(Array.isArray(accounts) ? (accounts as string[]) : [], typeof chainId === "string" ? Number.parseInt(chainId, 16) : undefined);
    } catch {
      if (this.provider === p) this.applyAccounts([], undefined);
    }
  }

  /** Re-reads the provider's accounts and chain (e.g. after the host connected it), then balances. */
  async resync() {
    const p = this.provider;
    if (!p || this.cfg.walletClient) return void this.refreshBalances();
    try {
      const [accounts, chainId] = await Promise.all([p.request({ method: "eth_accounts" }), p.request({ method: "eth_chainId" }).catch(() => undefined)]);
      if (this.provider !== p) return;
      this.applyAccounts(Array.isArray(accounts) ? (accounts as string[]) : [], typeof chainId === "string" ? Number.parseInt(chainId, 16) : this.walletChainId);
    } catch {
      /* keep the current state */
    }
    void this.refreshBalances();
  }

  private async readChain() {
    try {
      const c = await this.provider?.request({ method: "eth_chainId" });
      if (typeof c === "string") {
        this.walletChainId = Number.parseInt(c, 16);
        this.update();
      }
    } catch {
      /* ignore */
    }
  }

  /** Pushes a wallet state (also used by the embed bridge). */
  applyAccounts(accounts: string[], chainId: number | undefined) {
    const next = addr(accounts[0]);
    const changed = !same(next, this.account);
    this.account = next;
    if (chainId !== undefined && Number.isFinite(chainId)) this.walletChainId = chainId;
    this.rebuildClient();
    if (changed) {
      this.balance = this.ethBalance = this.wethBalance = undefined;
      if (this.phase.kind === "error") this.phase = { kind: "idle" };
      this.resetPayouts();
      void this.refreshBalances();
      void this.refreshPayouts();
      this.schedulePreview(0);
    }
    this.update();
  }

  get wrongChain(): boolean {
    return !!this.account && !!this.chain && this.walletChainId !== undefined && this.walletChainId !== this.chain.id;
  }

  async connect(reason: FlipperEventMap["connect-request"]["reason"]) {
    const detail = { reason, partner: this.partner };
    const notPrevented = this.host.emit("connect-request", detail, true);
    if (this.cfg.onConnectRequest) {
      this.cfg.onConnectRequest(detail);
      return;
    }
    if (!notPrevented || !this.provider) return;
    this.connecting = true;
    this.update();
    try {
      const accounts = await this.provider.request({ method: "eth_requestAccounts" });
      this.applyAccounts(Array.isArray(accounts) ? (accounts as string[]) : [], this.walletChainId);
      if (this.walletChainId === undefined) void this.readChain();
    } catch (err) {
      this.emitError(err, "wallet", "wallet");
    } finally {
      this.connecting = false;
      this.update();
    }
  }

  async switchChain() {
    if (!this.provider || !this.chain) return;
    this.switching = true;
    this.update();
    try {
      await switchWalletChain(this.provider, this.chain);
      const c = await this.provider.request({ method: "eth_chainId" }).catch(() => undefined);
      this.walletChainId = typeof c === "string" ? Number.parseInt(c, 16) : this.chain.id;
      this.rebuildClient();
    } catch (err) {
      this.emitError(err, "wallet", "wallet");
      if (rpcErrorCode(err) !== 4001) this.phase = { kind: "error", message: toFlipperError(err).message };
    } finally {
      this.switching = false;
      this.update();
    }
  }

  // ── tokens ──────────────────────────────────────────────────────────────────────────────────────────
  get allowlist(): string[] | undefined {
    const t = this.cfg.tokens?.map((s) => s.trim()).filter(Boolean);
    return t && t.length ? t : undefined;
  }
  get ethEnabled() {
    return this.cfg.eth !== false && !!this.weth;
  }

  /** Set when `mode: "single"` has no token to fix (a configuration mistake the widget shows instead of guessing). */
  tokenError?: string;

  /** The token to start on, or null when single-token mode has none configured. */
  private initialToken(): string | null {
    const allow = this.allowlist;
    const explicit = this.cfg.token?.trim();
    if (this.cfg.mode === "single") return explicit || (allow?.length === 1 ? allow[0]! : null);
    return explicit || allow?.[0] || this.house?.flipper || "";
  }

  private async selectInitialToken(gen: number) {
    const wanted = this.initialToken();
    if (wanted === null) {
      this.tokenError = "single-token";
      this.token = undefined;
      this.emitError(new Error('Single-token mode needs a token: set `token` to a token address or "ETH".'), "config", "config");
      this.update();
      return;
    }
    this.tokenError = undefined;
    await this.select(wanted, gen);
  }

  /** Re-selects when the `token` / `tokens` / `mode` options change. */
  async setTokenOption() {
    if (this.status !== "ready" || !this.house) return;
    await this.selectInitialToken(this.gen);
  }

  /** Select a token by address (or "ETH"), or a token record from the picker. */
  async select(t: string | WidgetToken, gen = this.gen) {
    if (this.phase.kind === "working" || this.phase.kind === "drawing") return;
    this.tokenLoading = true;
    this.listing = { kind: "idle" };
    this.update();
    try {
      const token = typeof t === "string" ? await this.resolveToken(t) : await this.verifyListed(t);
      if (gen !== this.gen || !token) return;
      const changed = !this.token || !same(this.token.address, token.address) || !!this.token.native !== !!token.native;
      this.token = token;
      if (changed) {
        this.text = "";
        this.preview = undefined;
        this.previewError = undefined;
        this.balance = undefined;
        this.fee = undefined;
        this.minStake = undefined;
        this.unwrapDone = false;
        if (this.phase.kind !== "done") this.phase = { kind: "idle" };
      }
      if (token.section === "eligible" && this.cfg.listing !== false) void this.checkListing();
      void this.refreshBalances();
      void this.refreshFee();
    } finally {
      if (gen === this.gen) {
        this.tokenLoading = false;
        this.update();
      }
    }
  }

  /** Builds a WidgetToken for an address / "ETH", from the API when available, else from the chain. */
  async resolveToken(key: string): Promise<WidgetToken | undefined> {
    const client = this.client;
    const house = this.house;
    if (!client || !house) return undefined;
    if (isEthKey(key) && this.ethEnabled) {
      const weth = await this.resolveToken(this.weth!);
      if (!weth) return undefined;
      return { ...weth, symbol: "ETH", name: "Ether", native: true, logo: null, verified: true, verifiedBy: [] };
    }
    const a = addr(key);
    if (!a) return this.resolveToken(house.flipper);
    if (isAddressEqual(a, house.flipper)) {
      const m = this.flipperMeta ?? (await client.tokenMeta(a));
      return { address: a, symbol: m.symbol, name: m.name, decimals: m.decimals, section: "listed", isFlipper: true, verified: true, verifiedBy: ["flipper.family"] };
    }
    let api: ApiToken | undefined;
    if (this.api) {
      try {
        api = (await this.api.token(a)).token;
      } catch (err) {
        if (!(err instanceof FlipperApiError) || err.status !== 404) api = undefined;
      }
    }
    const base: WidgetToken = api
      ? {
          address: a,
          symbol: api.symbol ?? "???",
          name: api.name ?? "",
          decimals: api.decimals ?? 18,
          logo: api.logo ?? null,
          verified: !!api.verified,
          verifiedBy: api.verifiedBy ?? [],
          section: tokenSection(api),
          reason: api.eligibility?.reason ?? null,
          api,
        }
      : { ...(await client.tokenMeta(a)), address: a, section: "unsupported", reason: null };
    return this.verifyListed(base);
  }

  /** The house is the authority on "listed": check it onchain (the index can lag a listing by a few seconds). */
  private async verifyListed(t: WidgetToken): Promise<WidgetToken> {
    if (t.isFlipper || !this.client) return t;
    try {
      const v = await this.client.tokenView(t.address);
      const listed = v.enabled && !v.blocked;
      if (listed) return { ...t, section: "listed", reason: null };
      if (v.blocked) return { ...t, section: "unsupported", reason: t.reason ?? "Disabled by the house." };
      if (t.section === "listed") return { ...t, section: t.api?.pool ? "eligible" : "unsupported" };
      if (!t.api && t.section === "unsupported" && !t.reason) return { ...t, reason: "It isn't listed on flipper." };
      return t;
    } catch {
      return t;
    }
  }

  async refreshBalances() {
    const pc = this.pc;
    const account = this.account;
    const t = this.token;
    if (!pc || !account || !this.client) return;
    try {
      const [eth, bal, weth] = await Promise.all([
        pc.getBalance({ address: account }),
        t && !t.native ? this.client.balanceOf(t.address, account) : Promise.resolve(undefined),
        t?.native && this.weth ? this.client.balanceOf(this.weth, account) : Promise.resolve(undefined),
      ]);
      if (!same(account, this.account) || t !== this.token) return;
      this.ethBalance = eth;
      this.balance = t?.native ? eth : bal;
      this.wethBalance = weth;
      this.update();
    } catch {
      /* keep the last values */
    }
  }

  private async refreshFee() {
    const t = this.token;
    if (!t || !this.client || t.section !== "listed") return;
    try {
      const [fee, gasPriced] = await Promise.all([this.client.displayRandomnessFee(t.address), this.client.randomnessFeeIsGasPriced(t.address)]);
      if (t === this.token) {
        this.fee = fee;
        this.feeGasPriced = gasPriced;
        this.update();
      }
    } catch {
      /* the preview carries a fee too */
    }
  }

  private async loadMinStake(t: WidgetToken) {
    try {
      const min = await this.client!.minStake(t.address);
      if (t === this.token) {
        this.minStake = min;
        this.update();
      }
    } catch {
      /* the note just won't name the minimum */
    }
  }

  /**
   * The ETH a flip sends for a quoted randomness fee, as the SDK's `randomnessFeeToSend`: exact when the adapter's fee
   * is flat (Dice, Pyth), padded when it moves with the gas price or isn't known yet.
   */
  feeToSend(quoted: bigint): bigint {
    return this.feeGasPriced === false ? quoted : paddedRandomnessFee(quoted);
  }

  // ── amount + preview ────────────────────────────────────────────────────────────────────────────────
  get amount(): bigint | null {
    return this.token ? parseAmount(this.text, this.token.decimals) : null;
  }
  get minAmount(): bigint | null {
    return this.token && this.cfg.minAmount ? parseAmount(String(this.cfg.minAmount), this.token.decimals) : null;
  }
  get maxAmount(): bigint | null {
    return this.token && this.cfg.maxAmount ? parseAmount(String(this.cfg.maxAmount), this.token.decimals) : null;
  }

  setText(v: string) {
    this.text = v.replace(/[^\d.,]/g, "").replace(/,/g, ".");
    if (this.phase.kind === "error") this.phase = { kind: "idle" };
    this.schedulePreview();
    this.update();
  }

  private schedulePreview(delay = 280) {
    clearTimeout(this.previewTimer);
    const seq = ++this.previewSeq;
    const t = this.token;
    const amount = this.amount;
    if (!t || !amount || amount <= 0n || t.section !== "listed" || !this.client) {
      this.preview = undefined;
      this.previewPending = false;
      this.previewError = undefined;
      return;
    }
    this.previewPending = true;
    this.previewTimer = setTimeout(async () => {
      try {
        const pv = await this.client!.preview(t.address, amount);
        if (seq !== this.previewSeq) return;
        this.preview = pv;
        this.previewError = undefined;
        // below the minimum size: look the minimum up once per token, so the note can name it
        if (pv.code === RejectCode.AMOUNT && this.minStake === undefined) void this.loadMinStake(t);
      } catch (err) {
        if (seq !== this.previewSeq) return;
        this.preview = undefined;
        this.previewError = toFlipperError(err, { symbol: t.symbol }).message;
      } finally {
        if (seq === this.previewSeq) {
          this.previewPending = false;
          this.update();
        }
      }
    }, delay);
  }

  async fillMax() {
    const t = this.token;
    const client = this.client;
    if (!t || !client || this.balance === undefined || this.balance === 0n) return;
    this.maxing = true;
    this.update();
    try {
      let hi = this.balance;
      if (t.native) {
        // keep the randomness fee and some gas back
        const fee = await client.randomnessFeeToSend(t.address, this.fee);
        const reserve = fee * 2n + 10n ** 15n / 2n;
        hi = hi > reserve ? hi - reserve : 0n;
      }
      const cap = this.maxAmount;
      if (cap !== null && hi > cap) hi = cap;
      if (hi <= 0n) return;
      const { amount } = await client.maxStake(t.address, hi, false);
      if (amount > 0n) this.text = toInput(amount, t.decimals);
      else this.phase = { kind: "error", message: "No stake is accepted right now." };
      this.schedulePreview(0);
    } catch (err) {
      this.phase = { kind: "error", message: toFlipperError(err, { symbol: t.symbol }).message };
    } finally {
      this.maxing = false;
      this.update();
    }
  }

  // ── flip ────────────────────────────────────────────────────────────────────────────────────────────
  async flip() {
    const t = this.token;
    const client = this.client;
    const amount = this.amount;
    const account = this.account;
    if (!t || !client || !amount || amount <= 0n || !account) return;
    this.abort?.abort();
    const ctrl = new AbortController();
    this.abort = ctrl;
    let approveHash: Hash | undefined;
    let flipHash: Hash | undefined;
    const onStep = (s: EthFlipStep) => {
      if (s.step === "approve-sent") approveHash = s.hash;
      if (s.step === "flip-sent" || s.step === "requested") flipHash = s.hash;
      this.phase = { kind: "working", step: s.step, approveHash, flipHash, token: t };
      this.update();
    };
    this.phase = { kind: "working", step: "previewing", token: t };
    this.update();
    try {
      const approve = this.cfg.approval === "exact" ? "exact" : "max";
      const res = t.native
        ? await client.flipEth({ amount, approve, onStep })
        : await client.flip({ token: t.address, amount, symbol: t.symbol, decimals: t.decimals, approve, onStep });
      const since = Date.now();
      this.host.emit("flip-requested", {
        flipId: res.flipId.toString(),
        account,
        token: t.address,
        symbol: t.symbol,
        decimals: t.decimals,
        amount: amount.toString(),
        winChanceBps: Number(res.requested.winChanceBps),
        randomnessFee: res.requested.randomnessFee.toString(),
        txHash: res.hash,
        approveTxHash: approveHash ?? null,
        native: !!t.native,
        partner: this.partner,
      });
      this.phase = { kind: "drawing", flipId: res.flipId, flipHash: res.hash, since, token: t };
      this.update();
      void this.refreshBalances();
      const settlement = await client.waitForSettlement(res.flipId, {
        fromBlock: res.receipt.blockNumber,
        timeoutMs: 0,
        signal: ctrl.signal,
        // randomness delivered while the protocol was locked: "settling after pause" until someone settles it
        onDeferred: () => {
          if (this.phase.kind === "drawing" && this.phase.flipId === res.flipId) {
            this.phase = { ...this.phase, deferred: true };
            this.deferredCheck = undefined;
            this.deferredError = undefined;
            void this.refreshLocked();
            void this.checkDeferred();
            this.update();
          }
        },
      });
      const wait = MIN_SPIN_MS - (Date.now() - since);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (ctrl.signal.aborted) return;
      let shown = settlement;
      let later: Settlement | undefined;
      if (settlement.resolved && settlement.event?.status === FlipStatus.WinPending) {
        // resolved before we looked: still show "being settled" first
        later = settlement;
        shown = { ...settlement, status: FlipStatus.WinPending, resolved: undefined };
      }
      this.phase = { kind: "done", settlement: shown, flipHash: res.hash, fromBlock: res.receipt.blockNumber, token: t, landed: false, stake: amount };
      if (shown.status === FlipStatus.WinPending) this.addPayout(shown.flip, t);
      this.host.emit("flip-settled", this.settledDetail(shown, t, res.hash, account, amount));
      this.update();
      void this.refreshBalances();
      if (shown.status === FlipStatus.WinPending) void this.followPending(res.flipId, res.receipt.blockNumber, res.hash, t, account, amount, later);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      const e = toFlipperError(err, { symbol: t.symbol });
      this.phase = { kind: "error", message: e.message };
      this.emitError(err, "flip", undefined, t.symbol);
      void this.refreshBalances();
      this.update();
    }
  }

  /**
   * WinPending: watch until the winnings are paid (polled every 2 s; our payout worker usually pays within a second,
   * or the player retries), then show the paid result and emit the final flip-settled and payout-resolved. A later
   * flip doesn't stop the watch: its own abort ends with the element or a wallet change.
   */
  private async followPending(flipId: bigint, fromBlock: bigint, flipHash: Hash, t: WidgetToken, account: Address, stake: bigint, known: Settlement | undefined) {
    const key = flipId.toString();
    const ctrl = new AbortController();
    this.follows.add(ctrl);
    this.following.add(key);
    try {
      const shownAt = Date.now();
      const s = known ?? (await this.client!.waitForResolution(flipId, { fromBlock, signal: ctrl.signal }));
      // keep "being settled" on screen long enough to read
      const hold = 4_500 - (Date.now() - shownAt);
      if (hold > 0) await new Promise((r) => setTimeout(r, hold));
      if (ctrl.signal.aborted) return;
      const e = this.payouts.get(key) ?? this.makePayout(s.flip, t);
      if (e.retrying) await e.retrying; // our own retry paid it: that one reports "self"
      if (this.phase.kind === "done" && this.phase.settlement.flipId === flipId) {
        this.phase = { ...this.phase, settlement: s, landed: true };
      }
      this.host.emit("flip-settled", this.settledDetail(s, t, flipHash, account, stake));
      await this.settlePayout(e, "other", s.resolved);
      void this.refreshBalances();
      this.update();
    } catch {
      /* stopped waiting */
    } finally {
      this.following.delete(key);
      this.follows.delete(ctrl);
    }
  }

  /** The coin finished landing: reveal the result text. */
  landed(key: string) {
    if (this.phase.kind === "done" && this.phase.settlement.flipId.toString() === key && !this.phase.landed) {
      this.phase = { ...this.phase, landed: true };
      this.update();
    }
  }

  reset() {
    if (this.phase.kind === "done" || this.phase.kind === "error") {
      this.phase = { kind: "idle" };
      this.update();
    }
  }

  private settledDetail(s: Settlement, t: WidgetToken, requestTxHash: Hash, account: Address, stake: bigint): FlipperEventMap["flip-settled"] {
    const ev = s.event;
    const status = STATUS_NAME[s.status] ?? "Lost";
    let payout = 0n;
    let flipperPaid = 0n;
    switch (s.status) {
      case FlipStatus.Won:
        if (s.resolved) payout = stake + s.resolved.tokenPaid;
        else if (t.isFlipper) payout = stake + (ev?.flipperPaid ?? (stake * BigInt(s.flip.payoutBps - 10_000)) / 10_000n);
        else payout = ev && ev.tokenPaid > 0n ? ev.tokenPaid : 2n * stake;
        break;
      case FlipStatus.WonFallback:
        payout = stake;
        flipperPaid = s.resolved?.flipperPaid ?? ev?.flipperPaid ?? 0n;
        break;
      case FlipStatus.WinPending:
      case FlipStatus.Refunded:
        payout = stake;
        break;
    }
    return {
      flipId: s.flipId.toString(),
      account,
      token: t.address,
      symbol: t.symbol,
      decimals: t.decimals,
      amount: stake.toString(),
      outcome: s.status === FlipStatus.Refunded ? "refunded" : isWinStatus(s.status) ? "won" : "lost",
      status,
      won: isWinStatus(s.status),
      pending: s.status === FlipStatus.WinPending,
      payout: payout.toString(),
      payoutToken: t.address,
      flipperPaid: flipperPaid.toString(),
      txHash: s.resolved?.txHash ?? s.cancelled?.txHash ?? s.txHash ?? null,
      requestTxHash,
      native: !!t.native,
      partner: this.partner,
    };
  }

  // ── pending wins ────────────────────────────────────────────────────────────────────────────────────
  /** Unpaid pending wins, oldest first, plus paid ones for a few seconds (their row says so), except `exceptId`'s. */
  pendingPayouts(exceptId?: bigint): PendingPayout[] {
    const out: PendingPayout[] = [];
    for (const e of this.payouts.values()) {
      if (exceptId !== undefined && e.flipId === exceptId) continue;
      if (e.paid && Date.now() - (e.paidAt ?? 0) > PAID_ROW_MS) continue;
      out.push(e);
    }
    return out.sort((a, b) => (a.flipId < b.flipId ? -1 : 1));
  }

  private resetPayouts() {
    this.payoutSeq++;
    this.payouts.clear();
  }

  private makePayout(flip: FlipView, t?: WidgetToken): PendingPayout {
    const house = this.house;
    const sym = t ? (t.native ? "WETH" : t.symbol) : "";
    return {
      flipId: flip.id,
      flip,
      token: flip.token,
      symbol: sym,
      decimals: t?.decimals ?? 18,
      native: !!t?.native,
      resolveAt: house ? pendingWinResolveAt(flip, house.params) : undefined,
      busy: false,
    };
  }

  /** The result view's pending win: tracked (and dry-run) right away. */
  private addPayout(flip: FlipView, t: WidgetToken) {
    const key = flip.id.toString();
    if (!this.payouts.has(key)) this.payouts.set(key, this.makePayout(flip, t));
    void this.checkPayout(key);
  }

  private async metaFor(token: Address): Promise<{ symbol: string; decimals: number }> {
    const t = this.token;
    if (t && same(t.address, token)) return { symbol: t.native ? "WETH" : t.symbol, decimals: t.decimals };
    if (this.weth && same(this.weth, token)) return { symbol: "WETH", decimals: 18 };
    const key = token.toLowerCase();
    const hit = this.metaCache.get(key);
    if (hit) return hit;
    const m = await this.client!.tokenMeta(token).catch(() => ({ symbol: "", decimals: 18 }));
    const meta = { symbol: m.symbol, decimals: m.decimals };
    this.metaCache.set(key, meta);
    return meta;
  }

  /** Re-reads the connected wallet's pending wins (earlier sessions included), and the chain's clock skew. */
  async refreshPayouts() {
    const client = this.client;
    const account = this.account;
    const house = this.house;
    if (!client || !account || !house) return;
    const seq = this.payoutSeq;
    try {
      const [views, now] = await Promise.all([client.pendingWins(account), client.now().catch(() => undefined)]);
      if (seq !== this.payoutSeq || !same(account, this.account)) return;
      if (now !== undefined) this.skew = Math.max(0, Number(now) - Math.floor(Date.now() / 1000));
      const live = new Set<string>();
      for (const v of views) {
        const key = v.id.toString();
        live.add(key);
        const known = this.payouts.get(key);
        if (known) {
          if (!known.paid) known.flip = v;
          continue;
        }
        const meta = await this.metaFor(v.token);
        if (seq !== this.payoutSeq) return;
        this.payouts.set(key, { ...this.makePayout(v), ...meta });
        void this.checkPayout(key);
      }
      // gone from the list: paid by someone. A result view watching it, or a retry in flight, reports it instead.
      for (const [key, e] of this.payouts) {
        if (!live.has(key) && !e.paid && !e.busy && !this.following.has(key)) void this.settlePayout(e, "other");
      }
      this.update();
    } catch {
      /* keep the last list */
    }
  }

  /** Dry-runs `resolvePendingWin`: the Retry payout button is enabled while it passes. */
  private async checkPayout(key: string) {
    const e = this.payouts.get(key);
    const client = this.client;
    if (!e || e.paid || e.busy || !client) return;
    const r = await client.canResolvePendingWin(e.flipId).catch(() => undefined);
    if (!r || this.payouts.get(key) !== e || e.paid || e.busy) return;
    e.check = r;
    // already resolved: someone paid it (the result view's watcher reports its own)
    if (!r.ok && r.notPending && !this.following.has(key)) void this.settlePayout(e, "other");
    this.update();
  }

  /** Retry payout: `resolvePendingWin`, which anyone may call. `BadStatus` means someone paid it first: not an error. */
  async retryPayout(flipId: string) {
    const e = this.payouts.get(flipId);
    const client = this.client;
    if (!e || e.busy || e.paid || !client || !this.account) return;
    e.busy = true;
    e.error = undefined;
    let done!: () => void;
    e.retrying = new Promise<void>((r) => (done = r));
    this.update();
    try {
      const r = await client.resolvePendingWin(e.flipId);
      await this.settlePayout(e, "self", { tokenPaid: r.tokenPaid, flipperPaid: r.flipperPaid, txHash: r.receipt.transactionHash });
    } catch (err) {
      const fe = toFlipperError(err, { symbol: e.symbol });
      if (fe.details.errorName === "BadStatus") void this.settlePayout(e, "other");
      else {
        if (fe.kind !== "user-rejected" && rpcErrorCode(err) !== 4001) e.error = fe.message;
        this.emitError(err, "flip", undefined, e.symbol);
      }
    } finally {
      e.busy = false;
      e.retrying = undefined;
      done();
      void this.checkPayout(flipId);
      void this.refreshBalances();
      this.update();
    }
  }

  /**
   * Marks a pending win paid and emits `payout-resolved` once. Amounts are what the player received, as the SDK
   * reports a resolution (`tokenPaid` on Won, `flipperPaid` on WonFallback); looked up when not known.
   */
  private async settlePayout(e: PendingPayout, by: "self" | "other", known?: { tokenPaid: bigint; flipperPaid: bigint; txHash?: Hash }) {
    const key = e.flipId.toString();
    if (!e.paid) {
      e.paid = { by, tokenPaid: known?.tokenPaid, flipperPaid: known?.flipperPaid };
      e.paidAt = Date.now();
      e.busy = false;
      this.update();
    }
    if (this.payoutEmitted.has(key)) return;
    this.payoutEmitted.add(key);
    let r = known;
    if (!r) r = (await this.client?.getFlipEvents(e.flipId).catch(() => undefined))?.resolved;
    const paid = r && { tokenPaid: r.tokenPaid, flipperPaid: r.flipperPaid };
    if (paid && e.paid.tokenPaid === undefined) e.paid = { ...e.paid, ...paid };
    this.host.emit("payout-resolved", {
      flipId: key,
      account: e.flip.player,
      token: e.token,
      symbol: e.native ? "ETH" : e.symbol, // as flip-settled names it
      decimals: e.decimals,
      tokenPaid: (paid?.tokenPaid ?? 0n).toString(),
      flipperPaid: (paid?.flipperPaid ?? 0n).toString(),
      by: e.paid.by,
      native: !!e.native,
      txHash: r?.txHash ?? null,
      partner: this.partner,
    });
    void this.refreshBalances();
    this.update();
  }

  /** A deferred flip: dry-run `settleDeferred`, so Settle now is enabled once it would go through. */
  async checkDeferred() {
    const p = this.phase;
    const client = this.client;
    if (p.kind !== "drawing" || !p.deferred || !client || this.settlingDeferred) return;
    const r = await client.canSettleDeferred(p.flipId).catch(() => undefined);
    if (!r || this.phase !== p) return;
    this.deferredCheck = r;
    this.update();
  }

  /** Settle now: `settleDeferred(flipId)` (anyone may, once unlocked); the flip's watcher then shows the result. */
  async settleDeferredFlip() {
    const p = this.phase;
    const client = this.client;
    if (p.kind !== "drawing" || !p.deferred || !client || this.settlingDeferred) return;
    this.settlingDeferred = true;
    this.deferredError = undefined;
    this.update();
    try {
      await client.settleDeferred(p.flipId);
    } catch (err) {
      const e = toFlipperError(err, { symbol: p.token.symbol });
      // someone settled it first: the watcher picks the result up
      if (e.kind !== "user-rejected" && rpcErrorCode(err) !== 4001 && e.details.errorName !== "BadStatus") this.deferredError = e.message;
      this.emitError(err, "flip", undefined, p.token.symbol);
    } finally {
      this.settlingDeferred = false;
      void this.checkDeferred();
      this.update();
    }
  }

  /** Every 5 s: dry runs every 10 s, the list every 15 s (every 60 s while there's none), and the countdowns. */
  private payoutLoop() {
    if (typeof document !== "undefined" && document.hidden) return;
    if (!this.account || !this.client) return;
    this.payoutTick++;
    if (this.phase.kind === "drawing" && this.phase.deferred && this.payoutTick % 2 === 0) {
      void this.refreshLocked();
      void this.checkDeferred();
    }
    const open = [...this.payouts.values()].some((e) => !e.paid);
    if (this.payoutTick % (open ? 3 : 12) === 0) void this.refreshPayouts();
    if (this.payoutTick % 2 === 0) for (const k of this.payouts.keys()) void this.checkPayout(k);
    for (const [k, e] of this.payouts) if (e.paid && Date.now() - (e.paidAt ?? 0) > 2 * PAID_ROW_MS && !this.following.has(k)) this.payouts.delete(k);
    if (this.payouts.size) this.update();
  }

  // ── listing ─────────────────────────────────────────────────────────────────────────────────────────
  async checkListing() {
    const t = this.token;
    const client = this.client;
    if (!t || !client) return;
    const target = t.api ? listingTargetFromApi(t.api) : null;
    if (!target) {
      this.listing = { kind: "blocked", reason: t.reason || "No pool flipper can route through." };
      this.update();
      return;
    }
    const a = this.deployment?.addresses;
    if ((target.venue === "v3" && !a?.v3Adapter) || (target.venue === "v4" && !a?.v4Adapter) || (target.venue === "hookit" && !a?.hookitAdapter)) {
      const via = target.venue === "hookit" ? "for launchpad tokens" : `through Uniswap ${target.venue}`;
      this.listing = { kind: "blocked", reason: `Listings ${via} aren't enabled on this deployment yet.` };
      this.update();
      return;
    }
    this.listing = { kind: "checking" };
    this.update();
    const c = await client.checkListing(target);
    if (t !== this.token) return;
    if (c.ok) this.listing = { kind: "ready", target };
    else if (c.alreadyListed) {
      this.token = { ...t, section: "listed", reason: null };
      this.listing = { kind: "idle" };
      void this.refreshFee();
    } else this.listing = { kind: "blocked", reason: c.reason };
    this.update();
  }

  async list() {
    const t = this.token;
    const client = this.client;
    const l = this.listing;
    if (!t || !client || (l.kind !== "ready" && l.kind !== "error")) return;
    const target = l.target;
    const base = { token: t.address, symbol: t.symbol, venue: target.venue, partner: this.partner };
    this.host.emit("listing", { ...base, stage: "started", txHash: null, error: null });
    this.listing = { kind: "confirm", target };
    this.update();
    let hash: Hash | null = null;
    try {
      await client.list(target, {
        onSent: (h) => {
          hash = h;
          this.listing = { kind: "sending", target, hash: h };
          this.host.emit("listing", { ...base, stage: "submitted", txHash: h, error: null });
          this.update();
        },
      });
      this.listing = { kind: "done" };
      if (this.token === t) this.token = { ...t, section: "listed", reason: null };
      this.host.emit("listing", { ...base, stage: "listed", txHash: hash, error: null });
      void this.refreshFee();
      this.schedulePreview(0);
    } catch (err) {
      const e = toFlipperError(err, { symbol: t.symbol });
      this.listing = { kind: "error", message: e.message, target };
      this.host.emit("listing", { ...base, stage: "failed", txHash: null, error: e.message });
      this.emitError(err, "listing");
    }
    this.update();
  }

  // ── WETH ────────────────────────────────────────────────────────────────────────────────────────────
  async unwrap() {
    const client = this.client;
    const amount = this.wethBalance;
    if (!client || !amount || amount === 0n) return;
    this.unwrapping = true;
    this.update();
    try {
      await client.unwrapWeth(amount);
      this.unwrapDone = true;
      await this.refreshBalances();
    } catch (err) {
      this.emitError(err, "flip");
      if (rpcErrorCode(err) !== 4001) this.phase = { kind: "error", message: toFlipperError(err).message };
    } finally {
      this.unwrapping = false;
      this.update();
    }
  }

  async watchAsset(t: WidgetToken) {
    if (!this.provider || t.native) return;
    try {
      await this.provider.request({
        method: "wallet_watchAsset",
        params: { type: "ERC20", options: { address: t.address, symbol: t.symbol.slice(0, 11), decimals: t.decimals, image: t.logo ?? undefined } },
      });
    } catch {
      /* declined or unsupported */
    }
  }

  // ── errors ──────────────────────────────────────────────────────────────────────────────────────────
  emitError(err: unknown, context: FlipperEventMap["error"]["context"], codeOverride?: FlipperEventMap["error"]["code"], symbol?: string) {
    const e = toFlipperError(err, { symbol });
    const kind = e.kind === "user-rejected" ? "user-rejected" : e.kind;
    const code = codeOverride ?? (err instanceof FlipperApiError ? "network" : rpcErrorCode(err) === 4001 ? "user-rejected" : kind);
    this.host.emit("error", { code: code as FlipperEventMap["error"]["code"], message: (err as Error)?.message && !e.message ? String((err as Error).message) : e.message, context, partner: this.partner });
  }
}

function toInput(value: bigint, decimals: number, maxFractionDigits = 6): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const s = v.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals) || "0";
  const frac = s.slice(s.length - decimals).slice(0, maxFractionDigits).replace(/0+$/, "");
  return `${neg ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}
