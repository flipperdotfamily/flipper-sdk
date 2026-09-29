---
"@flipperdotfamily/sdk": minor
"@flipperdotfamily/widget": patch
"@flipperdotfamily/react-native": patch
---

The edge schedule and drawdown-scaled Kelly, for the house's new views:
- `house()` now carries `terms`, the base terms now: `{ baseWinChanceBps, flipperPayoutBps, kellyBps, scheduled }`
  from `currentBaseWinChanceBps()`, `currentFlipperPayoutBps()` and `currentKellyBps()`. The edge schedule steps the
  base down from 45% / 2.05× toward 47.5% / 2× as the house's net buybacks grow, so show `terms`, not `params`. A house
  from before the schedule answers from `params()`. Also as `baseTerms()`.
- `edgeProgress()`: net buybacks, their ratcheted high, the schedule's endpoints, progress and the edges now (null
  without a schedule).
- `minStake($FLIPPER)` and `maxStake(token, hi, true)` use the current payout and base win chance.
- New `formatWinChance`, `houseEdgeBps`; `formatMultiple` shows up to three decimals, rounded down (2.025×).
- The widget and the React Native headless hook show the current terms.
- House ABI regenerated: `currentBaseWinChanceBps`, `currentFlipperPayoutBps`, `currentKellyBps`, `edgeProgress`,
  `edgeSchedule`, `netBuybackEth`, `buybackHigh`, `kellyMinBps`, `kellyDdStartBps`, `kellyDdEndBps`,
  `setEdgeSchedule`, `setBuybackHigh`, `setKellySchedule` and their events.
