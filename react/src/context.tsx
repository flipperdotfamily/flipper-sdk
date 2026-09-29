import { createContext, useContext, type ReactNode } from "react";
import type { FlipperOptions } from "./options";

const FlipperConfigContext = createContext<Partial<FlipperOptions>>({});

/** Defaults (partner, theme, chain, addresses…) for every `<FlipperWidget />` below it. Props on a widget win. */
export function FlipperConfigProvider({ config, children }: { config: Partial<FlipperOptions>; children?: ReactNode }) {
  const parent = useContext(FlipperConfigContext);
  return <FlipperConfigContext.Provider value={{ ...parent, ...config }}>{children}</FlipperConfigContext.Provider>;
}

export function useFlipperConfig(): Partial<FlipperOptions> {
  return useContext(FlipperConfigContext);
}
