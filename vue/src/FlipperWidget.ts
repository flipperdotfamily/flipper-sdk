import type { Eip1193Provider, FlipperWalletClient } from "@flipperdotfamily/sdk";
import type { FlipperEventMap, FlipperWidget as FlipperWidgetElement, FlipperWidgetConfig } from "@flipperdotfamily/widget/element";
import { defineComponent, getCurrentInstance, h, inject, onBeforeUnmount, onMounted, ref, shallowRef, watch, type InjectionKey, type PropType, type SetupContext } from "vue";

export type { FlipperWidgetElement };
export type FlipperOptions = Omit<FlipperWidgetConfig, "onConnectRequest">;

/** Defaults provided by FlipperPlugin (or `provide(FLIPPER_DEFAULTS, {...})`). */
export const FLIPPER_DEFAULTS: InjectionKey<Partial<FlipperOptions>> = Symbol("flipper-defaults");

const str = { type: String, default: undefined };
const bool = { type: Boolean, default: undefined };

const props = {
  provider: { type: Object as PropType<Eip1193Provider | null>, default: undefined },
  walletClient: { type: Object as PropType<FlipperWalletClient | null>, default: undefined },
  chainId: { type: Number, default: undefined },
  rpcUrl: str,
  apiUrl: { type: String as PropType<string | null>, default: undefined },
  deploymentUrl: { type: String as PropType<string | null>, default: undefined },
  addresses: { type: Object as PropType<FlipperWidgetConfig["addresses"]>, default: undefined },
  token: str,
  tokens: { type: Array as PropType<string[]>, default: undefined },
  mode: { type: String as PropType<FlipperWidgetConfig["mode"]>, default: undefined },
  /** @deprecated use mode="single" */
  hidePicker: bool,
  eth: bool,
  listing: bool,
  minAmount: str,
  maxAmount: str,
  approval: { type: String as PropType<"max" | "exact">, default: undefined },
  variant: { type: String as PropType<FlipperWidgetConfig["variant"]>, default: undefined },
  fit: { type: String as PropType<FlipperWidgetConfig["fit"]>, default: undefined },
  size: { type: String as PropType<FlipperWidgetConfig["size"]>, default: undefined },
  /** show the win chance / payout / fee line (default off) */
  details: bool,
  /** idle headline: true = the built-in one, a string = your own (default none) */
  tagline: { type: [Boolean, String] as PropType<string | boolean>, default: undefined },
  theme: { type: [String, Object] as PropType<FlipperWidgetConfig["theme"]>, default: undefined },
  accent: str,
  radius: { type: Number, default: undefined },
  branding: bool,
  brandName: str,
  brandLogo: str,
  coinImage: str,
  coinImageTails: str,
  buttonLabel: str,
  locale: str,
  strings: { type: Object as PropType<FlipperWidgetConfig["strings"]>, default: undefined },
  reducedMotion: bool,
  partner: str,
};
const OPTION_KEYS = Object.keys(props) as (keyof FlipperOptions)[];

const EVENTS = ["ready", "connect-request", "flip-requested", "flip-settled", "payout-resolved", "listing", "error", "resize"] as const;

let loading: Promise<unknown> | undefined;
const loadWidget = () => (loading ??= import("@flipperdotfamily/widget").then(() => customElements.whenDefined("flipper-widget")));

/**
 * `<FlipperWidget>`: the drop-in flip UI for Vue 3. Props mirror the widget options; events carry the widget's
 * `detail` payloads.
 *
 * ```vue
 * <FlipperWidget :provider="provider" theme="dark" partner="acme" @connect-request="openModal" @flip-settled="onSettled" />
 * ```
 */
/** Props of the Vue component: every widget option. Handle connect requests with `@connect-request`. */
export type FlipperWidgetVueProps = FlipperOptions;

/** Emitted events: the widget's DOM events, with the `detail` as payload. */
export type FlipperWidgetEmits = {
  ready: (detail: FlipperEventMap["ready"]) => true;
  "connect-request": (detail: FlipperEventMap["connect-request"]) => true;
  "flip-requested": (detail: FlipperEventMap["flip-requested"]) => true;
  "flip-settled": (detail: FlipperEventMap["flip-settled"]) => true;
  "payout-resolved": (detail: FlipperEventMap["payout-resolved"]) => true;
  listing: (detail: FlipperEventMap["listing"]) => true;
  error: (detail: FlipperEventMap["error"]) => true;
  resize: (detail: FlipperEventMap["resize"]) => true;
};

function setup(p: FlipperWidgetVueProps, { emit, expose }: SetupContext<FlipperWidgetEmits>) {
  const el = shallowRef<FlipperWidgetElement>();
  const defined = ref(false);
  const instance = getCurrentInstance();
  // a @connect-request listener means the app opens its own wallet UI: skip the widget's eth_requestAccounts fallback
  const handlesConnect = () => !!instance?.vnode.props?.onConnectRequest;
  const defaults = inject(FLIPPER_DEFAULTS, {});
  const offs: (() => void)[] = [];

  const apply = () => {
    const node = el.value as unknown as Record<string, unknown> | undefined;
    if (!node) return;
    for (const k of OPTION_KEYS) {
      const v = p[k] !== undefined ? p[k] : defaults[k];
      if (v !== undefined && node[k] !== v) node[k] = v;
    }
  };

  onMounted(() => {
    const node = el.value;
    if (!node) return;
    // properties and listeners work before the element is upgraded (Lit adopts pre-set properties)
    for (const name of EVENTS) {
      const fn = (e: Event) => {
        if (name === "connect-request" && handlesConnect()) e.preventDefault();
        (emit as (n: string, d: unknown) => void)(name, (e as CustomEvent).detail);
      };
      node.addEventListener(name, fn);
      offs.push(() => node.removeEventListener(name, fn));
    }
    apply();
    void loadWidget().then(() => (defined.value = true));
  });
  onBeforeUnmount(() => offs.splice(0).forEach((off) => off()));
  watch(() => OPTION_KEYS.map((k) => p[k]), apply);

  expose({
    el,
    open: () => el.value?.open(),
    close: () => el.value?.close(),
    refresh: () => el.value?.refresh(),
  });
  return () => h("flipper-widget", { ref: el, variant: p.variant ?? defaults.variant });
}

/**
 * `<FlipperWidget>`: the drop-in flip UI for Vue 3. Props mirror the widget options; events carry the widget's
 * `detail` payloads.
 *
 * ```vue
 * <FlipperWidget :provider="provider" theme="dark" partner="acme" @connect-request="openModal" @flip-settled="onSettled" />
 * ```
 */
export const FlipperWidget = defineComponent<FlipperWidgetVueProps, FlipperWidgetEmits>(setup, {
  name: "FlipperWidget",
  props: props as never,
  emits: EVENTS as unknown as FlipperWidgetEmits,
});
