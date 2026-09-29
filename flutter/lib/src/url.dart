import 'config.dart';

/// The hosted embed.
const String kFlipperEmbedUrl = 'https://flipper.family/embed';

/// The embed served by a local `./dev.sh` (`next dev` on port 3000), as seen
/// from an iOS simulator or a device with `adb reverse tcp:3000 tcp:3000`.
const String kFlipperLocalEmbedUrl = 'http://localhost:3000/embed';

/// The local embed as seen from the Android emulator (10.0.2.2 is the host
/// machine's loopback).
const String kFlipperAndroidEmulatorEmbedUrl = 'http://10.0.2.2:3000/embed';

/// Hosts that may be loaded over plain `http`, and only when insecure
/// localhost is allowed (debug builds by default).
const Set<String> kFlipperDebugHosts = <String>{
  'localhost',
  '127.0.0.1',
  '10.0.2.2',
  '::1',
  '[::1]',
};

/// Canonical order of the embed's URL parameters.
const List<String> kFlipperUrlParamOrder = <String>[
  'chain',
  'token',
  'theme',
  'accent',
  'radius',
  'branding',
  'partner',
  'locale',
  'compact',
  'mode',
  'hidePicker',
  'fit',
  'details',
  'tagline',
  'tokens',
  'config',
];

/// A configuration the SDK refuses to load, such as an `http` base URL in a
/// release build. The widget reports it through `onError` with
/// `code: "config"` and never loads the URL.
class FlipperConfigException implements Exception {
  /// Creates the exception.
  const FlipperConfigException(this.message);

  /// What is wrong.
  final String message;

  @override
  String toString() => 'FlipperConfigException: $message';
}

/// Whether [host] (as returned by [Uri.host]) is one of [kFlipperDebugHosts].
bool isFlipperDebugHost(String host) =>
    kFlipperDebugHosts.contains(host.toLowerCase());

/// Parses and validates an embed base URL.
///
/// Accepts `https` URLs, and `http` URLs whose host is a debug host
/// (localhost, 127.0.0.1, 10.0.2.2, ::1) when [allowInsecureLocalhost] is
/// true. Rejects credentials (`user:pass@`), other schemes and URLs that don't
/// parse, by throwing a [FlipperConfigException].
Uri parseFlipperBaseUrl(
  String baseUrl, {
  bool allowInsecureLocalhost = false,
}) {
  final uri = Uri.tryParse(baseUrl);
  if (uri == null || !uri.hasScheme || !uri.hasAuthority || uri.host.isEmpty) {
    throw FlipperConfigException('Invalid embed URL: "$baseUrl".');
  }
  if (uri.userInfo.isNotEmpty) {
    throw const FlipperConfigException(
      'The embed URL must not contain credentials (user:pass@).',
    );
  }
  final scheme = uri.scheme.toLowerCase();
  if (scheme == 'https') return uri;
  if (scheme == 'http') {
    if (!isFlipperDebugHost(uri.host)) {
      throw FlipperConfigException(
        'Plain http is only allowed for localhost, 127.0.0.1, 10.0.2.2 and '
        '::1 (got "${uri.host}"). Use https.',
      );
    }
    if (!allowInsecureLocalhost) {
      throw const FlipperConfigException(
        'Plain http embed URLs need allowInsecureLocalhost, which defaults to '
        'debug builds only.',
      );
    }
    return uri;
  }
  throw FlipperConfigException(
    'Unsupported embed URL scheme "$scheme". Use https.',
  );
}

/// `scheme://host[:port]` of [uri], lowercase, default ports omitted, IPv6
/// hosts in brackets. `null` unless the scheme is `http` or `https` and the
/// host is non-empty.
String? flipperOriginOf(Uri uri) {
  final scheme = uri.scheme.toLowerCase();
  if (scheme != 'http' && scheme != 'https') return null;
  var host = uri.host.toLowerCase();
  if (host.isEmpty) return null;
  if (host.contains(':') && !host.startsWith('[')) host = '[$host]';
  final port = uri.hasPort ? uri.port : null;
  final isDefaultPort = port == null ||
      (scheme == 'https' && port == 443) ||
      (scheme == 'http' && port == 80);
  return isDefaultPort ? '$scheme://$host' : '$scheme://$host:$port';
}

/// [flipperOriginOf] for a URL string; `null` when it doesn't parse.
String? flipperOriginOfUrl(String? url) {
  if (url == null || url.isEmpty) return null;
  final uri = Uri.tryParse(url);
  return uri == null ? null : flipperOriginOf(uri);
}

/// Builds the embed URL for [config] and [theme] on top of [baseUrl].
///
/// Validates [baseUrl] with [parseFlipperBaseUrl] (throws a
/// [FlipperConfigException]). Query parameters already on [baseUrl] are
/// kept; the SDK's own parameters are appended (or replace a parameter of
/// the same name) in [kFlipperUrlParamOrder] order, and only when set,
/// except `chain`, which is always sent.
Uri buildEmbedUri({
  String baseUrl = kFlipperEmbedUrl,
  FlipperConfig config = const FlipperConfig(),
  FlipperTheme theme = const FlipperTheme(),
  bool allowInsecureLocalhost = false,
}) {
  final base = parseFlipperBaseUrl(
    baseUrl,
    allowInsecureLocalhost: allowInsecureLocalhost,
  );
  final ours = <String, String>{...config.toQuery(), ...theme.toQuery()};
  final params = <String, List<String>>{};
  base.queryParametersAll.forEach((String key, List<String> values) {
    params[key] = List<String>.of(values);
  });
  for (final key in kFlipperUrlParamOrder) {
    final value = ours[key];
    if (value != null) params[key] = <String>[value];
  }
  return base.replace(queryParameters: params);
}

/// What to do with a navigation the WebView is about to perform.
enum FlipperNavigationDecision {
  /// Let the WebView load it.
  allow,

  /// Cancel it and open the URL with the system (browser, mail, phone).
  openExternally,

  /// Cancel it and do nothing.
  block,
}

/// The embed's navigation policy.
///
/// Main frame:
/// - `http(s)` on [embedOrigin] whose path is [embedPath] or below it: allow;
/// - any other `http(s)` URL (including other pages of the embed's own site,
///   such as a "flipper.family" footer link that asked for a new window),
///   `mailto:` and `tel:`: open externally;
/// - anything else (`javascript:`, `file:`, `data:`, `intent:`, custom
///   schemes, `about:`): block.
///
/// Sub-frames: allow `about:blank`, `about:srcdoc` and [embedOrigin]; block
/// the rest (never opened externally).
///
/// The path restriction exists because webview_flutter reports new-window
/// requests (`target="_blank"`, `window.open`) as ordinary main-frame
/// navigations on Android, so a same-origin link meant for a new window
/// would otherwise replace the widget. Pass an empty [embedPath] to allow
/// the whole origin.
FlipperNavigationDecision decideFlipperNavigation({
  required String url,
  required bool isMainFrame,
  required String embedOrigin,
  String embedPath = '',
}) {
  final uri = Uri.tryParse(url);
  if (uri == null) return FlipperNavigationDecision.block;
  final scheme = uri.scheme.toLowerCase();
  final isHttp = scheme == 'http' || scheme == 'https';
  final sameOrigin = isHttp && flipperOriginOf(uri) == embedOrigin;
  if (!isMainFrame) {
    if (scheme == 'about' && (uri.path == 'blank' || uri.path == 'srcdoc')) {
      return FlipperNavigationDecision.allow;
    }
    return sameOrigin
        ? FlipperNavigationDecision.allow
        : FlipperNavigationDecision.block;
  }
  if (isHttp) {
    if (sameOrigin && _isUnderPath(uri.path, embedPath)) {
      return FlipperNavigationDecision.allow;
    }
    return FlipperNavigationDecision.openExternally;
  }
  if (scheme == 'mailto' || scheme == 'tel') {
    return FlipperNavigationDecision.openExternally;
  }
  return FlipperNavigationDecision.block;
}

/// The path prefix [decideFlipperNavigation] keeps inside the WebView for
/// an embed base URL: its path without trailing slashes.
String flipperEmbedPathOf(Uri base) => _trimSlashes(base.path);

bool _isUnderPath(String path, String embedPath) {
  final prefix = _trimSlashes(embedPath);
  if (prefix.isEmpty) return true;
  final p = _trimSlashes(path);
  return p == prefix || p.startsWith('$prefix/');
}

String _trimSlashes(String path) {
  var end = path.length;
  while (end > 0 && path.codeUnitAt(end - 1) == 0x2F) {
    end--;
  }
  return path.substring(0, end);
}
