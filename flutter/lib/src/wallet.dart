import 'dart:async';

import 'chain.dart';

/// The wallet the host app lends to the flip widget.
///
/// The embed page has no wallet of its own. Every wallet operation it needs
/// (connecting, sending a transaction, switching chain) arrives as an EIP-1193
/// request and is forwarded to [request]. Your implementation must show the
/// wallet's own confirmation UI for anything that signs or sends. Never
/// auto-approve requests coming from the widget.
///
/// Implementations must keep [accounts] and [chainId] current and emit on
/// [accountsChanges] / [chainIdChanges] whenever they change. The widget reads
/// the synchronous getters when a stream fires, so update the getter values
/// in the same synchronous block as the emission. [FlipperWalletBase] does
/// this for you.
abstract class FlipperWallet {
  /// Performs an EIP-1193 request such as `eth_sendTransaction` and returns
  /// its JSON-compatible result (`String`, `num`, `bool`, `null`, `List` or
  /// `Map` of those).
  ///
  /// [params] is the JSON value the widget sent: in practice always a `List`
  /// (EIP-1193 shape), `[]` for methods without params.
  ///
  /// Throw a [FlipperRpcError] to fail with a specific EIP-1193 code (for
  /// example 4001 when the user rejects, 4902 when
  /// `wallet_switchEthereumChain` targets an unknown chain). Other exceptions
  /// are converted: an integer `code` and a `String message` property are used
  /// when present, else the error becomes -32603 "Internal error".
  ///
  /// There is no timeout: users can take minutes to confirm in a wallet.
  Future<Object?> request(String method, Object? params);

  /// Connected accounts, active account first. Empty when disconnected.
  List<String> get accounts;

  /// The wallet's current chain id, or `null` when unknown.
  int? get chainId;

  /// Emits whenever [accounts] changes. Should be a broadcast stream.
  Stream<List<String>> get accountsChanges;

  /// Emits whenever [chainId] changes. Should be a broadcast stream.
  Stream<int?> get chainIdChanges;
}

/// An EIP-1193 error. Throw it from [FlipperWallet.request]; the widget sends
/// `code`, `message` and `data` to the embed unchanged.
class FlipperRpcError implements Exception {
  /// Creates an error with an EIP-1193 / EIP-1474 [code].
  const FlipperRpcError(this.code, this.message, [this.data]);

  /// The user rejected the request (4001).
  const FlipperRpcError.userRejected([
    String message = 'User rejected the request.',
  ]) : this(userRejectedCode, message);

  /// No account is connected or the method is not authorized (4100).
  const FlipperRpcError.unauthorized([
    String message = 'No wallet connected.',
  ]) : this(unauthorizedCode, message);

  /// The wallet does not support the method (4200).
  const FlipperRpcError.unsupportedMethod([
    String message = 'Unsupported method.',
  ]) : this(unsupportedMethodCode, message);

  /// `wallet_switchEthereumChain` targeted a chain the wallet doesn't know
  /// (4902). The embed then sends `wallet_addEthereumChain`.
  const FlipperRpcError.unrecognizedChain([
    String message = 'Unrecognized chain ID.',
  ]) : this(unrecognizedChainCode, message);

  /// Internal error (-32603).
  const FlipperRpcError.internal([String message = 'Internal error'])
      : this(internalErrorCode, message);

  /// 4001: user rejected the request.
  static const int userRejectedCode = 4001;

  /// 4100: unauthorized / no account connected.
  static const int unauthorizedCode = 4100;

  /// 4200: unsupported method.
  static const int unsupportedMethodCode = 4200;

  /// 4900: the wallet is disconnected from all chains.
  static const int disconnectedCode = 4900;

  /// 4901: the wallet is not connected to the requested chain.
  static const int chainDisconnectedCode = 4901;

  /// 4902: unrecognized chain id.
  static const int unrecognizedChainCode = 4902;

  /// -32600: invalid request.
  static const int invalidRequestCode = -32600;

  /// -32602: invalid params.
  static const int invalidParamsCode = -32602;

  /// -32603: internal error.
  static const int internalErrorCode = -32603;

  /// The EIP-1193 / EIP-1474 error code.
  final int code;

  /// A human-readable message.
  final String message;

  /// Optional JSON-compatible extra data. Dropped if it can't be encoded.
  final Object? data;

  /// The `error` object of an `rpc-error` message.
  Map<String, Object?> toJson() => <String, Object?>{
        'code': code,
        'message': message,
        if (data != null) 'data': data,
      };

  @override
  String toString() => 'FlipperRpcError($code, $message'
      '${data == null ? '' : ', $data'})';
}

class _Unchanged {
  const _Unchanged();
}

const Object _unchanged = _Unchanged();

/// A [FlipperWallet] base class that owns the account and chain state and
/// the broadcast streams. Extend it and implement [request]; call [update]
/// from your wallet SDK's connect / disconnect / account / chain callbacks.
///
/// ```dart
/// class MyWallet extends FlipperWalletBase {
///   MyWallet(this.sdk) {
///     sdk.onChange((s) => update(accounts: s.accounts, chainId: s.chainId));
///   }
///   final MyWalletSdk sdk;
///
///   @override
///   Future<Object?> request(String method, Object? params) =>
///       sdk.request(method, params); // the SDK shows its own confirmation UI
/// }
/// ```
abstract class FlipperWalletBase implements FlipperWallet {
  /// Creates the wallet with an initial state.
  FlipperWalletBase({List<String> accounts = const <String>[], int? chainId})
      : _accounts = List<String>.unmodifiable(accounts),
        _chainId = normalizeChainId(chainId);

  final StreamController<List<String>> _accountsController =
      StreamController<List<String>>.broadcast();
  final StreamController<int?> _chainIdController =
      StreamController<int?>.broadcast();

  List<String> _accounts;
  int? _chainId;
  bool _disposed = false;

  @override
  List<String> get accounts => _accounts;

  @override
  int? get chainId => _chainId;

  /// Whether at least one account is connected.
  bool get isConnected => _accounts.isNotEmpty;

  /// Whether [dispose] has been called.
  bool get isDisposed => _disposed;

  @override
  Stream<List<String>> get accountsChanges => _accountsController.stream;

  @override
  Stream<int?> get chainIdChanges => _chainIdController.stream;

  /// Updates the state and emits on the streams for whatever changed.
  ///
  /// Omit an argument to leave it unchanged. [chainId] accepts anything
  /// [normalizeChainId] does (`4663`, `"0x1237"`, `"eip155:4663"`); pass
  /// `null` (or an invalid id) for "unknown".
  ///
  /// ```dart
  /// update(accounts: ['0xAbC…'], chainId: 4663); // connected
  /// update(chainId: 'eip155:4663');              // chain switched
  /// update(accounts: const [], chainId: null);   // disconnected
  /// ```
  void update({List<String>? accounts, Object? chainId = _unchanged}) {
    if (_disposed) return;
    final nextAccounts = accounts == null
        ? _accounts
        : List<String>.unmodifiable(accounts);
    final nextChainId =
        identical(chainId, _unchanged) ? _chainId : normalizeChainId(chainId);
    final accountsChanged = !_sameList(_accounts, nextAccounts);
    final chainChanged = nextChainId != _chainId;
    _accounts = nextAccounts;
    _chainId = nextChainId;
    if (accountsChanged) _accountsController.add(nextAccounts);
    if (chainChanged) _chainIdController.add(nextChainId);
  }

  /// Closes the streams. The wallet keeps answering [accounts] and [chainId].
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _accountsController.close();
    _chainIdController.close();
  }

  static bool _sameList(List<String> a, List<String> b) {
    if (identical(a, b)) return true;
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }
}

/// Signature of the request handler of a [FlipperCallbackWallet].
typedef FlipperRequestHandler = Future<Object?> Function(
  String method,
  Object? params,
);

/// A [FlipperWalletBase] whose [request] is a callback. Handy for wiring a
/// wallet SDK without writing a class, and for tests.
///
/// ```dart
/// final wallet = FlipperCallbackWallet(
///   onRequest: (method, params) => mySdk.request(method, params),
/// );
/// mySdk.onConnect((address, chain) =>
///     wallet.update(accounts: [address], chainId: chain));
/// ```
class FlipperCallbackWallet extends FlipperWalletBase {
  /// Creates a wallet that forwards every request to [onRequest].
  FlipperCallbackWallet({
    required this.onRequest,
    super.accounts,
    super.chainId,
  });

  /// Called for every request that reaches the wallet.
  final FlipperRequestHandler onRequest;

  @override
  Future<Object?> request(String method, Object? params) =>
      onRequest(method, params);
}
