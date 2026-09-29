import { Component, inject, signal } from "@angular/core";
import { FlipperWidgetComponent, type FlipperEventMap } from "@flipperdotfamily/angular";
import { STACK } from "./stack";
import { WalletService } from "./wallet.service";

interface Play {
  id: string;
  won: boolean;
  text: string;
}

@Component({
  selector: "app-root",
  standalone: true,
  imports: [FlipperWidgetComponent],
  template: `
    <header class="nav">
      <div class="wrap nav-in">
        <a class="brand" href="#"><img src="assets/logo.svg" alt="" />Casa Fortuna</a>
        <nav>
          <a href="#" class="on">Casino</a><a href="#">En vivo</a><a href="#">Promociones</a><a href="#">VIP</a>
        </nav>
        @if (wallet.address(); as address) {
          <button class="gold ghost" (click)="wallet.disconnect()" title="Desconectar">{{ short(address) }}</button>
        } @else {
          <button class="gold" (click)="picking.set(true)">Conectar billetera</button>
        }
      </div>
    </header>

    <main class="wrap">
      <section class="table-hero">
        <div class="copy">
          <span class="eyebrow">Juego destacado</span>
          <h1>Cara o Cruz Real</h1>
          <p>
            Doble o nada, en un instante. Elige tu ficha, lanza la moneda y cobra al momento. Cada lanzamiento es
            justo y se puede verificar en la cadena.
          </p>
          <ul class="perks">
            <li><b>Instantáneo</b><span>Se resuelve en segundos</span></li>
            <li><b>Verificable</b><span>Aleatoriedad en la cadena</span></li>
            <li><b>Sin registro</b><span>Solo tu billetera</span></li>
          </ul>
        </div>
        <div class="felt">
          <!-- Fully white-labelled: our name, logo, coin, font, colours and corners (see styles.css), in Spanish -->
          <flipper-widget
            class="casino"
            [provider]="wallet.provider()"
            [chainId]="stack.chainId"
            [deploymentUrl]="stack.deploymentUrl"
            [branding]="false"
            brandName="Casa Fortuna"
            brandLogo="assets/logo.svg"
            coinImage="assets/coin-heads.svg"
            coinImageTails="assets/coin-tails.svg"
            locale="es"
            [details]="true"
            theme="dark"
            partner="casa-fortuna"
            (connectRequest)="picking.set(true)"
            (flipSettled)="onSettled($event)"
            (flipperError)="onError($event)"
          ></flipper-widget>
        </div>
      </section>

      <section>
        <h2>Más juegos</h2>
        <div class="games">
          @for (g of games; track g.name) {
            <div class="game" [style.background]="g.bg">
              <span class="suit">{{ g.suit }}</span>
              <b>{{ g.name }}</b>
              <small>Próximamente</small>
            </div>
          }
        </div>
      </section>

      <section>
        <h2>Últimas jugadas</h2>
        @if (plays().length) {
          <ul class="plays" data-testid="plays">
            @for (p of plays(); track p.id) {
              <li [class.won]="p.won">{{ p.text }}</li>
            }
          </ul>
        } @else {
          <p class="muted">Aún no hay jugadas en esta sesión.</p>
        }
      </section>
    </main>

    <footer class="wrap">
      <span>Juega con responsabilidad · Solo mayores de 18 años</span>
      <span>Casa Fortuna es un sitio de demostración</span>
    </footer>

    @if (picking()) {
      <div class="modal" (click)="$event.target === $event.currentTarget && picking.set(false)">
        <div class="sheet" role="dialog" aria-modal="true" aria-label="Conectar billetera">
          <h3>Conectar billetera</h3>
          @for (w of wallet.wallets(); track w.info.uuid) {
            <button class="wallet" (click)="connect(w)">
              <img [src]="w.info.icon" alt="" />
              <span>{{ w.info.name }}</span>
              @if (w.info.rdns === devRdns) {
                <span class="dev">DEV · fork local</span>
              }
            </button>
          } @empty {
            <p class="muted">No encontramos ninguna billetera. Instala Rabby o MetaMask.</p>
          }
        </div>
      </div>
    }
  `,
})
export class AppComponent {
  protected readonly wallet = inject(WalletService);
  protected readonly stack = inject(STACK);
  protected readonly picking = signal(false);
  protected readonly plays = signal<Play[]>([]);
  protected readonly devRdns = "family.flipper.devwallet";
  protected readonly games = [
    { name: "Ruleta", suit: "♦", bg: "linear-gradient(135deg,#5b1020,#2a0710)" },
    { name: "Blackjack", suit: "♠", bg: "linear-gradient(135deg,#10233a,#08121f)" },
    { name: "Póker", suit: "♣", bg: "linear-gradient(135deg,#1b3a24,#0b1d12)" },
    { name: "Dados", suit: "♥", bg: "linear-gradient(135deg,#3b2a0a,#1d1404)" },
  ];

  protected short(a: string) {
    return `${a.slice(0, 6)}…${a.slice(-4)}`;
  }

  protected async connect(w: ReturnType<WalletService["wallets"]>[number]) {
    await this.wallet.connect(w);
    this.picking.set(false);
  }

  protected onSettled(d: FlipperEventMap["flip-settled"]) {
    const amount = (Number(BigInt(d.amount) / 10n ** BigInt(Math.max(0, d.decimals - 2))) / 100).toLocaleString("es");
    const text = d.pending ? `Ganaste: se están pagando ${amount} ${d.symbol}` : d.won ? `Ganaste: ${amount} ${d.symbol} se duplicaron` : `Perdiste ${amount} ${d.symbol}`;
    // a pending win settles twice (winnings on their way, then paid): one row per flip
    this.plays.update((all) => [{ id: d.flipId, won: d.won, text }, ...all.filter((p) => p.id !== d.flipId)]);
  }

  protected onError(e: FlipperEventMap["error"]) {
    console.warn("flipper:", e.message);
  }
}
