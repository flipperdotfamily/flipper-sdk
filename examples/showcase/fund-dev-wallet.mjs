// Tops up the showcase's dev wallet on a LOCAL fork, so every demo site can flip end to end on a fresh stack:
//   - ETH (anvil_setBalance) when it's under 1 ETH;
//   - the demo sites' tokens that dev.sh doesn't hand out, by writing the ERC-20 balance slot (anvil_setStorageAt):
//     the memecoin page's club token (the page's own pick: the first listed pons launch, 0.1% of its
//     supply) and Lagoon's BNKR. The slot is found the way forge's `deal` finds it: among the
//     storage slots balanceOf reads (eth_createAccessList), each probed and put back if it isn't the balance.
//     $FLIPPER and the reward token already come from dev.sh's funding.
// No dependencies (it runs before, or without, the examples' node_modules). Needs DEV_WALLET_ADDRESS. Refuses unless
// the web app's chain RPC is on this machine; anvil_* calls fail on anything that isn't anvil. Idempotent.
const WANT = [{ symbol: "BNKR", amount: 2_500n }]; // whole tokens
const webUrl = (process.env.FLIPPER_WEB_URL || "http://localhost:3000").replace(/\/$/, "");
const me = process.env.DEV_WALLET_ADDRESS;
if (!/^0x[0-9a-fA-F]{40}$/.test(me || "")) process.exit(0);

const manifest = await (await fetch(`${webUrl}/embed/deployment.json`, { signal: AbortSignal.timeout(8000) })).json();
const d = manifest.deployments[String(manifest.default)];
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(d.rpcUrl)) {
  console.log(`[examples] dev wallet: ${d.name} isn't a local fork; nothing to fund`);
  process.exit(0);
}

let id = 0;
async function rpc(method, params = []) {
  const r = await fetch(d.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}
const word = (n) => `0x${n.toString(16).padStart(64, "0")}`;
const balanceCall = `0x70a08231${me.slice(2).toLowerCase().padStart(64, "0")}`;
const balanceOf = async (token) => BigInt(await rpc("eth_call", [{ to: token, data: balanceCall }, "latest"]));

// ETH
const eth = BigInt(await rpc("eth_getBalance", [me, "latest"]));
if (eth < 10n ** 18n) {
  await rpc("anvil_setBalance", [me, `0x${(10n * 10n ** 18n).toString(16)}`]);
  console.log(`[examples] dev wallet ${me}: ETH → 10`);
}

// tokens
const api = d.apiUrl?.replace(/\/$/, "");
const getJson = async (url) => (await fetch(url).catch(() => null))?.json().catch(() => null) ?? null;
const listed = api ? ((await getJson(`${api}/v1/tokens?limit=100`))?.tokens ?? []).filter((x) => x.section === "listed") : [];
const wanted = [];
for (const { symbol, amount } of WANT) {
  const t = listed.find((x) => x.symbol.toLowerCase() === symbol.toLowerCase());
  if (t) wanted.push({ t, target: amount * 10n ** BigInt(t.decimals) });
}
for (const kind of api ? ["pons"] : []) {
  const club = ((await getJson(`${api}/v1/tokens?kind=${kind}&limit=100`))?.tokens ?? []).find((x) => x.section === "listed");
  if (!club) continue;
  const supply = BigInt(await rpc("eth_call", [{ to: club.address, data: "0x18160ddd" }, "latest"]));
  wanted.push({ t: club, target: supply / 1000n });
  break;
}
for (const { t, target } of wanted) {
  const { symbol } = t;
  const amount = target / 10n ** BigInt(t.decimals);
  if ((await balanceOf(t.address)) >= target / 2n) continue;
  const list = await rpc("eth_createAccessList", [{ from: me, to: t.address, data: balanceCall }, "latest"]).catch(() => ({ accessList: [] }));
  const slots = list.accessList.filter((e) => e.address.toLowerCase() === t.address.toLowerCase()).flatMap((e) => e.storageKeys);
  let done = false;
  for (const slot of slots) {
    const old = await rpc("eth_getStorageAt", [t.address, slot, "latest"]);
    await rpc("anvil_setStorageAt", [t.address, slot, word(target)]);
    if ((await balanceOf(t.address)) === target) {
      done = true;
      break;
    }
    await rpc("anvil_setStorageAt", [t.address, slot, old]);
  }
  console.log(`[examples] dev wallet ${me}: ${symbol} ${done ? `→ ${amount}` : "(balance slot not found; skipped)"}`);
}
