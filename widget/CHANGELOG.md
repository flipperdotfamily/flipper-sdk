# @flipperdotfamily/widget

## 0.2.0

### Minor Changes

- 3233bb5: First public release of the flipper.family developer platform:
  - `@flipperdotfamily/widget`: the `<flipper-widget>` web component and its CDN builds;
  - framework wrappers for React, Vue, Svelte and Angular;
  - the headless `@flipperdotfamily/sdk`, with deployments, listing by venue (v4 / v3), native ETH and the API client.

### Patch Changes

- 3233bb5: The edge schedule and drawdown-scaled Kelly, for the house's new views:
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
- 3233bb5: Flip limits, claimable ETH and the team stake's MAX cushion, for the house's new ABI:
  - Reject code 9 (`RejectCode.TOO_MANY_OPEN`, `TOO_MANY_OPEN_MESSAGE`): too many of the player's flips are waiting for
    randomness. Previews now run from the connected account, so it shows before the flip. `flipLimits()` and
    `openFlips(player)` read the limits.
  - Reject code 2 also means "below the minimum size" (`key: "BELOW_MIN"`, `BELOW_MIN_SIZE_MESSAGE`). `minStake(token)`
    gives the smallest accepted stake, `estimateMinStake` extrapolates from a preview, and `rejectReason(2, { minStake,
    decimals })` names it. The widget's note names the minimum.
  - `claimables()` ends with native ETH (`token: zeroAddress`, `native: true`): a randomness-fee excess the house
    couldn't refund; `claim(zeroAddress)` withdraws it. New `claimableEth(user)` and `surplus(token)` (`lens.surplus`).
  - `requestTeamExcess("max")` (and `maxUint256`) leaves a cushion of 1% of the principal (`TEAM_EXCESS_CUSHION_BPS`,
    `teamExcessMax`), since requesting the whole excess often reverted with `PrincipalBreach`; `teamStake()` reports it
    as `requestableExcess`.
  - The widget sends the exact randomness fee for a flat-fee adapter in its balance check and max reserve too.
  - ABIs regenerated: `setFlipLimits`, `openFlips`, `minLiability`, `maxOpenPerPlayer`, `withdrawable`, `lockedTime`,
    `FlipLimitsSet` (house), `freeBankroll` (vault), `surplus` (lens), and the converter's `seedPrice`, `PriceSeeded`,
    `AlreadyPriced`, `FLOOR_BPS`, `FLOOR_HALF_LIFE` and new `lot()` tuple.
- Updated dependencies [3233bb5]
- Updated dependencies [3233bb5]
- Updated dependencies [3233bb5]
- Updated dependencies [3233bb5]
- Updated dependencies [3233bb5]
- Updated dependencies [3233bb5]
  - @flipperdotfamily/sdk@0.2.0
