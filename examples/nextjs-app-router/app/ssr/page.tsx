import Link from "next/link";
import { Flip } from "./flip";

// The React path: <FlipperWidget /> from @flipperdotfamily/react. The static HTML already contains the <flipper-widget> tag;
// the browser upgrades it and wagmi hands it the reader's wallet.
export default function SsrDemo() {
  return (
    <main className="page narrow">
      <article className="story">
        <p className="kicker">Developers</p>
        <h1>The same flip, as a React component</h1>
        <p className="dek">
          The article embeds flipper in an iframe. This page renders it with <code>@flipperdotfamily/react</code> instead. The tag
          is in the server-rendered HTML, and the wallet comes from the site&apos;s wagmi config.
        </p>
        <Flip />
        <p className="aside-link">
          <Link href="/">← Back to the story</Link>
        </p>
      </article>
    </main>
  );
}
