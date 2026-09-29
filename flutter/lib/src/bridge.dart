import 'dart:async';
import 'dart:convert';

import 'chain.dart';
import 'events.dart';
import 'wallet.dart';

/// Version of this SDK.
const String kFlipperSdkVersion = '0.1.0';

/// Version of the embed bridge protocol this SDK speaks.
const int kFlipperBridgeVersion = 1;

/// The wallet methods the embed may call (exact, case-sensitive). Hosts can
/// narrow this list with `allowedMethods`, never widen it. No message signing
/// (`personal_sign`, `eth_signTypedData_*`): the embed never signs messages,
/// so a compromised embed can't ask for a Permit signature.
const Set<String> kFlipperRpcMethods = <String>{
  'eth_accounts',
  'eth_requestAccounts',
  'eth_chainId',
  'eth_sendTransaction',
  'wallet_switchEthereumChain',
  'wallet_addEthereumChain',
  'wallet_watchAsset',
};

/// Optional EIP-5792 methods the embed uses for one-confirmation native-ETH
/// flips (wrap + approve + flip as one atomic batch). Forwarded only when the
/// host opts in with `enableBatchCalls`; otherwise they're answered with 4200
/// and the embed falls back to sequential transactions.
const Set<String> kFlipperBatchCallMethods = <String>{
  'wallet_getCapabilities',
  'wallet_sendCalls',
  'wallet_getCallsStatus',
};

/// Every method the embed can send. Nothing outside this set is ever
/// forwarded.
const Set<String> kFlipperBridgeMethods = <String>{
  ...kFlipperRpcMethods,
  ...kFlipperBatchCallMethods,
};

/// Inbound messages longer than this (in UTF-16 code units) are dropped.
const int kFlipperMaxMessageLength = 524288;

/// Maximum number of host-to-page messages queued before `ready`; the oldest
/// is dropped beyond it.
const int kFlipperMaxQueuedMessages = 100;

/// Evaluates a JavaScript string in the embed page.
typedef FlipperJsEvaluator = void Function(String javaScript);

enum _Kind { rpc, wallet, config }

class _Outbound {
  _Outbound(this.kind, this.body, this.json);

  final _Kind kind;
  final Map<String, Object?> body;
  String json;
}

/// The platform-independent half of the host bridge (protocol v1).
///
/// It has no WebView dependency so it can be unit tested: feed it raw
/// strings from the page with [handleMessage] (plus the page origin), tell it
/// when a new page starts loading with [pageLoadStarted], and it calls
/// [evaluate] with the JavaScript to run in the page and the typed callbacks
/// for events. `FlipperWidget` wires one to a `WebViewController`.
class FlipperBridge {
  /// Creates a bridge for the embed served from [embedOrigin]
  /// (`scheme://host[:port]`).
  FlipperBridge({
    required this.embedOrigin,
    required this.evaluate,
    this.chainId = kFlipperDefaultChainId,
    Set<String>? allowedMethods,
    bool enableBatchCalls = false,
    FlipperWallet? wallet,
    this.minHeight = 120,
    this.maxHeight,
    this.onEvent,
    this.onReady,
    this.onConnectRequest,
    this.onFlipRequested,
    this.onFlipSettled,
    this.onPayoutResolved,
    this.onListing,
    this.onError,
    this.onResize,
    this.onDebugLog,
    this.onCallbackError,
  })  : _requestedMethods = allowedMethods,
        _enableBatchCalls = enableBatchCalls,
        _allowedMethods = narrowFlipperMethods(
          allowedMethods,
          enableBatchCalls: enableBatchCalls,
        ) {
    setWallet(wallet);
  }

  /// Origin of the embed page. Messages from any other origin are dropped.
  String embedOrigin;

  /// Runs JavaScript in the page (fire and forget).
  final FlipperJsEvaluator evaluate;

  /// The configured chain. Answers `eth_chainId` without a wallet and is the
  /// `chainId` of `wallet` messages while the wallet's chain is unknown.
  int chainId;

  /// Lower bound applied to `resize` heights.
  double minHeight;

  /// Upper bound applied to `resize` heights (`null`: none).
  double? maxHeight;

  /// Every event from the page, typed, before the specific callbacks.
  void Function(FlipperEvent event)? onEvent;

  /// `ready`, after the queue was flushed and the wallet state sent.
  void Function(FlipperReadyEvent event)? onReady;

  /// `connect-request`, or an `eth_requestAccounts` RPC while no wallet is
  /// connected (then [FlipperConnectRequestEvent.reason] is null).
  void Function(FlipperConnectRequestEvent event)? onConnectRequest;

  /// `flip-requested`.
  void Function(FlipperFlipRequestedEvent event)? onFlipRequested;

  /// `flip-settled`.
  void Function(FlipperFlipSettledEvent event)? onFlipSettled;

  /// `payout-resolved`.
  void Function(FlipperPayoutResolvedEvent event)? onPayoutResolved;

  /// `listing`.
  void Function(FlipperListingEvent event)? onListing;

  /// `error` events from the page.
  void Function(FlipperErrorEvent event)? onError;

  /// A valid `resize`: [height] is the reported height rounded up and
  /// clamped to [minHeight] / [maxHeight].
  void Function(double height, FlipperResizeEvent event)? onResize;

  /// Diagnostics (dropped messages and such). Never receives secrets.
  void Function(String message)? onDebugLog;

  /// Called when a host callback throws. Defaults to reporting the error to
  /// the current zone.
  void Function(Object error, StackTrace stack)? onCallbackError;

  Set<String>? _requestedMethods;
  bool _enableBatchCalls;
  Set<String> _allowedMethods;
  bool _ready = false;
  bool _disposed = false;
  int _generation = 0;
  Set<String> _inFlight = <String>{};
  final List<_Outbound> _queue = <_Outbound>[];
  String? _lastWalletJson;

  FlipperWallet? _wallet;
  StreamSubscription<List<String>>? _accountsSubscription;
  StreamSubscription<int?>? _chainSubscription;
  bool _walletPushScheduled = false;

  /// The effective RPC allowlist.
  Set<String> get allowedMethods => _allowedMethods;

  /// Narrows the allowlist to the intersection of [kFlipperRpcMethods] (plus
  /// [kFlipperBatchCallMethods] when [enableBatchCalls]) and [methods]
  /// (`null`: all of them).
  set allowedMethods(Set<String>? methods) {
    _requestedMethods = methods;
    _allowedMethods =
        narrowFlipperMethods(methods, enableBatchCalls: _enableBatchCalls);
  }

  /// Whether the optional EIP-5792 methods ([kFlipperBatchCallMethods]) are
  /// forwarded to the wallet. Default false (answered with 4200).
  bool get enableBatchCalls => _enableBatchCalls;

  set enableBatchCalls(bool value) {
    _enableBatchCalls = value;
    _allowedMethods =
        narrowFlipperMethods(_requestedMethods, enableBatchCalls: value);
  }

  /// Config the embed only accepts from its host, never from its URL
  /// (`rpcUrl`, `apiUrl`, `addresses`; see `FlipperConfig.hostOnlyConfig`).
  /// Sent in a `config` message after every `ready`, under any queued live
  /// changes. The widget sets it from its current config.
  ///
  /// Throws a [JsonUnsupportedObjectError] if a value isn't JSON-compatible.
  Map<String, Object?> get hostConfig => _hostConfig;

  set hostConfig(Map<String, Object?> fields) {
    final clean = Map<String, Object?>.of(fields)
      ..remove('v')
      ..remove('source')
      ..remove('type');
    jsonEncode(clean); // validate eagerly, in the caller's stack
    _hostConfig = Map<String, Object?>.unmodifiable(clean);
  }

  Map<String, Object?> _hostConfig = const <String, Object?>{};

  /// Whether the current page sent `ready`.
  bool get isReady => _ready;

  /// Page generation, bumped by [pageLoadStarted].
  int get generation => _generation;

  /// Number of messages waiting for `ready`.
  int get queuedMessageCount => _queue.length;

  /// The wallet in use.
  FlipperWallet? get wallet => _wallet;

  /// Whether [dispose] was called.
  bool get isDisposed => _disposed;

  /// Handles a raw message string the page posted through `FlipperHost`.
  ///
  /// [origin] is the origin of the frame that sent it, or (where the
  /// platform gives no frame information) of the WebView's current URL.
  void handleMessage(
    String raw, {
    required String? origin,
    bool isMainFrame = true,
  }) {
    if (_disposed) return;
    if (!isMainFrame) {
      _log('dropped a message from a sub-frame');
      return;
    }
    if (origin == null || origin != embedOrigin) {
      _log('dropped a message from ${origin ?? 'an unknown origin'}');
      return;
    }
    if (raw.length > kFlipperMaxMessageLength) {
      _log('dropped an oversized message (${raw.length} chars)');
      return;
    }
    Object? decoded;
    try {
      decoded = jsonDecode(raw);
    } on FormatException {
      _log('dropped a message that is not JSON');
      return;
    }
    if (decoded is! Map<String, dynamic>) return;
    final Object? v = decoded['v'];
    if (v is! num || v != 1 || decoded['source'] != 'flipper') return;
    final Object? type = decoded['type'];
    if (type == 'rpc') {
      _handleRpc(decoded);
    } else if (type == 'event') {
      _handleEvent(decoded);
    } else {
      _log('dropped a message of unknown type "$type"');
    }
  }

  /// A new top-level page load started (navigation, reload): the page is no
  /// longer ready, and replies to requests of the previous page are
  /// discarded.
  void pageLoadStarted() {
    _ready = false;
    _generation++;
    _inFlight = <String>{};
    _lastWalletJson = null;
    _queue.removeWhere((_Outbound m) => m.kind == _Kind.rpc);
  }

  /// Switches to another wallet (or none): resubscribes to its streams and
  /// pushes its state.
  void setWallet(FlipperWallet? wallet) {
    if (_disposed) return;
    if (identical(wallet, _wallet)) return;
    _cancelWalletSubscriptions();
    _wallet = wallet;
    if (wallet != null) {
      try {
        _accountsSubscription = wallet.accountsChanges.listen(
          (List<String> _) => _scheduleWalletPush(),
          onError: (Object error) => _log('wallet accounts stream: $error'),
        );
        _chainSubscription = wallet.chainIdChanges.listen(
          (int? _) => _scheduleWalletPush(),
          onError: (Object error) => _log('wallet chain stream: $error'),
        );
      } catch (error) {
        _log('could not subscribe to the wallet streams: $error');
      }
    }
    pushWalletState();
  }

  /// The current `wallet` message body: `{type, accounts, chainId}`.
  Map<String, Object?> walletState() {
    final wallet = _wallet;
    final accounts =
        wallet == null ? const <String>[] : _accountsOf(wallet);
    final walletChain = wallet == null ? null : _chainIdOf(wallet);
    return <String, Object?>{
      'type': 'wallet',
      'accounts': accounts,
      'chainId': chainIdToHex(walletChain ?? chainId),
    };
  }

  /// Sends the wallet state now (queued before `ready`), unless the page
  /// already has exactly this state.
  void pushWalletState() {
    if (_disposed) return;
    final body = walletState();
    final json = _encode(body);
    if (!_ready) {
      _queue.removeWhere((_Outbound m) => m.kind == _Kind.wallet);
      _enqueue(_Outbound(_Kind.wallet, body, json));
      return;
    }
    if (json == _lastWalletJson) return;
    _lastWalletJson = json;
    _deliver(json);
  }

  /// Sends a live `config` message with [fields] (embed `FlipperEmbedConfig`
  /// names). Before `ready`, partial configs merge into one queued message.
  ///
  /// Throws a [JsonUnsupportedObjectError] if a value isn't JSON-compatible.
  void sendConfig(Map<String, Object?> fields) {
    if (_disposed || fields.isEmpty) return;
    final clean = Map<String, Object?>.of(fields)
      ..remove('v')
      ..remove('source')
      ..remove('type');
    if (clean.isEmpty) return;
    jsonEncode(clean); // validate eagerly, in the caller's stack
    if (_ready) {
      _deliver(_encode(<String, Object?>{'type': 'config', ...clean}));
      return;
    }
    for (final queued in _queue) {
      if (queued.kind == _Kind.config) {
        queued.body.addAll(clean);
        queued.json = _encode(queued.body);
        return;
      }
    }
    final body = <String, Object?>{'type': 'config', ...clean};
    _enqueue(_Outbound(_Kind.config, body, _encode(body)));
  }

  /// Stops everything: cancels the wallet subscriptions, drops the queue
  /// and ignores later messages and wallet replies.
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _cancelWalletSubscriptions();
    _queue.clear();
    _inFlight = <String>{};
  }

  /// [height] rounded up and clamped to [minHeight] / [maxHeight].
  double clampHeight(double height) {
    var h = height.ceilToDouble();
    if (h < minHeight) h = minHeight;
    final max = maxHeight;
    if (max != null && h > max) h = max;
    return h;
  }

  // ---------------------------------------------------------------- inbound

  void _handleRpc(Map<String, dynamic> message) {
    final Object? id = message['id'];
    if (id == null || !(id is String || (id is num && id.isFinite))) {
      _log('dropped an rpc without a usable id');
      return;
    }
    final Object? method = message['method'];
    if (method is! String) {
      _replyError(id, const FlipperRpcError(-32600, 'Invalid request'));
      return;
    }
    final Object params = message['params'] as Object? ?? const <Object?>[];
    if (params is! List && params is! Map) {
      _replyError(id, const FlipperRpcError(-32602, 'Invalid params'));
      return;
    }
    final key = _idKey(id);
    if (_inFlight.contains(key)) {
      _replyError(id, const FlipperRpcError(-32600, 'Duplicate request id'));
      return;
    }
    if (!_allowedMethods.contains(method)) {
      _replyError(id, FlipperRpcError(4200, 'Unsupported method: $method'));
      return;
    }
    final wallet = _wallet;
    if (wallet == null || _accountsOf(wallet).isEmpty) {
      _answerWithoutWallet(id, method);
      return;
    }
    _forward(wallet, id, key, method, params);
  }

  void _answerWithoutWallet(Object id, String method) {
    switch (method) {
      case 'eth_accounts':
        _replyResult(id, const <String>[]);
      case 'eth_chainId':
        _replyResult(id, chainIdToHex(chainId));
      case 'eth_requestAccounts':
        final callback = onConnectRequest;
        if (callback != null) {
          _guard(() => callback(const FlipperConnectRequestEvent()));
        }
        _replyError(
          id,
          const FlipperRpcError(
            4100,
            'No wallet connected. The host app was asked to connect one.',
          ),
        );
      default:
        _replyError(id, const FlipperRpcError(4100, 'No wallet connected.'));
    }
  }

  void _forward(
    FlipperWallet wallet,
    Object id,
    String key,
    String method,
    Object params,
  ) {
    final generation = _generation;
    final inFlight = _inFlight;
    inFlight.add(key);
    Future<Object?>.sync(() => wallet.request(method, params)).then<void>(
      (Object? result) {
        inFlight.remove(key);
        if (_disposed || generation != _generation) return;
        _replyResult(id, result);
        if (method == 'wallet_switchEthereumChain' ||
            method == 'wallet_addEthereumChain' ||
            method == 'eth_requestAccounts') {
          pushWalletState();
        }
      },
      onError: (Object error, StackTrace stack) {
        inFlight.remove(key);
        if (_disposed || generation != _generation) return;
        _replyError(id, toFlipperRpcError(error));
      },
    );
  }

  void _handleEvent(Map<String, dynamic> message) {
    final Object? name = message['name'];
    if (name is! String) return;
    final event = FlipperEvent.parse(name, message['data']);
    final generic = onEvent;
    if (generic != null) _guard(() => generic(event));
    switch (event) {
      case final FlipperReadyEvent e:
        _markReady();
        _call1(onReady, e);
      case final FlipperConnectRequestEvent e:
        _call1(onConnectRequest, e);
      case final FlipperFlipRequestedEvent e:
        _call1(onFlipRequested, e);
      case final FlipperFlipSettledEvent e:
        _call1(onFlipSettled, e);
      case final FlipperPayoutResolvedEvent e:
        _call1(onPayoutResolved, e);
      case final FlipperListingEvent e:
        _call1(onListing, e);
      case final FlipperErrorEvent e:
        _call1(onError, e);
      case final FlipperResizeEvent e:
        final height = e.height;
        if (height == null || !height.isFinite || height <= 0) return;
        final clamped = clampHeight(height);
        final resize = onResize;
        if (resize != null) _guard(() => resize(clamped, e));
      case FlipperUnknownEvent():
        break;
    }
  }

  void _markReady() {
    _ready = true;
    final pending = List<_Outbound>.of(_queue);
    _queue.clear();
    if (_hostConfig.isNotEmpty) {
      // No URL carries these: merged under any queued live change, so the
      // newest value wins, in one message.
      final i = pending.indexWhere((_Outbound m) => m.kind == _Kind.config);
      final body = <String, Object?>{
        'type': 'config',
        ..._hostConfig,
        if (i >= 0) ...pending[i].body,
      };
      final message = _Outbound(_Kind.config, body, _encode(body));
      if (i >= 0) {
        pending[i] = message;
      } else {
        pending.insert(0, message);
      }
    }
    for (final message in pending) {
      if (message.kind == _Kind.wallet) continue; // resent below, current
      _deliver(message.json);
    }
    _lastWalletJson = null; // always send the wallet state after ready
    pushWalletState();
  }

  // --------------------------------------------------------------- outbound

  void _replyResult(Object id, Object? result) {
    final body = <String, Object?>{
      'type': 'rpc-result',
      'id': id,
      'result': result,
    };
    final String json;
    try {
      json = _encode(body);
    } on JsonUnsupportedObjectError {
      _replyError(
        id,
        const FlipperRpcError(-32603, 'The wallet returned a non-JSON result'),
      );
      return;
    }
    _post(_Kind.rpc, body, json);
  }

  void _replyError(Object id, FlipperRpcError error) {
    final errorJson = <String, Object?>{
      'code': error.code,
      'message': error.message,
    };
    final data = _jsonSafe(error.data);
    if (data != null) errorJson['data'] = data;
    final body = <String, Object?>{
      'type': 'rpc-error',
      'id': id,
      'error': errorJson,
    };
    _post(_Kind.rpc, body, _encode(body));
  }

  void _post(_Kind kind, Map<String, Object?> body, String json) {
    if (_disposed) return;
    // RPC answers go out at once: the page that asked is alive, and the embed
    // reads eth_accounts / eth_chainId when it mounts, before it says `ready`.
    // Only wallet state and config wait for `ready`.
    if (_ready || kind == _Kind.rpc) {
      _deliver(json);
    } else {
      _enqueue(_Outbound(kind, body, json));
    }
  }

  void _enqueue(_Outbound message) {
    _queue.add(message);
    while (_queue.length > kFlipperMaxQueuedMessages) {
      _queue.removeAt(0);
    }
  }

  void _deliver(String json) {
    try {
      evaluate(buildFlipperDeliveryScript(json));
    } catch (error) {
      _log('could not deliver a message: $error');
    }
  }

  // ---------------------------------------------------------------- helpers

  void _scheduleWalletPush() {
    if (_walletPushScheduled || _disposed) return;
    _walletPushScheduled = true;
    scheduleMicrotask(() {
      _walletPushScheduled = false;
      if (!_disposed) pushWalletState();
    });
  }

  void _cancelWalletSubscriptions() {
    _accountsSubscription?.cancel();
    _chainSubscription?.cancel();
    _accountsSubscription = null;
    _chainSubscription = null;
  }

  List<String> _accountsOf(FlipperWallet wallet) {
    try {
      return List<String>.of(wallet.accounts);
    } catch (error) {
      _log('wallet.accounts threw: $error');
      return const <String>[];
    }
  }

  int? _chainIdOf(FlipperWallet wallet) {
    try {
      return normalizeChainId(wallet.chainId);
    } catch (error) {
      _log('wallet.chainId threw: $error');
      return null;
    }
  }

  void _call1<T>(void Function(T value)? callback, T value) {
    if (callback != null) _guard(() => callback(value));
  }

  void _guard(void Function() callback) {
    try {
      callback();
    } catch (error, stack) {
      final handler = onCallbackError;
      if (handler != null) {
        handler(error, stack);
      } else {
        Zone.current.handleUncaughtError(error, stack);
      }
    }
  }

  void _log(String message) {
    final log = onDebugLog;
    if (log != null) log('[flipper] $message');
  }

  static String _encode(Map<String, Object?> body) => jsonEncode(
        <String, Object?>{
          'v': kFlipperBridgeVersion,
          'source': 'flipper-host',
          ...body,
        },
      );

  static String _idKey(Object id) {
    if (id is String) return 's:$id';
    if (id is double &&
        id == id.truncateToDouble() &&
        id.abs() <= 9007199254740991) {
      return 'n:${id.toInt()}';
    }
    return 'n:$id';
  }
}

/// The effective RPC allowlist for a host's `allowedMethods`:
/// [kFlipperRpcMethods] (plus [kFlipperBatchCallMethods] when
/// [enableBatchCalls]) intersected with [methods] (`null`: all of them).
Set<String> narrowFlipperMethods(
  Set<String>? methods, {
  bool enableBatchCalls = false,
}) {
  final base = enableBatchCalls ? kFlipperBridgeMethods : kFlipperRpcMethods;
  if (methods == null) return base;
  return base.intersection(methods);
}

/// Converts anything a wallet threw into the error sent to the page.
///
/// - [FlipperRpcError]: code, message and data unchanged.
/// - a `Map` with `code` / `message` / `data` entries (EIP-1193 style);
/// - any object with an integer `code` and a `String message` property
///   (for example reown's `JsonRpcError` or `ReownSignError`);
/// - otherwise -32603 "Internal error".
///
/// `data` is kept only when it is JSON-serializable.
FlipperRpcError toFlipperRpcError(Object error) {
  if (error is FlipperRpcError) {
    return FlipperRpcError(
      error.code,
      error.message.isEmpty ? 'Internal error' : error.message,
      _jsonSafe(error.data),
    );
  }
  Object? code;
  Object? message;
  Object? data;
  if (error is Map) {
    code = error['code'];
    message = error['message'];
    data = error['data'];
  } else {
    final dynamic dyn = error;
    try {
      code = dyn.code;
    } catch (_) {}
    try {
      message = dyn.message;
    } catch (_) {}
    try {
      data = dyn.data;
    } catch (_) {}
  }
  final int? intCode;
  if (code is int) {
    intCode = code;
  } else if (code is double && code.isFinite && code == code.truncateToDouble()) {
    intCode = code.toInt();
  } else {
    intCode = null;
  }
  final text = message is String && message.isNotEmpty ? message : null;
  return FlipperRpcError(
    intCode ?? -32603,
    text ?? 'Internal error',
    _jsonSafe(data),
  );
}

Object? _jsonSafe(Object? value) {
  if (value == null) return null;
  try {
    jsonEncode(value);
    return value;
  } catch (_) {
    return null;
  }
}

/// Prefix of every script produced by [buildFlipperDeliveryScript].
const String kFlipperDeliveryPrefix =
    '(function(m){try{if(window.FlipperBridge&&typeof window.FlipperBridge'
    '.receive==="function"){window.FlipperBridge.receive(m);}else{window'
    '.postMessage(JSON.parse(m),window.location.origin);}}catch(e){}})(';

/// Suffix of every script produced by [buildFlipperDeliveryScript].
const String kFlipperDeliverySuffix = ');true;';

/// The JavaScript that hands the JSON string [json] to the embed:
/// `window.FlipperBridge.receive(json)` when it exists, else a
/// `window.postMessage` of the parsed object to the page's own origin.
String buildFlipperDeliveryScript(String json) =>
    '$kFlipperDeliveryPrefix${encodeJsStringLiteral(json)}'
    '$kFlipperDeliverySuffix';

final String _backslash = String.fromCharCode(0x5C);
final String _lineSeparator = String.fromCharCode(0x2028);
final String _paragraphSeparator = String.fromCharCode(0x2029);

/// Encodes [value] as a JavaScript string literal: a JSON string, with the
/// line and paragraph separators (U+2028, U+2029, legal in JSON but not in
/// older JavaScript string literals) additionally escaped.
String encodeJsStringLiteral(String value) {
  final json = jsonEncode(value);
  if (!json.contains(_lineSeparator) && !json.contains(_paragraphSeparator)) {
    return json;
  }
  return json
      .replaceAll(_lineSeparator, '${_backslash}u2028')
      .replaceAll(_paragraphSeparator, '${_backslash}u2029');
}
