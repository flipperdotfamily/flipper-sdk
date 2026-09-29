import { tokenSection, type ApiToken, type ApiTokenSection } from "@flipperdotfamily/sdk";
import { getAddress, isAddressEqual, type Address } from "viem";
import type { FlipperController, WidgetToken } from "./controller";

const PAGE = 40;

export function fromApi(t: ApiToken, flipper?: Address): WidgetToken {
  const isFlipper = !!flipper && isAddressEqual(t.address, flipper);
  return {
    address: getAddress(t.address),
    symbol: t.symbol ?? "???",
    name: t.name ?? "",
    decimals: t.decimals ?? 18,
    logo: t.logo ?? null,
    verified: !!t.verified || isFlipper,
    verifiedBy: t.verifiedBy ?? [],
    section: isFlipper ? "listed" : tokenSection(t),
    reason: t.eligibility?.reason ?? null,
    isFlipper,
    api: t,
  };
}

const matches = (t: WidgetToken, q: string) => {
  const s = q.trim().toLowerCase().replace(/^\$/, "");
  if (!s) return true;
  if (t.symbol.toLowerCase().replace(/^\$/, "").startsWith(s)) return true;
  if (t.name.toLowerCase().split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(s))) return true;
  const hex = s.startsWith("0x") ? s.slice(2) : s;
  return /^[0-9a-f]{2,}$/.test(hex) && t.address.toLowerCase().slice(2).startsWith(hex);
};
/**
 * The picker's data: pages from the flipper API (sections, search, logos, verified), an allowlist, or, without an
 * API, the house's listed tokens read onchain. Native ETH is an ordinary row of the section its state puts it in
 * (WETH's: Flippable once WETH is listed, else Listable or Not supported), found like any token ("eth", "ether",
 * "$eth"); WETH keeps its own row.
 */
export class TokenListModel {
  query = "";
  rows: WidgetToken[] = [];
  sections: Partial<Record<ApiTokenSection, number>> = {};
  next: number | null = null;
  loading = false;
  error?: string;
  loaded = false;
  private seq = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private eth?: WidgetToken | null;
  private allow?: WidgetToken[];
  private chainList?: WidgetToken[];

  constructor(
    private ctl: FlipperController,
    private onChange: () => void,
  ) {}

  /** Forget everything (config changed). */
  reset() {
    this.seq++;
    this.rows = [];
    this.sections = {};
    this.next = null;
    this.loaded = false;
    this.error = undefined;
    this.eth = undefined;
    this.allow = undefined;
    this.chainList = undefined;
  }

  open() {
    if (!this.loaded && !this.loading) void this.load(true);
  }

  setQuery(q: string) {
    this.query = q;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.load(true), this.ctl.api && !this.ctl.allowlist ? 220 : 0);
    this.onChange();
  }

  get hasMore() {
    return this.next !== null && !this.loading && !this.error;
  }

  async loadMore() {
    if (this.hasMore) await this.load(false);
  }

  async load(fresh: boolean) {
    const seq = ++this.seq;
    this.loading = true;
    this.error = undefined;
    this.onChange();
    try {
      const flipper = this.ctl.house?.flipper;
      const q = this.query;
      if (this.eth === undefined) this.eth = this.ctl.ethEnabled ? ((await this.ctl.resolveToken("ETH").catch(() => undefined)) ?? null) : null;
      const allow = this.ctl.allowlist;
      let rows: WidgetToken[];
      let next: number | null = null;
      let sections: Partial<Record<ApiTokenSection, number>> = {};
      if (allow) {
        this.allow ??= (await Promise.all(allow.map((a) => this.ctl.resolveToken(a).catch(() => undefined)))).filter((t): t is WidgetToken => !!t);
        rows = this.allow.filter((t) => matches(t, q));
      } else if (this.ctl.api) {
        const page = await this.ctl.api.tokens({ q, limit: PAGE, offset: fresh ? 0 : (this.next ?? 0) });
        if (seq !== this.seq) return;
        const got = page.tokens.map((t) => fromApi(t, flipper));
        // ETH is placed again over every loaded row, so a later page of its section still puts it first there
        rows = fresh ? got : [...this.rows.filter((t) => !t.native), ...got];
        next = page.next;
        sections = { ...page.sections };
        rows = this.withEth(rows, q, fresh ? sections : undefined);
      } else {
        this.chainList ??= await this.onChain();
        rows = this.withEth(
          this.chainList.filter((t) => matches(t, q)),
          q,
          sections,
        );
      }
      if (seq !== this.seq) return;
      // de-duplicate (API offsets can shift by a row while the index updates)
      const seen = new Set<string>();
      this.rows = rows.filter((t) => {
        const k = `${t.native ? "eth" : ""}${t.address.toLowerCase()}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      this.next = next;
      if (fresh) this.sections = sections;
      this.loaded = true;
    } catch (err) {
      if (seq !== this.seq) return;
      this.error = (err as Error)?.message || "Couldn't load the token list.";
    } finally {
      if (seq === this.seq) {
        this.loading = false;
        this.onChange();
      }
    }
  }

  /**
   * Native ETH, as flipper.family's picker places it: right after $FLIPPER in Flippable, first in the other sections
   * (counted in its section, once per fresh list).
   */
  private withEth(rows: WidgetToken[], q: string, sections?: Partial<Record<ApiTokenSection, number>>): WidgetToken[] {
    const eth = this.eth;
    if (!eth || !matches(eth, q)) return rows;
    const out = [...rows];
    let at = out.findIndex((t) => order(t.section) > order(eth.section) || (t.section === eth.section && !t.isFlipper));
    if (at < 0) at = out.length;
    out.splice(at, 0, eth);
    if (sections) sections[eth.section] = (sections[eth.section] ?? 0) + 1;
    return out;
  }

  private async onChain(): Promise<WidgetToken[]> {
    const client = this.ctl.client;
    const house = this.ctl.house;
    if (!client || !house) return [];
    const views = await client.listedTokens();
    const out: WidgetToken[] = [];
    const flipper = await this.ctl.resolveToken(house.flipper);
    if (flipper) out.push(flipper);
    for (const v of views) {
      if (isAddressEqual(v.token, house.flipper)) continue;
      out.push({
        address: v.token,
        symbol: v.symbol,
        name: v.name,
        decimals: v.decimals,
        section: v.enabled && !v.blocked ? "listed" : "unsupported",
        reason: v.blocked ? "Disabled by the house." : v.enabled ? null : "Not enabled.",
        logo: null,
      });
    }
    return out;
  }
}

const order = (s: ApiTokenSection) => (s === "listed" ? 0 : s === "eligible" ? 1 : 2);
