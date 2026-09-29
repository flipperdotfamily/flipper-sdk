import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import { WalletButton } from "./wallet";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Block Ledger",
  description: "Markets, protocols and the people building them.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap"
        />
      </head>
      <body>
        <Providers>
          <header className="mast">
            <div className="mast-in">
              <span className="date">Markets · Protocols · Culture</span>
              <Link className="title" href="/">
                The Block Ledger
              </Link>
              <WalletButton />
            </div>
            <nav className="sections">
              <a href="#">Markets</a>
              <a href="#" className="on">DeFi</a>
              <a href="#">Policy</a>
              <a href="#">Builders</a>
              <a href="#">Opinion</a>
            </nav>
          </header>
          {children}
          <footer className="foot">
            <span>© The Block Ledger. A demo publication.</span>
            <span>Live flips by flipper.family</span>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
