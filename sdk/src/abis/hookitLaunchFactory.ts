// Hand-written subset of hookit.fun's Master-rail LaunchFactory (v1 0xAB6e…afdd, v2 0x2851…322F on Ink).
// Source: research/HOOKIT_INK_REPORT.md §5 (topic0 checked against real logs). Note hookit's own docs show a
// 6-parameter TokenLaunched signature that does NOT match onchain logs; this is the real one.

export const hookitLaunchFactoryAbi = [
  {
    type: "event",
    name: "TokenLaunched",
    anonymous: false,
    inputs: [
      { name: "launchId", type: "uint256", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "poolId", type: "bytes32", indexed: false },
      { name: "hooks", type: "address", indexed: false },
      { name: "customHook", type: "bool", indexed: false },
      { name: "tickLower", type: "int24", indexed: false },
      { name: "tickUpper", type: "int24", indexed: false },
      { name: "liquidity", type: "uint128", indexed: false },
    ],
  },
  {
    type: "function",
    name: "tokenLaunchId",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
