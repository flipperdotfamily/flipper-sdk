import 'dart:convert';

import 'chain.dart';

/// Colour mode of the widget.
enum FlipperThemeMode {
  /// Light colours.
  light,

  /// Dark colours.
  dark,

  /// Follows the system (`prefers-color-scheme`). The embed's default.
  auto,
}

/// Whether the user picks the token or it is fixed.
enum FlipperTokenMode {
  /// The user chooses among the listed tokens (the default).
  picker,

  /// One fixed token ([FlipperConfig.token] is required); no picker is
  /// rendered.
  single,
}

/// How the widget sizes itself inside the view.
enum FlipperFit {
  /// The view takes the widget's content height (the default).
  auto,

  /// The widget fills the view's size (a full screen, a fixed tile); the
  /// view's height comes from its constraints instead of the content.
  fill,
}

/// The idle headline under the coin ([FlipperConfig.tagline]; default none).
class FlipperTagline {
  const FlipperTagline._(this.text);

  /// Your own line.
  const FlipperTagline.text(String this.text);

  /// The built-in one: "Double or nothing" and its payout line.
  static const FlipperTagline builtIn = FlipperTagline._(null);

  /// The text, or `null` for [builtIn].
  final String? text;

  /// The embed's `tagline` value: `true` (built-in) or the text.
  Object get wireValue => text ?? true;

  @override
  bool operator ==(Object other) => other is FlipperTagline && other.text == text;

  @override
  int get hashCode => text.hashCode;

  @override
  String toString() => text == null ? 'FlipperTagline.builtIn' : 'FlipperTagline.text($text)';
}

/// Look of the widget: colour [mode], [accent] colour and corner [radius].
///
/// Every field is optional; unset fields keep the embed's defaults. For a
/// full custom palette (the object form of the embed's `theme`), pass it as
/// `FlipperConfig(extra: {'theme': {...}})`; it then overrides [mode].
class FlipperTheme {
  /// Creates a theme.
  const FlipperTheme({this.mode, this.accent, this.radius});

  /// `light`, `dark` or `auto` (the embed defaults to `auto`).
  final FlipperThemeMode? mode;

  /// Accent colour as a CSS hex string, `#` optional (`#7C5CFF`, `4cc2ff`).
  /// Used for the call to action, focus rings and links; text on it is picked
  /// for contrast. See [accentFromArgb] to convert a Flutter colour.
  final String? accent;

  /// Card corner radius in px (the embed accepts 0 to 40, default 24).
  final int? radius;

  /// Formats a 32-bit ARGB colour value as `#rrggbb` (alpha is ignored).
  ///
  /// ```dart
  /// FlipperTheme(accent: FlipperTheme.accentFromArgb(Colors.teal.toARGB32()))
  /// ```
  static String accentFromArgb(int argb) =>
      '#${(argb & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}';

  /// Returns a copy with the given fields replaced.
  FlipperTheme copyWith({FlipperThemeMode? mode, String? accent, int? radius}) {
    return FlipperTheme(
      mode: mode ?? this.mode,
      accent: accent ?? this.accent,
      radius: radius ?? this.radius,
    );
  }

  /// URL query parameters for the set fields (`theme`, `accent`, `radius`).
  Map<String, String> toQuery() {
    final m = mode;
    final a = accent;
    final r = radius;
    return <String, String>{
      if (m != null) 'theme': m.name,
      if (a != null) 'accent': a,
      if (r != null) 'radius': '$r',
    };
  }

  /// Fields of a live `config` message (embed `FlipperEmbedConfig` names).
  Map<String, Object?> toConfigMessage() {
    final m = mode;
    final a = accent;
    final r = radius;
    return <String, Object?>{
      if (m != null) 'theme': m.name,
      if (a != null) 'accent': a,
      if (r != null) 'radius': r,
    };
  }

  @override
  bool operator ==(Object other) =>
      other is FlipperTheme &&
      other.mode == mode &&
      other.accent == accent &&
      other.radius == radius;

  @override
  int get hashCode => Object.hash(mode, accent, radius);

  @override
  String toString() =>
      'FlipperTheme(mode: ${mode?.name}, accent: $accent, radius: $radius)';
}

/// What the widget shows and how it is branded.
///
/// Changing [chain] or [partner] reloads the embed (they are part of its
/// URL). Every other change is sent to the running embed as one live `config`
/// message.
class FlipperConfig {
  /// Creates a config.
  const FlipperConfig({
    this.chain = kFlipperDefaultChainId,
    this.token,
    this.tokens,
    this.partner,
    this.locale,
    this.compact,
    this.hidePicker,
    this.branding,
    this.extra,
    this.mode,
    this.fit,
    this.details,
    this.tagline,
  }) : assert(chain > 0, 'chain must be a positive chain id');

  /// Chain to flip on: 4663 (Robinhood Chain, default) or 31337 (local fork).
  /// Always sent.
  final int chain;

  /// Token address selected at start (default: $FLIPPER).
  final String? token;

  /// Token allowlist for the picker.
  final List<String>? tokens;

  /// [FlipperTokenMode.picker] (default) or [FlipperTokenMode.single]: one
  /// fixed token (set [token]; the embed shows a configuration error without
  /// it), with no picker.
  final FlipperTokenMode? mode;

  /// [FlipperFit.fill]: the widget fills the view (give it a height through
  /// its constraints); `autoHeight` is then ignored.
  final FlipperFit? fit;

  /// Show the win chance / payout / fee line under the button. Default off:
  /// the widget only flags odds that fees trim below the usual
  /// ("↓ Odds 0.9 pts below usual").
  final bool? details;

  /// A headline under the coin while idle: [FlipperTagline.builtIn] or
  /// [FlipperTagline.text]. Default none.
  final FlipperTagline? tagline;

  /// Partner attribution id (`[A-Za-z0-9._:-]{1,64}`), echoed in every event
  /// and sent to the flipper API.
  final String? partner;

  /// BCP 47 locale of the built-in strings (`en`, `es`). Unknown locales fall
  /// back to English.
  final String? locale;

  /// Compact layout: a small inline coin and denser spacing
  /// (`variant: "compact"`; `false` means `variant: "card"`).
  final bool? compact;

  /// Deprecated: use `mode: FlipperTokenMode.single`. Hides the token picker;
  /// the token is fixed to [token] (or $FLIPPER).
  final bool? hidePicker;

  /// `false` removes flipper.family marks (footer link, dolphin coin faces).
  final bool? branding;

  /// Any other embed config field, spread at the top level of the config
  /// (and sent base64-encoded as the `config` URL parameter, which wins over
  /// the individual parameters). Known keys: `brandName`, `brandLogo`,
  /// `coinImage`, `coinImageTails` (`data:` image URIs: the embed loads no
  /// other image hosts), `strings` (string table overrides), `minAmount`,
  /// `maxAmount` (decimal token units),
  /// `approval` (`max` | `exact`), `listing` (bool), `rpcUrl`, `apiUrl`,
  /// `addresses`, and `theme` as an object for custom theme tokens. Values
  /// must be JSON-compatible. `rpcUrl`, `apiUrl` and `addresses` never go in
  /// the URL (see [kFlipperHostOnlyConfigKeys]): the bridge sends them in a
  /// `config` message after every `ready`.
  final Map<String, Object?>? extra;

  /// The host-only fields of [extra] (see [kFlipperHostOnlyConfigKeys]),
  /// without null values; empty when none are set.
  Map<String, Object?> get hostOnlyConfig {
    final e = extra;
    if (e == null) return const <String, Object?>{};
    return <String, Object?>{
      for (final entry in e.entries)
        if (kFlipperHostOnlyConfigKeys.contains(entry.key) &&
            entry.value != null)
          entry.key: entry.value,
    };
  }

  /// Returns a copy with the given fields replaced.
  FlipperConfig copyWith({
    int? chain,
    String? token,
    List<String>? tokens,
    String? partner,
    String? locale,
    bool? compact,
    bool? hidePicker,
    bool? branding,
    Map<String, Object?>? extra,
    FlipperTokenMode? mode,
    FlipperFit? fit,
    bool? details,
    FlipperTagline? tagline,
  }) {
    return FlipperConfig(
      chain: chain ?? this.chain,
      token: token ?? this.token,
      tokens: tokens ?? this.tokens,
      partner: partner ?? this.partner,
      locale: locale ?? this.locale,
      compact: compact ?? this.compact,
      hidePicker: hidePicker ?? this.hidePicker,
      branding: branding ?? this.branding,
      extra: extra ?? this.extra,
      mode: mode ?? this.mode,
      fit: fit ?? this.fit,
      details: details ?? this.details,
      tagline: tagline ?? this.tagline,
    );
  }

  /// [extra], less the host-only keys ([kFlipperHostOnlyConfigKeys]), as
  /// standard base64 (RFC 4648, padded, not URL-safe) of its UTF-8 JSON, or
  /// `null` when nothing is left.
  String? get encodedExtra {
    final e = extra;
    if (e == null) return null;
    final inUrl = <String, Object?>{
      for (final entry in e.entries)
        if (!kFlipperHostOnlyConfigKeys.contains(entry.key))
          entry.key: entry.value,
    };
    if (inUrl.isEmpty) return null;
    return base64.encode(utf8.encode(jsonEncode(inUrl)));
  }

  /// URL query parameters: `chain` (always), then `token`, `branding`,
  /// `partner`, `locale`, `compact`, `mode`, `hidePicker`, `fit`, `details`,
  /// `tagline`, `tokens` and `config` for the fields that are set.
  Map<String, String> toQuery() {
    final m = mode;
    final f = fit;
    final d = details;
    final tl = tagline;
    final t = token;
    final b = branding;
    final p = partner;
    final l = locale;
    final c = compact;
    final h = hidePicker;
    final list = tokens;
    final encoded = encodedExtra;
    return <String, String>{
      'chain': '$chain',
      if (t != null) 'token': t,
      if (b != null) 'branding': b ? '1' : '0',
      if (p != null) 'partner': p,
      if (l != null) 'locale': l,
      if (c != null) 'compact': c ? '1' : '0',
      if (m != null) 'mode': m.name,
      if (h != null) 'hidePicker': h ? '1' : '0',
      if (f != null) 'fit': f.name,
      if (d != null) 'details': d ? '1' : '0',
      if (tl != null) 'tagline': tl.text ?? '1',
      if (list != null && list.isNotEmpty) 'tokens': list.join(','),
      if (encoded != null) 'config': encoded,
    };
  }

  /// Fields of a live `config` message, using the embed's
  /// `FlipperEmbedConfig` names: `chainId`, `token`, `tokens`, `hidePicker`,
  /// `variant`, `branding`, `locale`, `partner`, then [extra]'s keys.
  Map<String, Object?> toConfigMessage() {
    final m = mode;
    final f = fit;
    final d = details;
    final tl = tagline;
    final t = token;
    final list = tokens;
    final h = hidePicker;
    final c = compact;
    final b = branding;
    final l = locale;
    final p = partner;
    final e = extra;
    return <String, Object?>{
      'chainId': chain,
      if (t != null) 'token': t,
      if (list != null) 'tokens': List<String>.of(list),
      if (m != null) 'mode': m.name,
      if (h != null) 'hidePicker': h,
      if (f != null) 'fit': f.name,
      if (d != null) 'details': d,
      if (tl != null) 'tagline': tl.wireValue,
      if (c != null) 'variant': c ? 'compact' : 'card',
      if (b != null) 'branding': b,
      if (l != null) 'locale': l,
      if (p != null) 'partner': p,
      if (e != null) ...e,
    };
  }

  @override
  bool operator ==(Object other) =>
      other is FlipperConfig &&
      other.chain == chain &&
      other.token == token &&
      flipperJsonEquals(other.tokens, tokens) &&
      other.partner == partner &&
      other.locale == locale &&
      other.compact == compact &&
      other.hidePicker == hidePicker &&
      other.branding == branding &&
      other.mode == mode &&
      other.fit == fit &&
      other.details == details &&
      other.tagline == tagline &&
      flipperJsonEquals(other.extra, extra);

  @override
  int get hashCode => Object.hash(
        chain,
        token,
        _jsonHash(tokens),
        partner,
        locale,
        compact,
        hidePicker,
        branding,
        _jsonHash(extra),
        mode,
        fit,
        details,
        tagline,
      );

  @override
  String toString() => 'FlipperConfig(chain: $chain, token: $token, '
      'tokens: $tokens, partner: $partner, locale: $locale, '
      'compact: $compact, hidePicker: $hidePicker, branding: $branding, '
      'mode: $mode, fit: $fit, details: $details, tagline: $tagline, '
      'extra: $extra)';
}

/// The full live-config view of [config] and [theme]: theme fields first,
/// then config fields, then `extra` (so `extra` wins on a key clash).
Map<String, Object?> flipperConfigMessage(
  FlipperConfig config,
  FlipperTheme theme,
) {
  return <String, Object?>{
    ...theme.toConfigMessage(),
    ...config.toConfigMessage(),
  };
}

/// `FlipperEmbedConfig` fields the embed never takes from its URL, since
/// anyone can craft a URL: they decide where funds, approvals and reads go.
/// They're left out of the `config` URL parameter, and the bridge sends them
/// in a `config` message after every `ready` (`FlipperBridge.hostConfig`).
const Set<String> kFlipperHostOnlyConfigKeys = <String>{
  'rpcUrl',
  'apiUrl',
  'addresses',
};

/// Keys whose change reloads the embed instead of being sent live.
const Set<String> kFlipperReloadConfigKeys = <String>{'chainId', 'partner'};

/// The fields that changed between two configurations, as the body of one
/// live `config` message (empty when nothing changed).
///
/// Changed and added keys carry their new value; keys that were removed
/// (set before, unset now) are sent as `null`, meaning "back to the
/// default". `chainId` and `partner` are left out: changing them needs a
/// reload, which the widget does itself.
Map<String, Object?> flipperConfigDiff({
  required FlipperConfig oldConfig,
  required FlipperTheme oldTheme,
  required FlipperConfig newConfig,
  required FlipperTheme newTheme,
}) {
  final before = flipperConfigMessage(oldConfig, oldTheme);
  final after = flipperConfigMessage(newConfig, newTheme);
  final diff = <String, Object?>{};
  after.forEach((String key, Object? value) {
    if (kFlipperReloadConfigKeys.contains(key)) return;
    if (!before.containsKey(key) || !flipperJsonEquals(before[key], value)) {
      diff[key] = value;
    }
  });
  for (final key in before.keys) {
    if (kFlipperReloadConfigKeys.contains(key)) continue;
    if (!after.containsKey(key)) diff[key] = null;
  }
  return diff;
}

/// Deep equality for JSON-like values (maps, lists and scalars).
bool flipperJsonEquals(Object? a, Object? b) {
  if (identical(a, b)) return true;
  if (a is List && b is List) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (!flipperJsonEquals(a[i], b[i])) return false;
    }
    return true;
  }
  if (a is Map && b is Map) {
    if (a.length != b.length) return false;
    for (final key in a.keys) {
      if (!b.containsKey(key)) return false;
      if (!flipperJsonEquals(a[key], b[key])) return false;
    }
    return true;
  }
  return a == b;
}

int _jsonHash(Object? value) {
  if (value is List) return Object.hashAll(value.map<int>(_jsonHash));
  if (value is Map) {
    // Order-independent, like flipperJsonEquals.
    return Object.hashAllUnordered(
      value.entries.map<int>(
        (MapEntry<dynamic, dynamic> e) =>
            Object.hash(e.key, _jsonHash(e.value)),
      ),
    );
  }
  return value.hashCode;
}
