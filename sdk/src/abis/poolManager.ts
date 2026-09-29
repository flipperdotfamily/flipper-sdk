// Hand-written subset of the Uniswap v4 PoolManager (Ink: 0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32).

export const poolManagerAbi = [
  {
    type: "event",
    name: "Initialize",
    anonymous: false,
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "currency0", type: "address", indexed: true },
      { name: "currency1", type: "address", indexed: true },
      { name: "fee", type: "uint24", indexed: false },
      { name: "tickSpacing", type: "int24", indexed: false },
      { name: "hooks", type: "address", indexed: false },
      { name: "sqrtPriceX96", type: "uint160", indexed: false },
      { name: "tick", type: "int24", indexed: false },
    ],
  },
] as const;
