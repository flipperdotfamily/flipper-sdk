import 'package:flipper_family/flipper_family.dart';
import 'package:reown_appkit/reown_appkit.dart';

/// Robinhood Chain (4663), registered with AppKit before creating the
/// `ReownAppKitModal` (so it works whether or not your AppKit version lists
/// Robinhood Chain out of the box):
///
/// ```dart
/// ReownAppKitModalNetworks.addSupportedNetworks('eip155', [robinhoodChain]);
/// ```
///
/// AppKit also sends this entry to wallets that don't know the chain yet
/// (`wallet_addEthereumChain`), so [rpcUrl] must be a public RPC endpoint.
final ReownAppKitModalNetworkInfo robinhoodChain = ReownAppKitModalNetworkInfo(
  name: 'Robinhood Chain',
  chainId: '4663',
  currency: 'ETH',
  rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
  explorerUrl: 'https://robinhoodchain.blockscout.com',
);

/// A [FlipperWallet] backed by Reown AppKit: WalletConnect wallets, plus
/// Coinbase, email and social logins, whatever the modal is configured for.
///
/// Every signing request goes through AppKit, which opens the user's wallet
/// for confirmation. Nothing is approved automatically.
///
/// ```dart
/// final wallet = ReownFlipperWallet(appKitModal); // after appKitModal.init()
/// FlipperWidget(
///   wallet: wallet,
///   onConnectRequest: (_) => wallet.openConnect(),
/// );
/// ```
class ReownFlipperWallet extends FlipperWalletBase {
  /// Wraps an initialized [appKitModal] and mirrors its session.
  ReownFlipperWallet(this.appKitModal) {
    appKitModal.onModalConnect.subscribe(_onConnect);
    appKitModal.onModalUpdate.subscribe(_onConnect);
    appKitModal.onModalNetworkChange.subscribe(_onNetworkChange);
    appKitModal.onModalDisconnect.subscribe(_onDisconnect);
    appKitModal.onSessionExpireEvent.subscribe(_onSessionExpire);
    _sync();
  }

  /// The AppKit modal this wallet talks to.
  final ReownAppKitModal appKitModal;

  static const String _namespace = 'eip155';

  static final RegExp _rejection = RegExp(
    r'\b(rejected|cancelled|canceled|denied|disapproved)\b',
    caseSensitive: false,
  );

  /// Opens AppKit's connect flow (call it from `onConnectRequest`).
  Future<void> openConnect() => appKitModal.openModalView();

  @override
  Future<Object?> request(String method, Object? params) async {
    switch (method) {
      case 'eth_accounts':
      case 'eth_requestAccounts':
        _sync();
        return accounts;
      case 'eth_chainId':
        _sync();
        final id = chainId;
        if (id == null) {
          throw const FlipperRpcError(
            FlipperRpcError.chainDisconnectedCode,
            'The wallet is not connected to an EVM chain.',
          );
        }
        return chainIdToHex(id);
      case 'wallet_switchEthereumChain':
        return _switchChain(params);
    }
    return _forward(method, params);
  }

  /// Stops listening to the modal and closes the streams.
  @override
  void dispose() {
    appKitModal.onModalConnect.unsubscribe(_onConnect);
    appKitModal.onModalUpdate.unsubscribe(_onConnect);
    appKitModal.onModalNetworkChange.unsubscribe(_onNetworkChange);
    appKitModal.onModalDisconnect.unsubscribe(_onDisconnect);
    appKitModal.onSessionExpireEvent.unsubscribe(_onSessionExpire);
    super.dispose();
  }

  // ------------------------------------------------------------ requests

  Future<Object?> _forward(String method, Object? params) async {
    final session = appKitModal.session;
    final chain = _caip2(appKitModal.selectedChain?.chainId) ??
        (chainId == null ? null : '$_namespace:$chainId');
    if (session == null || !appKitModal.isConnected || chain == null) {
      throw const FlipperRpcError.unauthorized();
    }
    final Object? result;
    try {
      // AppKit sends the request over the session and brings the wallet app
      // to the foreground so the user can confirm or reject it.
      result = await appKitModal.request(
        topic: session.topic,
        chainId: chain,
        request: SessionRequestParams(
          method: method,
          params: params ?? const <Object?>[],
        ),
      );
    } catch (error) {
      throw _toRpcError(error);
    }
    // AppKit resolves some failures (ReownSignError) with null after showing
    // them in its own UI. Never report those as a successful signature.
    if (result == null && _returnsValue(method)) {
      throw const FlipperRpcError.internal('The wallet returned no result.');
    }
    return result;
  }

  Future<Object?> _switchChain(Object? params) async {
    final target = _requestedChainId(params);
    if (target == null) {
      throw const FlipperRpcError(
        FlipperRpcError.invalidParamsCode,
        'Invalid params',
      );
    }
    if (target == chainId) return null;
    final network =
        ReownAppKitModalNetworks.getNetworkInfo(_namespace, '$target');
    if (network == null) {
      // The embed answers 4902 with wallet_addEthereumChain, which is
      // forwarded to the wallet as is.
      throw FlipperRpcError(
        FlipperRpcError.unrecognizedChainCode,
        'Chain $target is not configured in AppKit '
        '(ReownAppKitModalNetworks.addSupportedNetworks).',
      );
    }
    try {
      // Asks the wallet to switch, and to add the chain first if it doesn't
      // know it (using the network entry's rpcUrl).
      await appKitModal.requestSwitchToChain(network);
    } catch (error) {
      throw _toRpcError(error);
    }
    _sync(chainHint: network.chainId);
    return null;
  }

  static bool _returnsValue(String method) =>
      method == 'eth_sendTransaction' ||
      method == 'personal_sign' ||
      method == 'eth_signTypedData_v4';

  static int? _requestedChainId(Object? params) {
    if (params is List && params.isNotEmpty) {
      final first = params.first;
      if (first is Map) return normalizeChainId(first['chainId']);
    }
    return null;
  }

  /// AppKit's chain ids are CAIP-2 (`eip155:4663`) in recent versions and
  /// plain numbers (`4663`) in older ones; request() wants CAIP-2.
  static String? _caip2(String? chainId) {
    final id = normalizeChainId(chainId);
    if (id == null) return null;
    if (chainId != null && chainId.contains(':')) {
      return chainId.startsWith('$_namespace:') ? chainId : null;
    }
    return '$_namespace:$id';
  }

  static FlipperRpcError _toRpcError(Object error) {
    if (error is FlipperRpcError) return error;
    // Reads an integer `code` and a String `message` when the error has them
    // (reown's JsonRpcError, ReownSignError, ...), else -32603.
    final mapped = toFlipperRpcError(error);
    // WalletConnect reports rejections as 5000-5003; EIP-1193 uses 4001.
    if (mapped.code >= 5000 && mapped.code <= 5003) {
      return FlipperRpcError(
        FlipperRpcError.userRejectedCode,
        mapped.message,
        mapped.data,
      );
    }
    if (mapped.code == FlipperRpcError.internalErrorCode &&
        _rejection.hasMatch('$error')) {
      return const FlipperRpcError.userRejected();
    }
    return mapped;
  }

  // -------------------------------------------------------------- state

  void _onConnect(ModalConnect? event) => _sync();

  void _onNetworkChange(ModalNetworkChange? event) =>
      _sync(chainHint: event?.chainId);

  void _onDisconnect(ModalDisconnect? event) =>
      update(accounts: const <String>[], chainId: null);

  void _onSessionExpire(SessionExpire? event) => _sync();

  void _sync({String? chainHint}) {
    if (isDisposed) return;
    final session = appKitModal.session;
    if (!appKitModal.isConnected || session == null) {
      update(accounts: const <String>[], chainId: null);
      return;
    }
    String? address;
    try {
      address = session.getAddress(_namespace);
    } catch (_) {
      address = null;
    }
    update(
      accounts: address == null ? const <String>[] : <String>[address],
      chainId: normalizeChainId(chainHint) ??
          normalizeChainId(appKitModal.selectedChain?.chainId) ??
          _sessionChainId(session),
    );
  }

  static int? _sessionChainId(ReownAppKitModalSession session) {
    try {
      return normalizeChainId(session.chainId);
    } catch (_) {
      return null;
    }
  }
}
