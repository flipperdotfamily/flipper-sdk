---
"@flipperdotfamily/sdk": minor
"@flipperdotfamily/widget": patch
---

Flip limits, claimable ETH and the team stake's MAX cushion, for the house's new ABI:
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
