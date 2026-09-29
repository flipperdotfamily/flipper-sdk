import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

export const STUB_SCRIPT = readFileSync(join(__dirname, "..", "..", "test", "fixtures", "embed-stub.js"), "utf8");

export interface NativeMessageEvent {
  nativeEvent: { data: string; url: string };
}

export interface FakeWebViewOptions {
  url: string;
  /** the page's own script (the embed stub by default) */
  pageScript?: string;
  injectedJavaScriptBeforeContentLoaded?: string;
  injectedJavaScript?: string;
  onMessage: (event: NativeMessageEvent) => void;
  onLoadStart?: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sandbox = Record<string, any>;

/**
 * A react-native-webview stand-in: runs the page and the injected scripts in a Node vm context, delivers
 * `window.ReactNativeWebView.postMessage` asynchronously to `onMessage` (with the page URL, like nativeEvent.url),
 * and evaluates `injectJavaScript` asynchronously, like the real bridge.
 */
export class FakeWebView {
  window!: Sandbox;
  private ctx!: vm.Context;
  readonly injected: string[] = [];

  constructor(private readonly opts: FakeWebViewOptions) {}

  load(url = this.opts.url): this {
    this.opts.onLoadStart?.();
    const origin = /^[a-z]+:\/\/[^/?#]+/i.exec(url)?.[0] ?? "null";
    const listeners: Array<(e: unknown) => void> = [];
    const sandbox: Sandbox = { console, JSON, Promise, Object, Error, setTimeout, clearTimeout };
    sandbox.window = sandbox;
    sandbox.location = { href: url, origin };
    sandbox.addEventListener = (type: string, fn: (e: unknown) => void) => type === "message" && listeners.push(fn);
    sandbox.postMessage = (data: unknown) => setImmediate(() => listeners.forEach((fn) => fn({ data, source: sandbox, origin })));
    sandbox.ReactNativeWebView = {
      postMessage: (data: unknown) => {
        const s = String(data);
        setImmediate(() => this.opts.onMessage({ nativeEvent: { data: s, url } }));
      },
    };
    this.window = sandbox;
    this.ctx = vm.createContext(sandbox);
    if (this.opts.injectedJavaScriptBeforeContentLoaded) vm.runInContext(this.opts.injectedJavaScriptBeforeContentLoaded, this.ctx);
    vm.runInContext(this.opts.pageScript ?? STUB_SCRIPT, this.ctx);
    if (this.opts.injectedJavaScript) vm.runInContext(this.opts.injectedJavaScript, this.ctx);
    return this;
  }

  injectJavaScript(js: string): void {
    this.injected.push(js);
    const ctx = this.ctx;
    setImmediate(() => vm.runInContext(js, ctx));
  }

  /** evaluate in the page right now */
  eval<T = unknown>(js: string): T {
    return vm.runInContext(js, this.ctx) as T;
  }

  get stub(): Sandbox {
    return this.window.__flipperStub;
  }
}

/** Lets queued setImmediate / setTimeout(0) / promise callbacks run. */
export async function flush(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 1));
}
