"use client";

import { useEffect, useState } from "react";
import { useConnect, useConnection, useConnectors, useDisconnect } from "wagmi";
import { useStack } from "./providers";
import { DEV_WALLET_ID } from "./showcase";

/** Anything on the page can ask for the wallet picker (the embed does, when a reader presses Connect in it). */
export const openWalletPicker = () => window.dispatchEvent(new Event("block-ledger:connect"));

export function WalletButton() {
  const stack = useStack();
  if (!stack) return <button className="sign" disabled>Connect wallet</button>;
  return <WalletButtonLive />;
}

function WalletButtonLive() {
  const { address } = useConnection();
  const { mutate: disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener("block-ledger:connect", on);
    return () => window.removeEventListener("block-ledger:connect", on);
  }, []);
  return (
    <>
      {address ? (
        <button className="sign on" onClick={() => disconnect()} title="Disconnect">
          {address.slice(0, 6)}…{address.slice(-4)}
        </button>
      ) : (
        <button className="sign" onClick={() => setOpen(true)}>
          Connect wallet
        </button>
      )}
      {open && <Picker onClose={() => setOpen(false)} />}
    </>
  );
}

function Picker({ onClose }: { onClose: () => void }) {
  const connectors = useConnectors();
  const { mutate: connect, isPending, error } = useConnect();
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Connect a wallet">
        <h3>Connect a wallet</h3>
        {connectors.length === 0 && <p className="muted">No browser wallet found. Install one, such as Rabby or MetaMask.</p>}
        {connectors.map((c) => (
          <button key={c.uid} className="wallet" disabled={isPending} onClick={() => connect({ connector: c }, { onSuccess: onClose })}>
            {c.icon && <img src={c.icon} alt="" />}
            <span>{c.name}</span>
            {c.id === DEV_WALLET_ID && <span className="dev">DEV · local fork</span>}
          </button>
        ))}
        {error && <p className="err">{error.message.split("\n")[0]}</p>}
      </div>
    </div>
  );
}
