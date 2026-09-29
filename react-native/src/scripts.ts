import { toJsStringLiteral } from "./encoding";

/**
 * Injected before the page's own scripts (main frame only): defines `window.FlipperHost`, the transport the embed
 * prefers, forwarding JSON strings to React Native's `window.ReactNativeWebView.postMessage`. Idempotent, and
 * re-run after load in case a platform injected it late (the embed re-checks for it on every send).
 */
export const FLIPPER_HOST_SCRIPT = `(function () {
  try {
    if (window.FlipperHost) return;
    var send = function (message) {
      var json = typeof message === "string" ? message : JSON.stringify(message);
      var rn = window.ReactNativeWebView;
      if (rn && typeof rn.postMessage === "function") rn.postMessage(json);
    };
    Object.defineProperty(window, "FlipperHost", {
      value: Object.freeze({ postMessage: send }),
      writable: false,
      configurable: false,
      enumerable: false
    });
  } catch (e) {}
})();
true;`;

/**
 * JavaScript that delivers one host message to the embed: `window.FlipperBridge.receive(json)`, falling back to a
 * same-window `postMessage` (which the embed also accepts) if the bridge isn't defined.
 */
export function buildReceiveScript(message: object): string {
  const literal = toJsStringLiteral(JSON.stringify(message));
  return (
    "(function(m){try{if(window.FlipperBridge&&typeof window.FlipperBridge.receive===\"function\")" +
    "{window.FlipperBridge.receive(m);}else{window.postMessage(JSON.parse(m),window.location.origin);}}catch(e){}})(" +
    literal +
    ");true;"
  );
}
