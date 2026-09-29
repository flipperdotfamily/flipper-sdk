import 'dart:async';
import 'dart:convert';

import 'package:flipper_family/flipper_family.dart';
import 'package:flutter_test/flutter_test.dart';

const String embed = 'https://flipper.family';

/// Decodes a script produced by [buildFlipperDeliveryScript] back to the
/// message object it delivers.
Map<String, dynamic> decodeScript(String js) {
  expect(js.startsWith(kFlipperDeliveryPrefix), isTrue, reason: js);
  expect(js.endsWith(kFlipperDeliverySuffix), isTrue, reason: js);
  final literal = js.substring(
    kFlipperDeliveryPrefix.length,
    js.length - kFlipperDeliverySuffix.length,
  );
  final json = jsonDecode(literal) as String;
  return jsonDecode(json) as Map<String, dynamic>;
}

/// Lets stream events, microtasks and wallet futures run.
Future<void> settle() async {
  for (var i = 0; i < 10; i++) {
    await Future<void>.delayed(Duration.zero);
  }
}

class Harness {
  Harness({
    FlipperWallet? wallet,
    Set<String>? allowedMethods,
    bool enableBatchCalls = false,
    double minHeight = 120,
    double? maxHeight,
    int chainId = 4663,
  }) {
    bridge = FlipperBridge(
      embedOrigin: embed,
      evaluate: scripts.add,
      chainId: chainId,
      wallet: wallet,
      allowedMethods: allowedMethods,
      enableBatchCalls: enableBatchCalls,
      minHeight: minHeight,
      maxHeight: maxHeight,
      onEvent: events.add,
      onReady: (FlipperReadyEvent e) {
        readies.add(e);
        sentAtReady = sent.length;
      },
      onConnectRequest: connectRequests.add,
      onFlipRequested: flipRequests.add,
      onFlipSettled: flipSettles.add,
      onPayoutResolved: payoutsResolved.add,
      onListing: listings.add,
      onError: errors.add,
      onResize: (double height, FlipperResizeEvent e) => heights.add(height),
      onCallbackError: (Object error, StackTrace stack) =>
          callbackErrors.add(error),
    );
  }

  late final FlipperBridge bridge;
  final List<String> scripts = <String>[];
  final List<FlipperEvent> events = <FlipperEvent>[];
  final List<FlipperReadyEvent> readies = <FlipperReadyEvent>[];
  final List<FlipperConnectRequestEvent> connectRequests =
      <FlipperConnectRequestEvent>[];
  final List<FlipperFlipRequestedEvent> flipRequests =
      <FlipperFlipRequestedEvent>[];
  final List<FlipperFlipSettledEvent> flipSettles = <FlipperFlipSettledEvent>[];
  final List<FlipperPayoutResolvedEvent> payoutsResolved =
      <FlipperPayoutResolvedEvent>[];
  final List<FlipperListingEvent> listings = <FlipperListingEvent>[];
  final List<FlipperErrorEvent> errors = <FlipperErrorEvent>[];
  final List<double> heights = <double>[];
  final List<Object> callbackErrors = <Object>[];
  int? sentAtReady;

  List<Map<String, dynamic>> get sent => scripts.map(decodeScript).toList();

  List<Map<String, dynamic>> sentOfType(String type) =>
      sent.where((Map<String, dynamic> m) => m['type'] == type).toList();

  Map<String, dynamic> get last => sent.last;

  void raw(String message, {String? origin = embed, bool mainFrame = true}) {
    bridge.handleMessage(message, origin: origin, isMainFrame: mainFrame);
  }

  void receive(Map<String, Object?> message, {String? origin = embed}) {
    raw(jsonEncode(message), origin: origin);
  }

  void rpc(Object? id, Object? method, {Object? params, bool withParams = true}) {
    receive(<String, Object?>{
      'v': 1,
      'source': 'flipper',
      'type': 'rpc',
      'id': id,
      'method': method,
      if (withParams) 'params': params ?? const <Object?>[],
    });
  }

  void event(String name, [Object? data]) {
    receive(<String, Object?>{
      'v': 1,
      'source': 'flipper',
      'type': 'event',
      'name': name,
      'data': data,
    });
  }

  void ready() => event('ready', <String, Object?>{'version': '0.1.0'});
}

/// A wallet whose requests are answered by the test.
class ManualWallet extends FlipperWalletBase {
  ManualWallet({super.accounts, super.chainId});

  final List<String> methods = <String>[];
  final List<Object?> params = <Object?>[];
  final List<Completer<Object?>> pending = <Completer<Object?>>[];

  @override
  Future<Object?> request(String method, Object? params) {
    methods.add(method);
    this.params.add(params);
    final completer = Completer<Object?>();
    pending.add(completer);
    return completer.future;
  }
}

/// Updates its getters on a chain switch without emitting on the streams.
class SilentWallet implements FlipperWallet {
  @override
  List<String> accounts = <String>[alice];

  @override
  int? chainId = 1;

  @override
  Future<Object?> request(String method, Object? params) async {
    if (method == 'wallet_switchEthereumChain') chainId = 4663;
    return null;
  }

  @override
  Stream<List<String>> get accountsChanges => const Stream<List<String>>.empty();

  @override
  Stream<int?> get chainIdChanges => const Stream<int?>.empty();
}

class CodedError implements Exception {
  CodedError(this.code, this.message, [this.data]);
  final int code;
  final String message;
  final Object? data;
}

const String alice = '0xA11CE00000000000000000000000000000000001';
const String bob = '0xB0B0000000000000000000000000000000000002';

void main() {
  group('inbound filtering', () {
    test('drops messages from other origins, unknown origins and sub-frames',
        () {
      final h = Harness()..ready();
      final before = h.events.length;
      final message = jsonEncode(<String, Object?>{
        'v': 1,
        'source': 'flipper',
        'type': 'event',
        'name': 'connect-request',
        'data': <String, Object?>{},
      });
      h.raw(message, origin: 'https://evil.example');
      h.raw(message, origin: 'http://flipper.family');
      h.raw(message, origin: null);
      h.raw(message, mainFrame: false);
      expect(h.events.length, before);
      h.raw(message);
      expect(h.events.length, before + 1);
    });

    test('requires v === 1 and source "flipper"', () {
      final h = Harness()..ready();
      final before = h.events.length;
      h.raw('{"v":2,"source":"flipper","type":"event","name":"x"}');
      h.raw('{"v":"1","source":"flipper","type":"event","name":"x"}');
      h.raw('{"source":"flipper","type":"event","name":"x"}');
      h.raw('{"v":1,"source":"flipper-host","type":"event","name":"x"}');
      h.raw('{"v":1,"type":"event","name":"x"}');
      h.raw('[1,2,3]');
      h.raw('"a string"');
      h.raw('not json at all');
      h.raw('{"v":1,"source":"flipper","type":"mystery","name":"x"}');
      h.raw('{"v":1,"source":"flipper","type":"event","name":42}');
      expect(h.events.length, before);
      h.raw('{"v":1.0,"source":"flipper","type":"event","name":"x"}');
      expect(h.events.length, before + 1);
      expect(h.events.last, isA<FlipperUnknownEvent>());
    });

    test('drops messages longer than 524288 characters', () {
      final h = Harness()..ready();
      final before = h.events.length;
      const envelope =
          '{"v":1,"source":"flipper","type":"event","name":"x","data":""}';
      final fits = envelope.replaceFirst(
        '"data":""',
        '"data":"${'a' * (kFlipperMaxMessageLength - envelope.length)}"',
      );
      expect(fits.length, kFlipperMaxMessageLength);
      h.raw(fits);
      expect(h.events.length, before + 1);
      final tooLong = envelope.replaceFirst(
        '"data":""',
        '"data":"${'a' * (kFlipperMaxMessageLength - envelope.length + 1)}"',
      );
      h.raw(tooLong);
      expect(h.events.length, before + 1);
    });
  });

  group('rpc without a wallet', () {
    test('eth_accounts answers [] and eth_chainId the configured chain', () {
      final h = Harness()..ready();
      h.rpc('a', 'eth_accounts');
      expect(h.last, <String, Object?>{
        'v': 1,
        'source': 'flipper-host',
        'type': 'rpc-result',
        'id': 'a',
        'result': <Object?>[],
      });
      h.rpc('b', 'eth_chainId');
      expect(h.last['result'], '0x1237');

      final local = Harness(chainId: 31337)..ready();
      local.rpc('c', 'eth_chainId');
      expect(local.last['result'], '0x7a69');
    });

    test('eth_requestAccounts asks the host to connect, then fails with 4100',
        () {
      final h = Harness()..ready();
      h.rpc('r1', 'eth_requestAccounts');
      expect(h.connectRequests, hasLength(1));
      expect(h.connectRequests.single.reason, isNull);
      expect(h.last['type'], 'rpc-error');
      expect(h.last['id'], 'r1');
      expect(h.last['error'], <String, Object?>{
        'code': 4100,
        'message': 'No wallet connected. The host app was asked to connect one.',
      });
    });

    test('other methods fail with 4100', () {
      final h = Harness()..ready();
      h.rpc('t', 'eth_sendTransaction', params: <Object?>[
        <String, Object?>{'to': bob},
      ]);
      expect(h.last['error'], <String, Object?>{
        'code': 4100,
        'message': 'No wallet connected.',
      });
      expect(h.connectRequests, isEmpty);
    });

    test('a wallet without accounts counts as not connected', () async {
      final wallet = ManualWallet(chainId: 1);
      final h = Harness(wallet: wallet)..ready();
      h.rpc('x', 'eth_accounts');
      expect(h.last['result'], <Object?>[]);
      h.rpc('y', 'eth_chainId');
      expect(h.last['result'], '0x1237');
      h.rpc('z', 'eth_sendTransaction', params: <Object?>[
        <String, Object?>{'to': bob},
      ]);
      expect((h.last['error'] as Map<String, dynamic>)['code'], 4100);
      expect(wallet.methods, isEmpty);
    });
  });

  group('rpc validation', () {
    test('allowlist is exact and case-sensitive', () {
      final h = Harness()..ready();
      h.rpc('1', 'eth_sign');
      expect(h.last['error'], <String, Object?>{
        'code': 4200,
        'message': 'Unsupported method: eth_sign',
      });
      h.rpc('2', 'ETH_ACCOUNTS');
      expect((h.last['error'] as Map<String, dynamic>)['code'], 4200);
      h.rpc('3', 'eth_getBalance');
      expect((h.last['error'] as Map<String, dynamic>)['code'], 4200);
    });

    test('message signing is refused like eth_sign, even when listed', () {
      const signing = <String>{
        'eth_sign',
        'personal_sign',
        'eth_signTypedData_v4',
      };
      expect(kFlipperBridgeMethods.intersection(signing), isEmpty);
      final wallet = ManualWallet(accounts: <String>[alice], chainId: 4663);
      final h = Harness(
        wallet: wallet,
        allowedMethods: signing,
        enableBatchCalls: true,
      )..ready();
      expect(h.bridge.allowedMethods, isEmpty);
      for (final m in signing) {
        h.rpc(m, m, params: <Object?>[alice, '0x00']);
        expect(h.last['error'], <String, Object?>{
          'code': 4200,
          'message': 'Unsupported method: $m',
        });
      }
      expect(wallet.methods, isEmpty);
    });

    test('allowedMethods can narrow but never widen the allowlist', () async {
      final wallet = ManualWallet(accounts: <String>[alice], chainId: 4663);
      final h = Harness(
        wallet: wallet,
        allowedMethods: <String>{'eth_sendTransaction', 'eth_sign'},
      )..ready();
      expect(h.bridge.allowedMethods, <String>{'eth_sendTransaction'});
      h.rpc('1', 'eth_sign');
      expect(h.last['error'], <String, Object?>{
        'code': 4200,
        'message': 'Unsupported method: eth_sign',
      });
      h.rpc('2', 'wallet_watchAsset', params: <String, Object?>{
        'type': 'ERC20',
        'options': <String, Object?>{
          'address': '0x0000000000000000000000000000000000000009',
          'symbol': 'FLIPPER',
          'decimals': 18,
        },
      });
      expect((h.last['error'] as Map<String, dynamic>)['code'], 4200);
      h.rpc('3', 'eth_sendTransaction', params: <Object?>[<String, Object?>{}]);
      expect(wallet.methods, <String>['eth_sendTransaction']);

      h.bridge.allowedMethods = null;
      expect(h.bridge.allowedMethods, kFlipperRpcMethods);
      expect(kFlipperRpcMethods, hasLength(7));
    });

    test('EIP-5792 batch methods are answered with 4200 by default', () {
      final wallet = ManualWallet(accounts: <String>[alice], chainId: 4663);
      final h = Harness(wallet: wallet)..ready();
      for (final m in kFlipperBatchCallMethods) {
        h.rpc(m, m, params: <Object?>[<String, Object?>{}]);
        expect(h.last['error'], <String, Object?>{
          'code': 4200,
          'message': 'Unsupported method: $m',
        });
      }
      expect(wallet.methods, isEmpty);
      expect(h.bridge.enableBatchCalls, isFalse);
    });

    test('enableBatchCalls forwards them, and nothing beyond the 10', () async {
      final wallet = ManualWallet(accounts: <String>[alice], chainId: 4663);
      final h = Harness(wallet: wallet, enableBatchCalls: true)..ready();
      expect(kFlipperBridgeMethods, hasLength(10));
      expect(h.bridge.allowedMethods, kFlipperBridgeMethods);
      h.rpc('b', 'wallet_sendCalls', params: <Object?>[<String, Object?>{}]);
      h.rpc('s', 'eth_sign', params: <Object?>[alice, '0x00']);
      expect((h.last['error'] as Map<String, dynamic>)['code'], 4200);
      expect(wallet.methods, <String>['wallet_sendCalls']);
      wallet.pending.single.complete(<String, Object?>{'id': '0xbatch'});
      await settle();
      expect(h.sentOfType('rpc-result').single['result'],
          <String, Object?>{'id': '0xbatch'});
    });

    test('allowedMethods narrows the batch set; no batch without the flag', () {
      expect(
        narrowFlipperMethods(<String>{'eth_sign', 'wallet_sendCalls'},
            enableBatchCalls: true),
        <String>{'wallet_sendCalls'},
      );
      expect(
        narrowFlipperMethods(<String>{'eth_accounts', 'wallet_sendCalls'}),
        <String>{'eth_accounts'},
      );
      final wallet = ManualWallet(accounts: <String>[alice], chainId: 4663);
      final h = Harness(
        wallet: wallet,
        allowedMethods: <String>{'eth_sendTransaction', 'wallet_getCapabilities'},
      )..ready();
      h.rpc('1', 'wallet_getCapabilities', params: <Object?>[alice]);
      expect((h.last['error'] as Map<String, dynamic>)['code'], 4200);
      h.bridge.enableBatchCalls = true;
      expect(h.bridge.allowedMethods,
          <String>{'eth_sendTransaction', 'wallet_getCapabilities'});
      h.rpc('2', 'wallet_sendCalls', params: <Object?>[<String, Object?>{}]);
      expect((h.last['error'] as Map<String, dynamic>)['code'], 4200);
      h.rpc('3', 'wallet_getCapabilities', params: <Object?>[alice]);
      expect(wallet.methods, <String>['wallet_getCapabilities']);
    });

    test('ids: strings and finite numbers are echoed with their JSON type',
        () {
      final h = Harness()..ready();
      h.rpc('f7', 'eth_accounts');
      expect(h.last['id'], 'f7');
      h.rpc(7, 'eth_accounts');
      expect(h.last['id'], 7);
      expect(h.last['id'], isA<int>());
      h.rpc(7.5, 'eth_accounts');
      expect(h.last['id'], 7.5);
      h.rpc('7', 'eth_accounts');
      expect(h.last['id'], '7');
    });

    test('rpc without a usable id is dropped', () {
      final h = Harness()..ready();
      final before = h.scripts.length;
      h.rpc(null, 'eth_accounts');
      h.rpc(true, 'eth_accounts');
      h.rpc(<String, Object?>{}, 'eth_accounts');
      h.rpc(<Object?>[1], 'eth_accounts');
      h.raw('{"v":1,"source":"flipper","type":"rpc","method":"eth_accounts"}');
      expect(h.scripts.length, before);
    });

    test('non-string method is an invalid request', () {
      final h = Harness()..ready();
      h.rpc('m', 42);
      expect(h.last['error'], <String, Object?>{
        'code': -32600,
        'message': 'Invalid request',
      });
    });

    test('params: missing or null become [], scalars are invalid', () async {
      final wallet = ManualWallet(accounts: <String>[alice], chainId: 4663);
      final h = Harness(wallet: wallet)..ready();
      h.rpc('p1', 'eth_accounts', withParams: false);
      h.receive(<String, Object?>{
        'v': 1,
        'source': 'flipper',
        'type': 'rpc',
        'id': 'p2',
        'method': 'eth_accounts',
        'params': null,
      });
      h.receive(<String, Object?>{
        'v': 1,
        'source': 'flipper',
        'type': 'rpc',
        'id': 'p3',
        'method': 'wallet_watchAsset',
        'params': <String, Object?>{'type': 'ERC20'},
      });
      expect(wallet.params, <Object?>[
        <Object?>[],
        <Object?>[],
        <String, Object?>{'type': 'ERC20'},
      ]);
      h.receive(<String, Object?>{
        'v': 1,
        'source': 'flipper',
        'type': 'rpc',
        'id': 'p4',
        'method': 'eth_accounts',
        'params': 'nope',
      });
      expect(h.last['id'], 'p4');
      expect(h.last['error'], <String, Object?>{
        'code': -32602,
        'message': 'Invalid params',
      });
      expect(wallet.methods, hasLength(3));
    });

    test('a second request with an in-flight id fails with -32600', () async {
      final wallet = ManualWallet(accounts: <String>[alice], chainId: 4663);
      final h = Harness(wallet: wallet)..ready();
      h.rpc('dup', 'eth_sendTransaction', params: <Object?>[<String, Object?>{}]);
      h.rpc('dup', 'eth_sendTransaction', params: <Object?>[<String, Object?>{}]);
      expect(wallet.methods, hasLength(1));
      expect(h.last['error'], <String, Object?>{
        'code': -32600,
        'message': 'Duplicate request id',
      });

      // Number 5 and string "5" are different ids; 5 and 5.0 are the same.
      h.rpc(5, 'eth_sendTransaction', params: <Object?>[<String, Object?>{}]);
      h.rpc('5', 'eth_sendTransaction', params: <Object?>[<String, Object?>{}]);
      expect(wallet.methods, hasLength(3));
      h.raw('{"v":1,"source":"flipper","type":"rpc","id":5.0,'
          '"method":"eth_sendTransaction","params":[{}]}');
      expect(wallet.methods, hasLength(3));
      expect((h.last['error'] as Map<String, dynamic>)['code'], -32600);

      wallet.pending.first.complete('0xhash');
      await settle();
      expect(h.last['type'], 'rpc-result');
      expect(h.last['id'], 'dup');
      expect(h.last['result'], '0xhash');

      // Once answered, the id can be used again.
      h.rpc('dup', 'eth_sendTransaction', params: <Object?>[<String, Object?>{}]);
      expect(wallet.methods, hasLength(4));
    });
  });

  group('rpc forwarding', () {
    test('results are forwarded; null stays null', () async {
      final wallet = ManualWallet(accounts: <String>[alice], chainId: 4663);
      final h = Harness(wallet: wallet)..ready();
      h.rpc('tx', 'eth_sendTransaction', params: <Object?>[
        <String, Object?>{'from': alice, 'to': bob, 'value': '0x0'},
      ]);
      expect(wallet.methods, <String>['eth_sendTransaction']);
      expect(wallet.params.single, <Object?>[
        <String, Object?>{'from': alice, 'to': bob, 'value': '0x0'},
      ]);
      wallet.pending.single.complete('0xabc');
      await settle();
      expect(h.last, <String, Object?>{
        'v': 1,
        'source': 'flipper-host',
        'type': 'rpc-result',
        'id': 'tx',
        'result': '0xabc',
      });

      h.rpc('sw', 'wallet_switchEthereumChain', params: <Object?>[
        <String, Object?>{'chainId': '0x1237'},
      ]);
      wallet.pending.last.complete(null);
      await settle();
      final result = h.sentOfType('rpc-result').last;
      expect(result['id'], 'sw');
      expect(result.containsKey('result'), isTrue);
      expect(result['result'], isNull);
    });

    test('non-JSON results become -32603', () async {
      final wallet = ManualWallet(accounts: <String>[alice], chainId: 4663);
      final h = Harness(wallet: wallet)..ready();
      h.rpc('bad', 'eth_sendTransaction', params: <Object?>[<String, Object?>{}]);
      wallet.pending.single.complete(Object());
      await settle();
      expect(h.last['type'], 'rpc-error');
      expect((h.last['error'] as Map<String, dynamic>)['code'], -32603);
    });

    test('wallet errors map to rpc-error with code, message and data',
        () async {
      final wallet = ManualWallet(accounts: <String>[alice], chainId: 4663);
      final h = Harness(wallet: wallet)..ready();
      final cases = <Object, Map<String, Object?>>{
        const FlipperRpcError(4001, 'User rejected the request.', <String, Object?>{
          'reason': 'closed',
        }): <String, Object?>{
          'code': 4001,
          'message': 'User rejected the request.',
          'data': <String, Object?>{'reason': 'closed'},
        },
        const FlipperRpcError(4902, 'Unrecognized chain ID.'):
            <String, Object?>{'code': 4902, 'message': 'Unrecognized chain ID.'},
        FlipperRpcError(4001, 'rejected', Object()): <String, Object?>{
          'code': 4001,
          'message': 'rejected',
        },
        CodedError(4100, 'Locked', <Object?>[1, 2]): <String, Object?>{
          'code': 4100,
          'message': 'Locked',
          'data': <Object?>[1, 2],
        },
        <String, Object?>{'code': 4200, 'message': 'Nope'}: <String, Object?>{
          'code': 4200,
          'message': 'Nope',
        },
        StateError('wallet exploded'): <String, Object?>{
          'code': -32603,
          'message': 'wallet exploded',
        },
        Exception('opaque'): <String, Object?>{
          'code': -32603,
          'message': 'opaque',
        },
        ArgumentError(): <String, Object?>{
          'code': -32603,
          'message': 'Internal error',
        },
        'a thrown string': <String, Object?>{
          'code': -32603,
          'message': 'Internal error',
        },
      };
      var i = 0;
      for (final entry in cases.entries) {
        final id = 'e${i++}';
        h.rpc(id, 'eth_sendTransaction', params: <Object?>[<String, Object?>{}]);
        wallet.pending.last.completeError(entry.key);
        await settle();
        expect(h.last['type'], 'rpc-error', reason: '${entry.key}');
        expect(h.last['id'], id);
        expect(h.last['error'], entry.value, reason: '${entry.key}');
      }
    });

    test('a wallet that throws synchronously is handled', () async {
      final wallet = FlipperCallbackWallet(
        accounts: <String>[alice],
        chainId: 4663,
        onRequest: (String method, Object? params) =>
            throw const FlipperRpcError(4001, 'no'),
      );
      final h = Harness(wallet: wallet)..ready();
      h.rpc('s', 'eth_sendTransaction', params: <Object?>[
        <String, Object?>{'to': bob},
      ]);
      await settle();
      expect(h.last['error'], <String, Object?>{'code': 4001, 'message': 'no'});
    });

    test('replies for a previous page are discarded', () async {
      final wallet = ManualWallet(accounts: <String>[alice], chainId: 4663);
      final h = Harness(wallet: wallet)..ready();
      h.rpc('old', 'eth_sendTransaction', params: <Object?>[<String, Object?>{}]);
      final generation = h.bridge.generation;
      h.bridge.pageLoadStarted();
      expect(h.bridge.generation, generation + 1);
      expect(h.bridge.isReady, isFalse);

      // The new page may reuse the id while the old request is in flight.
      h.ready();
      h.rpc('old', 'eth_sendTransaction', params: <Object?>[<String, Object?>{}]);
      expect(wallet.methods, hasLength(2));

      wallet.pending.first.complete('0xstale');
      await settle();
      expect(
        h.sentOfType('rpc-result').where(
          (Map<String, dynamic> m) => m['result'] == '0xstale',
        ),
        isEmpty,
      );
      wallet.pending.last.complete('0xfresh');
      await settle();
      expect(h.last['result'], '0xfresh');
    });

    test('nothing is sent after dispose', () async {
      final wallet = ManualWallet(accounts: <String>[alice], chainId: 4663);
      final h = Harness(wallet: wallet)..ready();
      h.rpc('d', 'eth_sendTransaction', params: <Object?>[<String, Object?>{}]);
      final before = h.scripts.length;
      h.bridge.dispose();
      wallet.pending.single.complete('0x1');
      wallet.update(chainId: 1);
      h.ready();
      await settle();
      expect(h.scripts.length, before);
    });
  });

  group('queue', () {
    test('RPC answers go out at once; config and wallet wait for ready', () {
      final h = Harness();
      h.rpc('early', 'eth_accounts');
      h.bridge.sendConfig(<String, Object?>{'theme': 'dark'});
      // the embed reads eth_accounts when it mounts, before `ready`
      expect(h.sentOfType('rpc-result'), hasLength(1));
      expect(h.sentOfType('config'), isEmpty);
      expect(h.sentOfType('wallet'), isEmpty);
      h.ready();
      final sent = h.sent;
      expect(sent.map((Map<String, dynamic> m) => m['type']).toList(),
          <String>['rpc-result', 'config', 'wallet']);
      expect(h.sentAtReady, 3, reason: 'onReady runs after the flush');
      expect(sent.last, <String, Object?>{
        'v': 1,
        'source': 'flipper-host',
        'type': 'wallet',
        'accounts': <Object?>[],
        'chainId': '0x1237',
      });
    });

    test('RPC answers are never queued', () {
      final h = Harness();
      for (var i = 0; i < 150; i++) {
        h.rpc('q$i', 'eth_accounts');
      }
      expect(h.bridge.queuedMessageCount, 0);
      final results = h.sentOfType('rpc-result');
      expect(results, hasLength(150));
      expect(results.first['id'], 'q0');
      expect(results.last['id'], 'q149');
    });

    test('config partials merge into one queued message', () {
      final h = Harness();
      h.bridge.sendConfig(<String, Object?>{'theme': 'dark', 'radius': 12});
      h.bridge.sendConfig(<String, Object?>{'theme': 'light', 'accent': '#fff'});
      expect(h.bridge.queuedMessageCount, 1);
      h.ready();
      expect(h.sentOfType('config'), <Map<String, Object?>>[
        <String, Object?>{
          'v': 1,
          'source': 'flipper-host',
          'type': 'config',
          'theme': 'light',
          'radius': 12,
          'accent': '#fff',
        },
      ]);
      h.bridge.sendConfig(<String, Object?>{'locale': 'es'});
      expect(h.last['type'], 'config');
      expect(h.last['locale'], 'es');
    });

    test('config cannot override the envelope and must be JSON', () {
      final h = Harness()..ready();
      h.bridge.sendConfig(<String, Object?>{
        'v': 9,
        'source': 'x',
        'type': 'rpc',
        'theme': 'dark',
      });
      expect(h.last['v'], 1);
      expect(h.last['source'], 'flipper-host');
      expect(h.last['type'], 'config');
      expect(
        () => h.bridge.sendConfig(<String, Object?>{'bad': Object()}),
        throwsA(isA<JsonUnsupportedObjectError>()),
      );
    });

    test('hostConfig goes out after every ready, under live changes', () {
      const house = <String, Object?>{'house': '0x01', 'lens': '0x02'};
      final h = Harness();
      h.bridge.hostConfig = <String, Object?>{
        'rpcUrl': 'https://rpc.example',
        'addresses': house,
        'type': 'wallet', // reserved: dropped
      };
      h.ready();
      expect(h.sent.map((Map<String, dynamic> m) => m['type']).toList(),
          <String>['config', 'wallet']);
      expect(h.sentOfType('config').single, <String, Object?>{
        'v': 1,
        'source': 'flipper-host',
        'type': 'config',
        'rpcUrl': 'https://rpc.example',
        'addresses': house,
      });

      // a reload: sent again, merged under the queued live change
      h.bridge.pageLoadStarted();
      h.bridge.sendConfig(<String, Object?>{
        'rpcUrl': 'https://rpc2.example',
        'theme': 'dark',
      });
      h.ready();
      expect(h.sentOfType('config'), hasLength(2));
      expect(h.sentOfType('config').last, <String, Object?>{
        'v': 1,
        'source': 'flipper-host',
        'type': 'config',
        'rpcUrl': 'https://rpc2.example',
        'addresses': house,
        'theme': 'dark',
      });

      expect(
        () => h.bridge.hostConfig = <String, Object?>{'rpcUrl': Object()},
        throwsA(isA<JsonUnsupportedObjectError>()),
      );
      h.bridge.hostConfig = const <String, Object?>{};
      h.bridge.pageLoadStarted();
      h.ready();
      expect(h.sentOfType('config'), hasLength(2),
          reason: 'none set: none sent');
    });

    test('a new page load keeps queued config', () {
      final h = Harness();
      h.rpc('early', 'eth_accounts');
      h.bridge.sendConfig(<String, Object?>{'theme': 'dark'});
      h.bridge.pageLoadStarted();
      h.ready();
      expect(h.sentOfType('rpc-result'), hasLength(1),
          reason: 'answered before the reload, to the page that asked');
      expect(h.sentOfType('config'), hasLength(1));
    });
  });

  group('wallet state', () {
    test('sent on ready with lowercase hex chain id', () async {
      final wallet = ManualWallet(accounts: <String>[alice], chainId: 31337);
      final h = Harness(wallet: wallet);
      expect(h.scripts, isEmpty);
      h.ready();
      expect(h.sentOfType('wallet').single, <String, Object?>{
        'v': 1,
        'source': 'flipper-host',
        'type': 'wallet',
        'accounts': <Object?>[alice],
        'chainId': '0x7a69',
      });
    });

    test('unknown wallet chain falls back to the configured chain', () {
      final h = Harness(wallet: ManualWallet(accounts: <String>[alice]))
        ..ready();
      expect(h.sentOfType('wallet').single['chainId'], '0x1237');
    });

    test('changes are pushed once, identical states are skipped', () async {
      final wallet = ManualWallet(accounts: <String>[alice], chainId: 4663);
      final h = Harness(wallet: wallet)..ready();
      expect(h.sentOfType('wallet'), hasLength(1));

      wallet.update(accounts: <String>[bob, alice], chainId: 1);
      await settle();
      final wallets = h.sentOfType('wallet');
      expect(wallets, hasLength(2), reason: 'account + chain coalesce');
      expect(wallets.last['accounts'], <Object?>[bob, alice]);
      expect(wallets.last['chainId'], '0x1');

      wallet.update(chainId: 'eip155:1');
      h.bridge.pushWalletState();
      await settle();
      expect(h.sentOfType('wallet'), hasLength(2));

      wallet.update(accounts: const <String>[], chainId: null);
      await settle();
      expect(h.sentOfType('wallet').last, <String, Object?>{
        'v': 1,
        'source': 'flipper-host',
        'type': 'wallet',
        'accounts': <Object?>[],
        'chainId': '0x1237',
      });
    });

    test('wallet updates before ready coalesce to the latest state', () async {
      final wallet = ManualWallet(accounts: <String>[alice], chainId: 4663);
      final h = Harness(wallet: wallet);
      wallet.update(chainId: 1);
      await settle();
      wallet.update(chainId: 10);
      await settle();
      wallet.update(accounts: <String>[bob]);
      await settle();
      expect(h.bridge.queuedMessageCount, 1);
      h.ready();
      final wallets = h.sentOfType('wallet');
      expect(wallets, hasLength(1));
      expect(wallets.single['accounts'], <Object?>[bob]);
      expect(wallets.single['chainId'], '0xa');
    });

    test('swapping or removing the wallet resubscribes and pushes', () async {
      final first = ManualWallet(accounts: <String>[alice], chainId: 4663);
      final second = ManualWallet(accounts: <String>[bob], chainId: 31337);
      final h = Harness(wallet: first)..ready();

      h.bridge.setWallet(second);
      expect(h.sentOfType('wallet').last['accounts'], <Object?>[bob]);
      expect(h.sentOfType('wallet').last['chainId'], '0x7a69');

      final count = h.sentOfType('wallet').length;
      first.update(chainId: 1);
      await settle();
      expect(h.sentOfType('wallet'), hasLength(count), reason: 'old wallet');

      h.bridge.setWallet(null);
      expect(h.sentOfType('wallet').last['accounts'], <Object?>[]);
      expect(h.sentOfType('wallet').last['chainId'], '0x1237');

      h.rpc('after', 'eth_accounts');
      expect(h.last['result'], <Object?>[]);
      expect(second.methods, isEmpty);
    });

    test('a successful chain switch pushes the new state', () async {
      // A wallet that updates its getters but never emits.
      final wallet = SilentWallet();
      final h = Harness(wallet: wallet)..ready();
      expect(h.sentOfType('wallet').last['chainId'], '0x1');
      h.rpc('s', 'wallet_switchEthereumChain', params: <Object?>[
        <String, Object?>{'chainId': '0x1237'},
      ]);
      await settle();
      expect(h.sentOfType('rpc-result').last['id'], 's');
      expect(h.sentOfType('wallet').last['chainId'], '0x1237');
      expect(h.sentOfType('wallet'), hasLength(2));
    });

    test('resending on every ready of a new page', () {
      final h = Harness(wallet: ManualWallet(accounts: <String>[alice]))
        ..ready();
      h.bridge.pageLoadStarted();
      h.ready();
      expect(h.sentOfType('wallet'), hasLength(2));
    });
  });

  group('events', () {
    test('every event reaches onEvent, then its typed callback', () {
      final h = Harness()..ready();
      h.event('connect-request', <String, Object?>{
        'reason': 'flip',
        'partner': 'acme',
      });
      h.event('flip-requested', <String, Object?>{
        'flipId': '12',
        'amount': '1000000000000000000',
        'decimals': 18,
        'winChanceBps': 4500,
        'approveTxHash': null,
        'native': true,
      });
      h.event('flip-settled', <String, Object?>{
        'flipId': '12',
        'outcome': 'won',
        'status': 'WinPending',
        'won': true,
        'pending': true,
        'payout': '2000000000000000000',
        'native': false,
        'extraField': 'kept',
      });
      h.event('payout-resolved', <String, Object?>{
        'flipId': '12',
        'decimals': 18,
        'tokenPaid': '1000000000000000000',
        'flipperPaid': '0',
        'by': 'other',
        'native': true,
        'txHash': null,
      });
      h.event('listing', <String, Object?>{'stage': 'listed', 'token': alice});
      h.event('error', <String, Object?>{
        'code': 'user-rejected',
        'message': 'You rejected the transaction.',
        'context': 'flip',
      });
      h.event('something-new', <String, Object?>{'a': 1});

      expect(h.events.map((FlipperEvent e) => e.name).toList(), <String>[
        'ready',
        'connect-request',
        'flip-requested',
        'flip-settled',
        'payout-resolved',
        'listing',
        'error',
        'something-new',
      ]);
      expect(h.readies, hasLength(1));
      expect(h.connectRequests.single.reason, 'flip');
      expect(h.connectRequests.single.partner, 'acme');
      expect(h.flipRequests.single.decimals, 18);
      expect(h.flipRequests.single.winChanceBps, 4500);
      expect(h.flipRequests.single.approveTxHash, isNull);
      expect(h.flipRequests.single.native, isTrue);
      final settled = h.flipSettles.single;
      expect(settled.outcome, 'won');
      expect(settled.status, 'WinPending');
      expect(settled.won, isTrue);
      expect(settled.pending, isTrue);
      expect(settled.payout, '2000000000000000000');
      expect(settled.native, isFalse);
      expect((settled.raw as Map<String, dynamic>)['extraField'], 'kept');
      final resolved = h.payoutsResolved.single;
      expect(resolved.flipId, '12');
      expect(resolved.decimals, 18);
      expect(resolved.tokenPaid, '1000000000000000000');
      expect(resolved.flipperPaid, '0');
      expect(resolved.by, 'other');
      expect(resolved.native, isTrue);
      expect(resolved.txHash, isNull);
      expect(h.listings.single.stage, 'listed');
      expect(h.errors.single.code, 'user-rejected');
      expect(h.errors.single.context, 'flip');
      final unknown = h.events.last as FlipperUnknownEvent;
      expect(unknown.raw, <String, Object?>{'a': 1});
    });

    test('lenient parsing keeps raw data', () {
      final ready = FlipperEvent.parse('ready', <String, Object?>{
        'version': '0.1.0',
        'chainId': 4663,
        'account': null,
        'variant': 'compact',
      }) as FlipperReadyEvent;
      expect(ready.chainId, 4663);
      expect(ready.account, isNull);
      expect(ready.variant, 'compact');

      final settled = FlipperEvent.parse('flip-settled', <String, Object?>{
        'status': 3,
        'won': 'true',
        'decimals': '6',
        'amount': 1000,
      }) as FlipperFlipSettledEvent;
      expect(settled.status, '3');
      expect(settled.won, isTrue);
      expect(settled.decimals, 6);
      expect(settled.amount, '1000');

      final empty = FlipperEvent.parse('flip-settled', 'not an object')
          as FlipperFlipSettledEvent;
      expect(empty.flipId, isNull);
      expect(empty.raw, 'not an object');
    });

    test('resize: rounded up and clamped; invalid heights ignored', () {
      final h = Harness(minHeight: 120, maxHeight: 700)..ready();
      h.event('resize', <String, Object?>{'width': 360, 'height': 480.2});
      h.event('resize', <String, Object?>{'height': 50});
      h.event('resize', <String, Object?>{'height': 5000});
      h.event('resize', <String, Object?>{'height': 0});
      h.event('resize', <String, Object?>{'height': -10});
      h.event('resize', <String, Object?>{'height': '300'});
      h.event('resize', <String, Object?>{});
      h.event('resize');
      expect(h.heights, <double>[481, 120, 700]);
      expect(h.events.whereType<FlipperResizeEvent>(), hasLength(8));

      final unbounded = Harness()..ready();
      unbounded.event('resize', <String, Object?>{'height': 5000});
      expect(unbounded.heights, <double>[5000]);
    });

    test('a throwing callback is reported and does not break the bridge', () {
      final h = Harness();
      h.bridge.onEvent = (FlipperEvent e) => throw StateError('host bug');
      h.ready();
      expect(h.callbackErrors, hasLength(1));
      expect(h.readies, hasLength(1));
      expect(h.bridge.isReady, isTrue);
      expect(h.sentOfType('wallet'), hasLength(1));
    });
  });

  group('outbound JavaScript', () {
    test('the delivery script matches the protocol', () {
      final bs = String.fromCharCode(0x5C);
      expect(
        buildFlipperDeliveryScript('{"v":1}'),
        '(function(m){try{if(window.FlipperBridge&&typeof window.FlipperBridge'
        '.receive==="function"){window.FlipperBridge.receive(m);}else{window'
        '.postMessage(JSON.parse(m),window.location.origin);}}catch(e){}})'
        '("{$bs"v$bs":1}");true;',
      );
    });

    test('line and paragraph separators are escaped', () {
      final bs = String.fromCharCode(0x5C);
      final input = String.fromCharCodes(<int>[0x61, 0x2028, 0x62, 0x2029]);
      final literal = encodeJsStringLiteral(input);
      expect(literal, '"a${bs}u2028b${bs}u2029"');
      expect(literal.codeUnits, isNot(contains(0x2028)));
      expect(literal.codeUnits, isNot(contains(0x2029)));
      expect(jsonDecode(literal), input);
    });

    test('quotes, backslashes and control characters round-trip', () {
      final bs = String.fromCharCode(0x5C);
      final input = 'a"b${bs}c</script>\n\t${String.fromCharCode(0)}';
      final literal = encodeJsStringLiteral(input);
      expect(literal.startsWith('"'), isTrue);
      expect(literal.endsWith('"'), isTrue);
      expect(jsonDecode(literal), input);
    });

    test('messages carrying separators produce safe scripts', () {
      final h = Harness()..ready();
      h.bridge.sendConfig(<String, Object?>{
        'brandName': String.fromCharCodes(<int>[0x41, 0x2028, 0x42, 0x2029]),
      });
      final js = h.scripts.last;
      expect(js.codeUnits, isNot(contains(0x2028)));
      expect(js.codeUnits, isNot(contains(0x2029)));
      expect(
        decodeScript(js)['brandName'],
        String.fromCharCodes(<int>[0x41, 0x2028, 0x42, 0x2029]),
      );
    });
  });

  group('helpers', () {
    test('normalizeChainId', () {
      expect(normalizeChainId(4663), 4663);
      expect(normalizeChainId(4663.0), 4663);
      expect(normalizeChainId('4663'), 4663);
      expect(normalizeChainId(' 4663 '), 4663);
      expect(normalizeChainId('0x1237'), 4663);
      expect(normalizeChainId('0X1237'), 4663);
      expect(normalizeChainId('eip155:4663'), 4663);
      expect(normalizeChainId('EIP155:31337'), 31337);
      expect(normalizeChainId(BigInt.from(31337)), 31337);
      expect(normalizeChainId(null), isNull);
      expect(normalizeChainId(0), isNull);
      expect(normalizeChainId(-1), isNull);
      expect(normalizeChainId('0x'), isNull);
      expect(normalizeChainId('12abc'), isNull);
      expect(normalizeChainId('-5'), isNull);
      expect(normalizeChainId('solana:mainnet'), isNull);
      expect(normalizeChainId(1.5), isNull);
      expect(normalizeChainId(true), isNull);
      expect(chainIdToHex(4663), '0x1237');
      expect(chainIdToHex(31337), '0x7a69');
      expect(chainIdToHex(1), '0x1');
    });

    test('toFlipperRpcError', () {
      final kept = toFlipperRpcError(const FlipperRpcError(4902, 'x', 1));
      expect(kept.toJson(), <String, Object?>{
        'code': 4902,
        'message': 'x',
        'data': 1,
      });
      final fromDouble =
          toFlipperRpcError(<String, Object?>{'code': 4001.0, 'message': ''});
      expect(fromDouble.code, 4001);
      expect(fromDouble.message, 'Internal error');
      expect(toFlipperRpcError(ArgumentError()).code, -32603);
    });

    test('FlipperWalletBase emits only real changes', () async {
      final wallet = ManualWallet(accounts: <String>[alice], chainId: 4663);
      final accounts = <List<String>>[];
      final chains = <int?>[];
      wallet.accountsChanges.listen(accounts.add);
      wallet.chainIdChanges.listen(chains.add);
      wallet.update(accounts: <String>[alice], chainId: '0x1237');
      await settle();
      expect(accounts, isEmpty);
      expect(chains, isEmpty);
      wallet.update(chainId: 'eip155:1');
      wallet.update(accounts: <String>[bob]);
      await settle();
      expect(chains, <int?>[1]);
      expect(accounts, <List<String>>[
        <String>[bob],
      ]);
      expect(wallet.isConnected, isTrue);
      wallet.update(accounts: const <String>[], chainId: null);
      await settle();
      expect(wallet.isConnected, isFalse);
      expect(wallet.chainId, isNull);
      wallet.dispose();
      expect(wallet.isDisposed, isTrue);
    });
  });
}
