import { Injectable, signal } from "@angular/core";
import type { Eip1193Provider } from "@flipperdotfamily/angular";

export interface WalletInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}
interface Announced {
  info: WalletInfo;
  provider: Eip1193Provider;
}

/**
 * Casa Fortuna's wallet service: browser wallets discovered through EIP-6963 (MetaMask, Rabby, Coinbase… and, on a
 * local fork, the showcase's dev wallet). In a real app this is your Reown AppKit / wagmi-core / ethers service:
 * flipper only needs the EIP-1193 provider.
 */
@Injectable({ providedIn: "root" })
export class WalletService {
  readonly wallets = signal<Announced[]>([]);
  readonly provider = signal<Eip1193Provider | null>(null);
  readonly address = signal<string | null>(null);
  private current: Announced | null = null;

  constructor() {
    window.addEventListener("eip6963:announceProvider", (e: Event) => {
      const d = (e as CustomEvent<Announced>).detail;
      this.wallets.update((all) => (all.some((w) => w.info.uuid === d.info.uuid) ? all : [...all, d]));
    });
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    // reconnect the last wallet if it still has this site authorised
    const last = localStorage.getItem("cf:wallet");
    setTimeout(async () => {
      const w = this.wallets().find((x) => x.info.rdns === last);
      const accounts = w ? ((await w.provider.request({ method: "eth_accounts" }).catch(() => [])) as string[]) : [];
      if (w && accounts[0]) await this.connect(w);
    }, 150);
  }

  async connect(w: Announced): Promise<void> {
    const accounts = (await w.provider.request({ method: "eth_requestAccounts" })) as string[];
    this.current = w;
    localStorage.setItem("cf:wallet", w.info.rdns);
    this.address.set(accounts[0] ?? null);
    w.provider.on?.("accountsChanged", (a: string[]) => this.address.set(a[0] ?? null));
    this.provider.set(w.provider);
  }

  disconnect(): void {
    this.current?.provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }).catch(() => {});
    this.current = null;
    localStorage.removeItem("cf:wallet");
    this.provider.set(null);
    this.address.set(null);
  }
}
