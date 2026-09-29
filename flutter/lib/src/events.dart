import 'chain.dart';

/// An event the embed page reported (`{type: "event", name, data}`).
///
/// Payloads follow the embed bridge protocol v1 (packages/widget/BRIDGE.md,
/// section 5). Parsing is lenient: every typed field is optional, and the
/// untouched `data` object is always available as [raw], so fields added by
/// later widget versions are never lost.
///
/// ```dart
/// onEvent: (event) {
///   switch (event) {
///     case FlipperFlipSettledEvent(:final outcome, :final flipId):
///       analytics.log('flip $flipId: $outcome');
///     case FlipperUnknownEvent(:final name):
///       debugPrint('new event type: $name');
///     default:
///       break;
///   }
/// },
/// ```
sealed class FlipperEvent {
  const FlipperEvent(this.raw);

  /// Parses the `data` of an event called [name] into its typed class, or a
  /// [FlipperUnknownEvent] for names this SDK version doesn't know.
  factory FlipperEvent.parse(String name, Object? data) {
    switch (name) {
      case FlipperReadyEvent.eventName:
        return FlipperReadyEvent.fromData(data);
      case FlipperConnectRequestEvent.eventName:
        return FlipperConnectRequestEvent.fromData(data);
      case FlipperFlipRequestedEvent.eventName:
        return FlipperFlipRequestedEvent.fromData(data);
      case FlipperFlipSettledEvent.eventName:
        return FlipperFlipSettledEvent.fromData(data);
      case FlipperPayoutResolvedEvent.eventName:
        return FlipperPayoutResolvedEvent.fromData(data);
      case FlipperListingEvent.eventName:
        return FlipperListingEvent.fromData(data);
      case FlipperErrorEvent.eventName:
        return FlipperErrorEvent.fromData(data);
      case FlipperResizeEvent.eventName:
        return FlipperResizeEvent.fromData(data);
      default:
        return FlipperUnknownEvent(name, data);
    }
  }

  /// The event name on the wire (`ready`, `flip-settled`, ...).
  String get name;

  /// The event's `data` exactly as decoded from JSON (usually a
  /// `Map<String, dynamic>`), or `null`.
  final Object? raw;

  @override
  String toString() => '$runtimeType($name, $raw)';
}

/// `ready`: the embed has mounted and listens for host messages. The widget
/// sends the wallet state right after it.
final class FlipperReadyEvent extends FlipperEvent {
  /// Creates the event.
  const FlipperReadyEvent({
    this.version,
    this.chainId,
    this.account,
    this.token,
    this.variant,
    this.partner,
    Object? raw,
  }) : super(raw);

  /// Parses the event's `data`.
  factory FlipperReadyEvent.fromData(Object? data) {
    final d = _fields(data);
    return FlipperReadyEvent(
      version: _string(d['version']),
      chainId: normalizeChainId(d['chainId']),
      account: _string(d['account']),
      token: _string(d['token']),
      variant: _string(d['variant']),
      partner: _string(d['partner']),
      raw: data,
    );
  }

  /// Wire name.
  static const String eventName = 'ready';

  @override
  String get name => eventName;

  /// The widget's semver.
  final String? version;

  /// The chain the embed runs on.
  final int? chainId;

  /// Connected account known to the embed, `null` without a wallet.
  final String? account;

  /// Selected token address.
  final String? token;

  /// Layout variant: `card` or `compact`.
  final String? variant;

  /// Partner attribution id.
  final String? partner;
}

/// `connect-request`: the user tapped Connect (or tried to flip / list while
/// disconnected). Open your wallet's connect flow; the widget pushes the new
/// wallet state automatically once your [FlipperWallet] emits.
final class FlipperConnectRequestEvent extends FlipperEvent {
  /// Creates the event.
  const FlipperConnectRequestEvent({this.reason, this.partner, Object? raw})
      : super(raw);

  /// Parses the event's `data`.
  factory FlipperConnectRequestEvent.fromData(Object? data) {
    final d = _fields(data);
    return FlipperConnectRequestEvent(
      reason: _string(d['reason']),
      partner: _string(d['partner']),
      raw: data,
    );
  }

  /// Wire name.
  static const String eventName = 'connect-request';

  @override
  String get name => eventName;

  /// `connect`, `flip` or `list`. `null` when the request came from an
  /// `eth_requestAccounts` RPC while no wallet was connected.
  final String? reason;

  /// Partner attribution id.
  final String? partner;
}

/// `flip-requested`: the flip transaction is mined and randomness has been
/// requested. The coin spins until `flip-settled`.
final class FlipperFlipRequestedEvent extends FlipperEvent {
  /// Creates the event.
  const FlipperFlipRequestedEvent({
    this.flipId,
    this.account,
    this.token,
    this.symbol,
    this.decimals,
    this.amount,
    this.winChanceBps,
    this.randomnessFee,
    this.txHash,
    this.approveTxHash,
    this.native,
    this.partner,
    Object? raw,
  }) : super(raw);

  /// Parses the event's `data`.
  factory FlipperFlipRequestedEvent.fromData(Object? data) {
    final d = _fields(data);
    return FlipperFlipRequestedEvent(
      flipId: _string(d['flipId']),
      account: _string(d['account']),
      token: _string(d['token']),
      symbol: _string(d['symbol']),
      decimals: _int(d['decimals']),
      amount: _string(d['amount']),
      winChanceBps: _int(d['winChanceBps']),
      randomnessFee: _string(d['randomnessFee']),
      txHash: _string(d['txHash']),
      approveTxHash: _string(d['approveTxHash']),
      native: _bool(d['native']),
      partner: _string(d['partner']),
      raw: data,
    );
  }

  /// Wire name.
  static const String eventName = 'flip-requested';

  @override
  String get name => eventName;

  /// Flip id (decimal string).
  final String? flipId;

  /// Player address.
  final String? account;

  /// Flipped token address.
  final String? token;

  /// Token symbol.
  final String? symbol;

  /// Token decimals.
  final int? decimals;

  /// Stake in the token's smallest unit (decimal string).
  final String? amount;

  /// Win chance in basis points (4500 = 45%).
  final int? winChanceBps;

  /// Randomness fee paid, in wei (decimal string).
  final String? randomnessFee;

  /// The flip transaction hash.
  final String? txHash;

  /// The approval transaction hash, `null` when no approval was needed.
  final String? approveTxHash;

  /// The stake was native ETH, wrapped to WETH: [token] is WETH and [symbol]
  /// is `ETH`.
  final bool? native;

  /// Partner attribution id.
  final String? partner;
}

/// `flip-settled`: the coin landed. A `WinPending` flip ([pending] true) has
/// its winnings still owed, and the widget offers Retry payout. It gets a
/// second `flip-settled` with the same [flipId] when the winnings are paid
/// (alongside a [FlipperPayoutResolvedEvent]); de-duplicate by [flipId], the
/// last one is final.
final class FlipperFlipSettledEvent extends FlipperEvent {
  /// Creates the event.
  const FlipperFlipSettledEvent({
    this.flipId,
    this.account,
    this.token,
    this.symbol,
    this.decimals,
    this.amount,
    this.outcome,
    this.status,
    this.won,
    this.pending,
    this.payout,
    this.payoutToken,
    this.flipperPaid,
    this.txHash,
    this.requestTxHash,
    this.native,
    this.partner,
    Object? raw,
  }) : super(raw);

  /// Parses the event's `data`.
  factory FlipperFlipSettledEvent.fromData(Object? data) {
    final d = _fields(data);
    return FlipperFlipSettledEvent(
      flipId: _string(d['flipId']),
      account: _string(d['account']),
      token: _string(d['token']),
      symbol: _string(d['symbol']),
      decimals: _int(d['decimals']),
      amount: _string(d['amount']),
      outcome: _string(d['outcome']),
      status: _string(d['status']),
      won: _bool(d['won']),
      pending: _bool(d['pending']),
      payout: _string(d['payout']),
      payoutToken: _string(d['payoutToken']),
      flipperPaid: _string(d['flipperPaid']),
      txHash: _string(d['txHash']),
      requestTxHash: _string(d['requestTxHash']),
      native: _bool(d['native']),
      partner: _string(d['partner']),
      raw: data,
    );
  }

  /// Wire name.
  static const String eventName = 'flip-settled';

  @override
  String get name => eventName;

  /// Flip id (decimal string).
  final String? flipId;

  /// Player address.
  final String? account;

  /// Flipped token address.
  final String? token;

  /// Token symbol.
  final String? symbol;

  /// Token decimals.
  final int? decimals;

  /// Stake in the token's smallest unit (decimal string).
  final String? amount;

  /// `won`, `lost` or `refunded`.
  final String? outcome;

  /// `Won`, `WonFallback`, `WinPending`, `Lost`, `LostInventory` or
  /// `Refunded`.
  final String? status;

  /// Whether the player won.
  final bool? won;

  /// True for `WinPending`: stake returned, winnings on the way.
  final bool? pending;

  /// What the player received in [payoutToken], stake included (`"0"` on a
  /// loss).
  final String? payout;

  /// Token the payout was made in.
  final String? payoutToken;

  /// $FLIPPER paid on top of [payout] (decimal string).
  final String? flipperPaid;

  /// Settlement transaction hash (`null` if it couldn't be looked up).
  final String? txHash;

  /// The flip (request) transaction hash.
  final String? requestTxHash;

  /// The stake was native ETH, wrapped to WETH: [token] is WETH and [symbol]
  /// is `ETH`.
  final bool? native;

  /// Partner attribution id.
  final String? partner;
}

/// `payout-resolved`: a pending win's winnings were paid. Sent once per flip,
/// alongside the final `flip-settled`.
final class FlipperPayoutResolvedEvent extends FlipperEvent {
  /// Creates the event.
  const FlipperPayoutResolvedEvent({
    this.flipId,
    this.account,
    this.token,
    this.symbol,
    this.decimals,
    this.tokenPaid,
    this.flipperPaid,
    this.by,
    this.native,
    this.txHash,
    this.partner,
    Object? raw,
  }) : super(raw);

  /// Parses the event's `data`.
  factory FlipperPayoutResolvedEvent.fromData(Object? data) {
    final d = _fields(data);
    return FlipperPayoutResolvedEvent(
      flipId: _string(d['flipId']),
      account: _string(d['account']),
      token: _string(d['token']),
      symbol: _string(d['symbol']),
      decimals: _int(d['decimals']),
      tokenPaid: _string(d['tokenPaid']),
      flipperPaid: _string(d['flipperPaid']),
      by: _string(d['by']),
      native: _bool(d['native']),
      txHash: _string(d['txHash']),
      partner: _string(d['partner']),
      raw: data,
    );
  }

  /// Wire name.
  static const String eventName = 'payout-resolved';

  @override
  String get name => eventName;

  /// Flip id (decimal string).
  final String? flipId;

  /// Player address.
  final String? account;

  /// Flipped token address: WETH when [native] is true.
  final String? token;

  /// Token symbol (`ETH` when [native] is true).
  final String? symbol;

  /// Token decimals.
  final int? decimals;

  /// Winnings paid in [token], in its smallest unit (decimal string). The
  /// stake already came back at settlement.
  final String? tokenPaid;

  /// $FLIPPER paid instead (decimal string): `"0"` unless the token still
  /// couldn't be bought after the pending timeout.
  final String? flipperPaid;

  /// `self`: this widget's Retry payout paid it; `other`: someone else did
  /// (usually flipper's payout worker).
  final String? by;

  /// The stake was native ETH: [token] is WETH (the winnings are paid in
  /// WETH) and [symbol] is `ETH`. False, with `WETH`, for a pending win the
  /// widget only learned about from an earlier session.
  final bool? native;

  /// The `PendingWinResolved` transaction hash (`null` if it couldn't be
  /// looked up).
  final String? txHash;

  /// Partner attribution id.
  final String? partner;
}

/// `listing`: progress of a permissionless token listing.
final class FlipperListingEvent extends FlipperEvent {
  /// Creates the event.
  const FlipperListingEvent({
    this.stage,
    this.token,
    this.symbol,
    this.txHash,
    this.error,
    this.partner,
    Object? raw,
  }) : super(raw);

  /// Parses the event's `data`.
  factory FlipperListingEvent.fromData(Object? data) {
    final d = _fields(data);
    return FlipperListingEvent(
      stage: _string(d['stage']),
      token: _string(d['token']),
      symbol: _string(d['symbol']),
      txHash: _string(d['txHash']),
      error: _string(d['error']),
      partner: _string(d['partner']),
      raw: data,
    );
  }

  /// Wire name.
  static const String eventName = 'listing';

  @override
  String get name => eventName;

  /// `started`, `submitted`, `listed` or `failed`.
  final String? stage;

  /// Token address.
  final String? token;

  /// Token symbol.
  final String? symbol;

  /// Listing transaction hash.
  final String? txHash;

  /// Error message when [stage] is `failed`.
  final String? error;

  /// Partner attribution id.
  final String? partner;
}

/// `error`: something went wrong in the embed, or (with [code] `config`) the
/// host SDK rejected its own configuration, such as an invalid base URL.
final class FlipperErrorEvent extends FlipperEvent {
  /// Creates the event.
  const FlipperErrorEvent({
    this.code,
    this.message,
    this.context,
    this.partner,
    Object? raw,
  }) : super(raw);

  /// Parses the event's `data`.
  factory FlipperErrorEvent.fromData(Object? data) {
    final d = _fields(data);
    return FlipperErrorEvent(
      code: _string(d['code']),
      message: _string(d['message']),
      context: _string(d['context']),
      partner: _string(d['partner']),
      raw: data,
    );
  }

  /// A host-side configuration error (`code: "config"`,
  /// `context: "config"`). The widget never loads a URL that fails
  /// validation.
  factory FlipperErrorEvent.config(String message, {String? partner}) {
    return FlipperErrorEvent(
      code: 'config',
      message: message,
      context: 'config',
      partner: partner,
      raw: <String, Object?>{
        'code': 'config',
        'message': message,
        'context': 'config',
        'partner': partner,
      },
    );
  }

  /// Wire name.
  static const String eventName = 'error';

  @override
  String get name => eventName;

  /// `user-rejected`, `rejected`, `insufficient-funds`, `revert`, `timeout`,
  /// `config`, `network`, `wallet` or `unknown`.
  final String? code;

  /// Plain-English message, safe to show to users.
  final String? message;

  /// `config`, `wallet`, `preview`, `flip` or `listing`.
  final String? context;

  /// Partner attribution id.
  final String? partner;
}

/// `resize`: the widget's border box changed size (CSS px).
final class FlipperResizeEvent extends FlipperEvent {
  /// Creates the event.
  const FlipperResizeEvent({this.width, this.height, Object? raw})
      : super(raw);

  /// Parses the event's `data`. Only finite numbers are accepted.
  factory FlipperResizeEvent.fromData(Object? data) {
    final d = _fields(data);
    return FlipperResizeEvent(
      width: _finite(d['width']),
      height: _finite(d['height']),
      raw: data,
    );
  }

  /// Wire name.
  static const String eventName = 'resize';

  @override
  String get name => eventName;

  /// Width in CSS px.
  final double? width;

  /// Height in CSS px.
  final double? height;
}

/// An event name this SDK version doesn't know. Forwarded to `onEvent` only.
final class FlipperUnknownEvent extends FlipperEvent {
  /// Creates the event.
  const FlipperUnknownEvent(this.name, Object? raw) : super(raw);

  @override
  final String name;
}

Map<String, Object?> _fields(Object? data) {
  if (data is Map) {
    return data.map<String, Object?>(
      (Object? key, Object? value) => MapEntry<String, Object?>('$key', value),
    );
  }
  return const <String, Object?>{};
}

String? _string(Object? value) {
  if (value is String) return value;
  if (value is int) return value.toString();
  if (value is double) {
    if (!value.isFinite) return null;
    if (value == value.truncateToDouble() && value.abs() <= 9007199254740991) {
      return value.toInt().toString();
    }
    return value.toString();
  }
  if (value is bool) return value.toString();
  return null;
}

int? _int(Object? value) {
  if (value is int) return value;
  if (value is double && value.isFinite && value == value.truncateToDouble()) {
    return value.toInt();
  }
  if (value is String) return int.tryParse(value.trim());
  return null;
}

bool? _bool(Object? value) {
  if (value is bool) return value;
  if (value is num) return value != 0;
  if (value is String) {
    switch (value.trim().toLowerCase()) {
      case 'true':
      case '1':
        return true;
      case 'false':
      case '0':
        return false;
    }
  }
  return null;
}

double? _finite(Object? value) {
  if (value is num && value.isFinite) return value.toDouble();
  return null;
}
