---
"@flipperdotfamily/sdk": patch
---

`flip()` and `flipEth()` send the randomness fee exactly when the house's randomness adapter charges a flat fee (Dice,
Pyth Entropy), and pad it × 1.2 only when the fee moves with the gas price (Chainlink VRF). Padding a flat fee bought
nothing and made flips revert for contract wallets without `receive()`, since the house's refund of the excess failed.
New: `randomnessFeeIsGasPriced(token)` (probed once per client, by quoting `randomnessFeeFor` at two gas prices; a
failed probe pads) and `randomnessFeeToSend(token, fee?)`.
