import Link from "next/link";
import { LiveFlip } from "./live-flip";

// A server component, pre-rendered at build time (static export). The live flip inside is a client component.
export default function Article() {
  return (
    <main className="page">
      <article className="story">
        <p className="kicker">DeFi · Feature</p>
        <h1>Coin flips are back, and this time you can check the coin</h1>
        <p className="dek">
          Double-or-nothing is one of the oldest bets there is. A new generation of onchain houses lets any site offer
          it, and publishes every flip for anyone to check.
        </p>
        <p className="byline">
          By <b>Mara Quinn</b> · 6 min read
        </p>

        <p>
          The pitch fits on a napkin: stake a token, a coin is tossed, and heads pays double. What&apos;s new is where the
          coin lives. In flipper&apos;s design, the house&apos;s bankroll sits in a public contract, the randomness comes from
          a verifiable source, and every flip, won or lost, is a transaction anyone can look up. The house still has an
          edge. It just can&apos;t hide it.
        </p>
        <p>
          That openness has turned the humble coin flip into a building block. Communities put it on their landing pages.
          Wallets tuck it into a sidebar. Games give it away as a bonus round. None of them runs a casino. They embed one.
        </p>

        <LiveFlip />

        <h2>An embed, not an integration project</h2>
        <p>
          The widget above is a plain iframe. The publisher adds a container and one call. The reader&apos;s wallet never
          leaves the host page: when the flip needs a signature, the embed asks the host through a small postMessage
          bridge, and the host passes it to the wallet the reader already connected.
        </p>
        <blockquote>&ldquo;We didn&apos;t want to become a casino. We wanted a button that made our token fun.&rdquo;</blockquote>
        <p>
          For sites that would rather render it themselves, the same widget ships as a web component, with wrappers for
          React, Vue, Svelte and Angular. It sizes itself from its container, so a 240-pixel sidebar and a full-width hero
          both work.
        </p>
        <p>
          Whether the novelty lasts is another question. But the direction is clear. The interesting part of onchain
          games was never the game. It&apos;s being able to check that the house played fair.
        </p>
        <p className="aside-link">
          Developers: <Link href="/ssr/">the same widget as a server-rendered React component →</Link>
        </p>
      </article>

      <aside className="rail">
        <h3>Most read</h3>
        <ol>
          <li>Stablecoin yields slide as treasury rates cool</li>
          <li>Inside the race to index every v4 hook</li>
          <li>Why launchpads are rethinking bonding curves</li>
          <li>The quiet return of onchain games</li>
        </ol>
      </aside>
    </main>
  );
}
