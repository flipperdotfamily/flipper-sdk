/// Chain id helpers shared by the bridge, the config and wallet adapters.
library;

/// Robinhood Chain, the chain flipper.family launches on.
const int kFlipperDefaultChainId = 4663;

/// Chain id of the local anvil fork started by the repo's `dev.sh`.
const int kFlipperLocalChainId = 31337;

final RegExp _decimal = RegExp(r'^[0-9]+$');
final RegExp _hex = RegExp(r'^[0-9a-fA-F]+$');

/// Normalizes a chain id given in any of the usual shapes to a positive
/// integer, or returns `null` when [value] is not a valid chain id.
///
/// Accepted inputs:
/// - an integer (`4663`), or a double with an integral value (`4663.0`);
/// - a [BigInt] that fits an `int`;
/// - a decimal string (`"4663"`);
/// - a hex string (`"0x1237"`, any case);
/// - a CAIP-2 id (`"eip155:4663"`, also `"eip155:0x1237"`).
///
/// Zero, negative numbers and anything else return `null`.
int? normalizeChainId(Object? value) {
  if (value == null) return null;
  if (value is int) return value > 0 ? value : null;
  if (value is double) {
    if (value.isFinite &&
        value > 0 &&
        value == value.truncateToDouble() &&
        value <= 9007199254740991) {
      return value.toInt();
    }
    return null;
  }
  if (value is BigInt) {
    return value > BigInt.zero && value.isValidInt ? value.toInt() : null;
  }
  if (value is String) {
    var text = value.trim();
    if (text.isEmpty) return null;
    if (text.toLowerCase().startsWith('eip155:')) {
      text = text.substring('eip155:'.length).trim();
    }
    if (text.toLowerCase().startsWith('0x')) {
      return _parse(text.substring(2), 16);
    }
    return _parse(text, 10);
  }
  return null;
}

int? _parse(String digits, int radix) {
  final pattern = radix == 16 ? _hex : _decimal;
  if (!pattern.hasMatch(digits)) return null;
  final parsed = int.tryParse(digits, radix: radix);
  if (parsed == null || parsed <= 0) return null;
  return parsed;
}

/// Formats [chainId] the way EIP-1193 does: `"0x"` followed by lowercase hex
/// without leading zeros (`4663` becomes `"0x1237"`).
String chainIdToHex(int chainId) => '0x${chainId.toRadixString(16)}';
