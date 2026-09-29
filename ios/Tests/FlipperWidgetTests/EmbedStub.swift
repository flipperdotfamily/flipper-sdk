// Generated from packages/react-native/test/fixtures/embed-stub.js (the shared embed stub). Keep in sync.
enum EmbedStub {
    static let script = #"""
// Stub of the embed page's side of the bridge (packages/widget/BRIDGE.md, protocol v1), for host SDK tests.
// Plain ES5 so it runs in Node's vm, WKWebView, Android WebView and react-native-webview alike.
(function () {
  var received = [];
  var pending = {};
  var listeners = [];
  var nextId = 1;

  function send(message) {
    var json = JSON.stringify(message);
    // transport order per BRIDGE.md section 2, re-checked on every send
    if (window.FlipperHost && typeof window.FlipperHost.postMessage === "function") return window.FlipperHost.postMessage(json);
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.FlipperHost)
      return window.webkit.messageHandlers.FlipperHost.postMessage(json);
    if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === "function")
      return window.ReactNativeWebView.postMessage(json);
  }

  function handle(raw) {
    var m;
    try {
      m = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (e) {
      return;
    }
    if (!m || m.v !== 1 || m.source !== "flipper-host") return;
    received.push(m);
    if ((m.type === "rpc-result" || m.type === "rpc-error") && pending[m.id]) {
      var p = pending[m.id];
      delete pending[m.id];
      if (m.type === "rpc-result") p.resolve(m.result);
      else p.reject(m.error);
    }
    for (var i = 0; i < listeners.length; i++) listeners[i](m);
  }

  window.FlipperBridge = { version: 1, receive: handle };
  if (window.addEventListener)
    window.addEventListener("message", function (e) {
      if (e.source && e.source !== window) return;
      handle(e.data);
    });

  window.__flipperStub = {
    received: received,
    rpc: function (method, params) {
      var id = "f" + nextId++;
      return new Promise(function (resolve, reject) {
        pending[id] = { resolve: resolve, reject: reject };
        send({ v: 1, source: "flipper", type: "rpc", id: id, method: method, params: params || [] });
      });
    },
    emit: function (name, data) {
      send({ v: 1, source: "flipper", type: "event", name: name, data: data });
    },
    raw: function (message) {
      send(message);
    },
    onMessage: function (fn) {
      listeners.push(fn);
    },
    lastOf: function (type) {
      for (var i = received.length - 1; i >= 0; i--) if (received[i].type === type) return received[i];
      return null;
    },
  };

  setTimeout(function () {
    window.__flipperStub.emit("ready", { version: "0.0.0-stub", chainId: 4663, account: null, token: null, variant: "card", partner: null });
    window.__flipperStub.emit("resize", { width: 360, height: 488.4 });
  }, 0);
})();
"""#

    static let html = "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"></head><body><a id=\"ext\" href=\"https://robinhoodchain.blockscout.com/tx/0x1\">explorer</a><script>" + script + "</script></body></html>"
}
