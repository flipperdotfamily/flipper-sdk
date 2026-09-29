<!--
  <FlipperWidget>: the drop-in flip UI for Svelte 5. Props are the widget options; on* callbacks receive the event
  detail. Wallets come from you (provider / walletClient); open your connect modal in onConnectRequest.

  <FlipperWidget {provider} theme="dark" partner="acme" onConnectRequest={openModal} onFlipSettled={(d) => …} bind:element />
-->
<script>
  import { onMount } from "svelte";

  /** @type {import('./index').FlipperWidgetProps} */
  let {
    element = $bindable(),
    onReady,
    onConnectRequest,
    onFlipRequested,
    onFlipSettled,
    onPayoutResolved,
    onListing,
    onError,
    onResize,
    class: className = undefined,
    style = undefined,
    ...options
  } = $props();

  const EVENTS = {
    ready: () => onReady,
    "connect-request": () => onConnectRequest,
    "flip-requested": () => onFlipRequested,
    "flip-settled": () => onFlipSettled,
    "payout-resolved": () => onPayoutResolved,
    listing: () => onListing,
    error: () => onError,
    resize: () => onResize,
  };

  onMount(() => {
    const node = element;
    /** @type {(() => void)[]} */
    const offs = [];
    // listeners and properties work before the element is upgraded (Lit adopts pre-set properties)
    // connect-request reaches onConnectRequest through the element's property (below), not the event
    for (const [name, get] of Object.entries(EVENTS)) {
      if (name === "connect-request") continue;
      /** @param {Event} e */
      const fn = (e) => get()?.(/** @type {CustomEvent} */ (e).detail);
      node?.addEventListener(name, fn);
      offs.push(() => node?.removeEventListener(name, fn));
    }
    import("@flipperdotfamily/widget");
    return () => offs.forEach((off) => off());
  });

  $effect(() => {
    if (!element) return;
    const node = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (element));
    for (const [k, v] of Object.entries(options)) {
      if (v !== undefined && node[k] !== v) node[k] = v;
    }
    const handler = onConnectRequest;
    node.onConnectRequest = handler ? (/** @type {any} */ d) => handler(d) : undefined;
  });
</script>

<flipper-widget bind:this={element} variant={options.variant} class={className} {style}></flipper-widget>
