import 'dart:convert';

import 'package:flipper_family/flipper_family.dart';
import 'package:flutter_test/flutter_test.dart';

Matcher throwsConfig() => throwsA(isA<FlipperConfigException>());

void main() {
  group('token mode and fit', () {
    test('go in the URL query and the live config', () {
      const config = FlipperConfig(
        token: 'ETH',
        mode: FlipperTokenMode.single,
        fit: FlipperFit.fill,
      );
      final q = config.toQuery();
      expect(q['mode'], 'single');
      expect(q['fit'], 'fill');
      expect(q['token'], 'ETH');
      final m = config.toConfigMessage();
      expect(m['mode'], 'single');
      expect(m['fit'], 'fill');
      expect(config.copyWith(mode: FlipperTokenMode.picker).mode, FlipperTokenMode.picker);
      expect(config == config.copyWith(), isTrue);
    });
  });

  group('details and tagline', () {
    test('pass through to the URL query and the live config', () {
      const config = FlipperConfig(
        details: true,
        tagline: FlipperTagline.text('Double or nothing on Acme'),
      );
      final q = config.toQuery();
      expect(q['details'], '1');
      expect(q['tagline'], 'Double or nothing on Acme');
      final m = config.toConfigMessage();
      expect(m['details'], true);
      expect(m['tagline'], 'Double or nothing on Acme');
      const builtIn = FlipperConfig(tagline: FlipperTagline.builtIn);
      expect(builtIn.toQuery()['tagline'], '1');
      expect(builtIn.toConfigMessage()['tagline'], true);
      expect(const FlipperConfig().toQuery().containsKey('details'), isFalse);
      expect(config == config.copyWith(), isTrue);
    });
  });

  group('base URL validation', () {
    test('https is accepted', () {
      expect(
        parseFlipperBaseUrl('https://flipper.family/embed').toString(),
        'https://flipper.family/embed',
      );
      expect(
        () => parseFlipperBaseUrl('https://partner.example:8443/flip/embed'),
        returnsNormally,
      );
    });

    test('http only for debug hosts, and only when allowed', () {
      for (final url in <String>[
        'http://localhost:3000/embed',
        'http://127.0.0.1:3000/embed',
        'http://10.0.2.2:3000/embed',
        'http://[::1]:3000/embed',
        'http://LOCALHOST:3000/embed',
      ]) {
        expect(
          () => parseFlipperBaseUrl(url, allowInsecureLocalhost: true),
          returnsNormally,
          reason: url,
        );
        expect(
          () => parseFlipperBaseUrl(url),
          throwsConfig(),
          reason: '$url without allowInsecureLocalhost',
        );
      }
      for (final url in <String>[
        'http://flipper.family/embed',
        'http://192.168.1.20:3000/embed',
        'http://localhost.evil.example/embed',
        'http://10.0.2.20:3000/embed',
      ]) {
        expect(
          () => parseFlipperBaseUrl(url, allowInsecureLocalhost: true),
          throwsConfig(),
          reason: url,
        );
      }
    });

    test('credentials and other schemes are rejected', () {
      for (final url in <String>[
        'https://user:pass@flipper.family/embed',
        'https://user@flipper.family/embed',
        'http://user:pass@localhost:3000/embed',
        'ftp://flipper.family/embed',
        'javascript:alert(1)',
        'file:///etc/passwd',
        'data:text/html,hi',
        'intent://flipper.family/embed#Intent;scheme=https;end',
        'flipper.family/embed',
        '//flipper.family/embed',
        'https://',
        '',
        'not a url',
      ]) {
        expect(
          () => parseFlipperBaseUrl(url, allowInsecureLocalhost: true),
          throwsConfig(),
          reason: url,
        );
      }
    });

    test('buildEmbedUri validates too', () {
      expect(
        () => buildEmbedUri(baseUrl: 'http://flipper.family/embed'),
        throwsConfig(),
      );
      expect(
        () => buildEmbedUri(baseUrl: 'http://localhost:3000/embed'),
        throwsConfig(),
      );
      expect(
        buildEmbedUri(
          baseUrl: 'http://localhost:3000/embed',
          allowInsecureLocalhost: true,
          config: const FlipperConfig(chain: kFlipperLocalChainId),
        ).toString(),
        'http://localhost:3000/embed?chain=31337',
      );
    });
  });

  group('buildEmbedUri', () {
    test('defaults: only the chain is sent', () {
      expect(
        buildEmbedUri().toString(),
        'https://flipper.family/embed?chain=4663',
      );
    });

    test('all parameters, in the canonical order', () {
      final uri = buildEmbedUri(
        config: const FlipperConfig(
          chain: 31337,
          token: '0x1111111111111111111111111111111111111111',
          tokens: <String>[
            '0x1111111111111111111111111111111111111111',
            '0x2222222222222222222222222222222222222222',
          ],
          partner: 'acme',
          locale: 'es',
          compact: true,
          hidePicker: false,
          branding: false,
          extra: <String, Object?>{'brandName': 'Acme'},
        ),
        theme: const FlipperTheme(
          mode: FlipperThemeMode.dark,
          accent: '#7C5CFF',
          radius: 16,
        ),
      );
      expect(uri.queryParametersAll.keys.toList(), kFlipperUrlParamOrder);
      expect(uri.queryParameters, <String, String>{
        'chain': '31337',
        'token': '0x1111111111111111111111111111111111111111',
        'theme': 'dark',
        'accent': '#7C5CFF',
        'radius': '16',
        'branding': '0',
        'partner': 'acme',
        'locale': 'es',
        'compact': '1',
        'hidePicker': '0',
        'tokens': '0x1111111111111111111111111111111111111111,'
            '0x2222222222222222222222222222222222222222',
        'config': 'eyJicmFuZE5hbWUiOiJBY21lIn0=',
      });
      // The accent's "#" must be percent-encoded, not start a fragment.
      expect(uri.fragment, isEmpty);
      expect(uri.query, contains('accent=%237C5CFF'));
    });

    test('unset fields are omitted; booleans are 1/0', () {
      final uri = buildEmbedUri(
        config: const FlipperConfig(hidePicker: true, tokens: <String>[]),
        theme: const FlipperTheme(mode: FlipperThemeMode.auto),
      );
      expect(uri.queryParameters, <String, String>{
        'chain': '4663',
        'theme': 'auto',
        'hidePicker': '1',
      });
    });

    test('keeps parameters already on the base URL', () {
      final uri = buildEmbedUri(
        baseUrl: 'https://partner.example/embed?utm=app&chain=1#top',
        config: const FlipperConfig(partner: 'p'),
      );
      expect(uri.queryParameters['utm'], 'app');
      expect(uri.queryParameters['chain'], '4663');
      expect(uri.queryParameters['partner'], 'p');
      expect(uri.fragment, 'top');
      expect(uri.path, '/embed');
    });

    test('config is standard, padded base64 of the UTF-8 JSON', () {
      const extra = <String, Object?>{'brandName': '>>>'};
      final uri = buildEmbedUri(
        config: const FlipperConfig(extra: extra),
      );
      final encoded = uri.queryParameters['config']!;
      expect(encoded, 'eyJicmFuZE5hbWUiOiI+Pj4ifQ==');
      // "+" and "=" survive as percent-escapes, not as a space.
      expect(uri.query, contains('config=eyJicmFuZE5hbWUiOiI%2BPj4ifQ%3D%3D'));
      expect(jsonDecode(utf8.decode(base64.decode(encoded))), extra);

      const slash = FlipperConfig(extra: <String, Object?>{'brandName': '???'});
      expect(slash.encodedExtra, 'eyJicmFuZE5hbWUiOiI/Pz8ifQ==');

      const unicode = FlipperConfig(
        extra: <String, Object?>{
          'brandName': 'Café',
          'minAmount': '10',
          'strings': <String, Object?>{'cta': 'Flip!'},
        },
      );
      final decoded = jsonDecode(
        utf8.decode(base64.decode(unicode.encodedExtra!)),
      );
      expect(decoded, unicode.extra);
    });

    test('rpcUrl, apiUrl and addresses stay out of the URL', () {
      const network = <String, Object?>{
        'rpcUrl': 'https://rpc.example',
        'apiUrl': 'https://api.example',
        'addresses': <String, Object?>{'house': '0x01', 'lens': '0x02'},
      };
      const config = FlipperConfig(
        extra: <String, Object?>{'brandName': 'Acme', ...network},
      );
      final uri = buildEmbedUri(config: config);
      expect(
        jsonDecode(utf8.decode(base64.decode(uri.queryParameters['config']!))),
        <String, Object?>{'brandName': 'Acme'},
      );
      expect(config.hostOnlyConfig, network);

      const onlyNetwork = FlipperConfig(
        extra: <String, Object?>{
          'rpcUrl': 'https://rpc.example',
          'apiUrl': null,
        },
      );
      final bare = buildEmbedUri(config: onlyNetwork);
      expect(bare.queryParameters.containsKey('config'), isFalse);
      expect(onlyNetwork.hostOnlyConfig,
          <String, Object?>{'rpcUrl': 'https://rpc.example'});
      expect(const FlipperConfig().hostOnlyConfig, isEmpty);
      // still sent live when they change
      expect(
        flipperConfigDiff(
          oldConfig: const FlipperConfig(),
          oldTheme: const FlipperTheme(),
          newConfig: onlyNetwork,
          newTheme: const FlipperTheme(),
        )['rpcUrl'],
        'https://rpc.example',
      );
    });

    test('an empty extra map sends no config parameter', () {
      final uri = buildEmbedUri(
        config: const FlipperConfig(extra: <String, Object?>{}),
      );
      expect(uri.queryParameters.containsKey('config'), isFalse);
    });

    test('non-JSON extra values throw', () {
      expect(
        () => buildEmbedUri(
          config: FlipperConfig(extra: <String, Object?>{'x': Object()}),
        ),
        throwsA(isA<JsonUnsupportedObjectError>()),
      );
    });
  });

  group('origins', () {
    test('scheme://host[:port], lowercase, default ports omitted', () {
      expect(
        flipperOriginOf(Uri.parse('https://Flipper.Family:443/embed?x=1')),
        'https://flipper.family',
      );
      expect(
        flipperOriginOf(Uri.parse('http://localhost:3000/embed')),
        'http://localhost:3000',
      );
      expect(
        flipperOriginOf(Uri.parse('http://localhost:80/embed')),
        'http://localhost',
      );
      expect(
        flipperOriginOf(Uri.parse('https://flipper.family:8443/')),
        'https://flipper.family:8443',
      );
      expect(
        flipperOriginOf(Uri.parse('http://[::1]:3000/embed')),
        'http://[::1]:3000',
      );
      expect(flipperOriginOf(Uri.parse('about:blank')), isNull);
      expect(flipperOriginOf(Uri.parse('file:///tmp/x')), isNull);
      expect(flipperOriginOfUrl(null), isNull);
      expect(flipperOriginOfUrl(''), isNull);
      expect(
        flipperOriginOfUrl('https://flipper.family/embed#x'),
        'https://flipper.family',
      );
    });
  });

  group('navigation policy', () {
    const origin = 'https://flipper.family';
    FlipperNavigationDecision top(String url, {String path = '/embed'}) =>
        decideFlipperNavigation(
          url: url,
          isMainFrame: true,
          embedOrigin: origin,
          embedPath: path,
        );
    FlipperNavigationDecision sub(String url) => decideFlipperNavigation(
          url: url,
          isMainFrame: false,
          embedOrigin: origin,
          embedPath: '/embed',
        );

    test('main frame', () {
      expect(top('https://flipper.family/embed?chain=4663'),
          FlipperNavigationDecision.allow);
      expect(top('https://flipper.family/embed/'),
          FlipperNavigationDecision.allow);
      expect(top('https://flipper.family/embed/sub#x'),
          FlipperNavigationDecision.allow);
      expect(top('https://flipper.family/'),
          FlipperNavigationDecision.openExternally);
      expect(top('https://flipper.family/embedded'),
          FlipperNavigationDecision.openExternally);
      expect(top('https://flipper.family/docs', path: ''),
          FlipperNavigationDecision.allow);
      expect(top('http://flipper.family/embed'),
          FlipperNavigationDecision.openExternally);
      expect(top('https://robinhoodchain.blockscout.com/tx/0xabc'),
          FlipperNavigationDecision.openExternally);
      expect(top('mailto:hello@flipper.family'),
          FlipperNavigationDecision.openExternally);
      expect(top('tel:+15555550100'),
          FlipperNavigationDecision.openExternally);
      for (final url in <String>[
        'javascript:alert(1)',
        'file:///etc/passwd',
        'data:text/html,hi',
        'content://com.android.contacts/contacts',
        'intent://scan/#Intent;scheme=zxing;end',
        'wc:abc@2?relay-protocol=irn',
        'metamask://dapp/flipper.family',
        'about:blank',
      ]) {
        expect(top(url), FlipperNavigationDecision.block, reason: url);
      }
    });

    test('sub-frames', () {
      expect(sub('about:blank'), FlipperNavigationDecision.allow);
      expect(sub('about:srcdoc'), FlipperNavigationDecision.allow);
      expect(sub('https://flipper.family/anything'),
          FlipperNavigationDecision.allow);
      expect(sub('https://ads.example/frame'), FlipperNavigationDecision.block);
      expect(sub('mailto:x@y.z'), FlipperNavigationDecision.block);
      expect(sub('javascript:alert(1)'), FlipperNavigationDecision.block);
    });

    test('embed path of a base URL', () {
      expect(flipperEmbedPathOf(Uri.parse('https://flipper.family/embed/')),
          '/embed');
      expect(flipperEmbedPathOf(Uri.parse('https://flipper.family')), '');
      expect(flipperEmbedPathOf(Uri.parse('https://flipper.family/')), '');
    });
  });

  group('config and theme', () {
    test('config messages use the embed field names', () {
      const config = FlipperConfig(
        chain: 31337,
        token: '0xT',
        tokens: <String>['0xA'],
        partner: 'acme',
        locale: 'en',
        compact: true,
        hidePicker: true,
        branding: false,
        extra: <String, Object?>{'brandName': 'Acme', 'approval': 'exact'},
      );
      expect(config.toConfigMessage(), <String, Object?>{
        'chainId': 31337,
        'token': '0xT',
        'tokens': <String>['0xA'],
        'hidePicker': true,
        'variant': 'compact',
        'branding': false,
        'locale': 'en',
        'partner': 'acme',
        'brandName': 'Acme',
        'approval': 'exact',
      });
      expect(
        const FlipperConfig(compact: false).toConfigMessage()['variant'],
        'card',
      );
      expect(
        const FlipperTheme(
          mode: FlipperThemeMode.light,
          accent: '#ff5a1f',
          radius: 8,
        ).toConfigMessage(),
        <String, Object?>{'theme': 'light', 'accent': '#ff5a1f', 'radius': 8},
      );
    });

    test('diff sends changed fields only, null for removed ones', () {
      const base = FlipperConfig(partner: 'acme', locale: 'en');
      const theme = FlipperTheme(mode: FlipperThemeMode.dark, accent: '#111111');
      expect(
        flipperConfigDiff(
          oldConfig: base,
          oldTheme: theme,
          newConfig: base,
          newTheme: theme,
        ),
        isEmpty,
      );
      expect(
        flipperConfigDiff(
          oldConfig: base,
          oldTheme: theme,
          newConfig: base.copyWith(compact: true, locale: 'es'),
          newTheme: const FlipperTheme(mode: FlipperThemeMode.light),
        ),
        <String, Object?>{
          'theme': 'light',
          'accent': null,
          'variant': 'compact',
          'locale': 'es',
        },
      );
      // chain and partner changes reload instead.
      expect(
        flipperConfigDiff(
          oldConfig: base,
          oldTheme: theme,
          newConfig: base.copyWith(chain: 31337, partner: 'other'),
          newTheme: theme,
        ),
        isEmpty,
      );
      expect(
        flipperConfigDiff(
          oldConfig: const FlipperConfig(
            extra: <String, Object?>{'brandName': 'A', 'minAmount': '1'},
          ),
          oldTheme: theme,
          newConfig: const FlipperConfig(
            extra: <String, Object?>{'brandName': 'B'},
          ),
          newTheme: theme,
        ),
        <String, Object?>{'brandName': 'B', 'minAmount': null},
      );
    });

    test('value equality, including lists and maps', () {
      expect(
        FlipperConfig(
          tokens: <String>['0xA', '0xB'],
          extra: <String, Object?>{
            'strings': <String, Object?>{'cta': 'Go'},
          },
        ),
        FlipperConfig(
          tokens: <String>['0xA', '0xB'],
          extra: <String, Object?>{
            'strings': <String, Object?>{'cta': 'Go'},
          },
        ),
      );
      expect(
        FlipperConfig(tokens: <String>['0xA']).hashCode,
        FlipperConfig(tokens: <String>['0xA']).hashCode,
      );
      expect(
        const FlipperConfig(tokens: <String>['0xA']),
        isNot(const FlipperConfig(tokens: <String>['0xB'])),
      );
      expect(
        const FlipperTheme(mode: FlipperThemeMode.dark),
        const FlipperTheme(mode: FlipperThemeMode.dark),
      );
    });

    test('accentFromArgb', () {
      expect(FlipperTheme.accentFromArgb(0xFF7C5CFF), '#7c5cff');
      expect(FlipperTheme.accentFromArgb(0x80000001), '#000001');
    });
  });
}
