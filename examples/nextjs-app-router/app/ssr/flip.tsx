"use client";

import { FlipperWidget } from "@flipperdotfamily/react";
import { useWalletClient } from "wagmi";
import { useStack } from "../providers";
import { openWalletPicker } from "../wallet";

/** Before the stack loads (and in the static HTML): the widget read-only. After: wired to the reader's wallet. */
export function Flip() {
  const stack = useStack();
  // (no manifest yet: nothing to fetch until the stack is known)
  return stack ? <ConnectedFlip /> : <FlipperWidget deploymentUrl={null} style={{ minHeight: 520, visibility: "hidden" }} />;
}

function ConnectedFlip() {
  const { data: walletClient } = useWalletClient();
  return (
    <FlipperWidget
      walletClient={walletClient ?? null}
      onConnectRequest={openWalletPicker}
      onFlipSettled={(d) => console.log("flip", d.flipId, d.outcome)}
      style={{ minHeight: 520 }}
    />
  );
}
