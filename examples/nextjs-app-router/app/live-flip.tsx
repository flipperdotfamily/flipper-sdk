"use client";

import { mountFlipperIframe, type FlipperIframe } from "@flipperdotfamily/widget/host";
import { useEffect, useRef, useState } from "react";
import { useConnection } from "wagmi";
import type { Eip1193Provider } from "@flipperdotfamily/widget";
import { useStack } from "./providers";
import { openWalletPicker } from "./wallet";

/** The Ledger's widget palette (the SSR page sets the same through CSS, in globals.css). */
const LEDGER_PALETTE = {
  background: "#ffffff",
  surface: "#f6f8f7",
  field: "#f0f3f2",
  border: "#0f15131c",
  text: "#0f1513",
  textMuted: "#0f151399",
  textSubtle: "#0f151366",
  shadow: "0 1px 2px #0f151312, 0 10px 30px #0f151314",
};

/**
 * The live flip in the article: the hosted embed in an iframe, through @flipperdotfamily/widget/host. `fit: "fill"` makes the
 * widget fill the figure's fixed height (no auto-height); the reader's wallet (from the site's wagmi) is bridged in.
 */
export function LiveFlip() {
  const stack = useStack();
  return (
    <figure className="live">
      <div className="frame" data-testid="embed-frame">
        {stack ? <Embed /> : <div className="frame-wait">Loading the live flip…</div>}
      </div>
      <figcaption>
        <b>Try it.</b> A live flip, embedded with one iframe (<code>mountFlipperIframe</code>, <code>fit: &quot;fill&quot;</code>
        ). Your wallet stays on this page; the embed asks it to sign through the bridge.
      </figcaption>
    </figure>
  );
}

function Embed() {
  const stack = useStack()!;
  const box = useRef<HTMLDivElement>(null);
  const embed = useRef<FlipperIframe | null>(null);
  const [settled, setSettled] = useState<string | null>(null);
  const { connector, address } = useConnection();

  useEffect(() => {
    const e = mountFlipperIframe({
      container: box.current!,
      embedUrl: stack.embedUrl,
      fit: "fill",
      title: "Live coin flip",
      params: { chain: stack.chainId, theme: "light", accent: "#c2410c", radius: 14, partner: "block-ledger" },
      // the rest of the Ledger's widget palette (a white card), as a theme object
      config: { theme: { mode: "light", ...LEDGER_PALETTE } },
      onConnectRequest: openWalletPicker,
      onEvent: (name, data) => {
        if (name === "flip-settled") {
          const d = data as { won: boolean; symbol: string };
          setSettled(d.won ? `A reader just won their ${d.symbol} flip.` : `A reader just lost a ${d.symbol} flip.`);
        }
      },
    });
    embed.current = e;
    return () => e.destroy();
  }, [stack]);

  // bridge the reader's wallet into the embed (and out again on disconnect)
  useEffect(() => {
    let live = true;
    if (!connector || !address) embed.current?.setProvider(null);
    else void connector.getProvider().then((p) => live && embed.current?.setProvider(p as Eip1193Provider));
    return () => {
      live = false;
    };
  }, [connector, address]);

  return (
    <>
      <div ref={box} className="frame-box" />
      {settled && (
        <p className="ticker" data-testid="ticker">
          {settled}
        </p>
      )}
    </>
  );
}
