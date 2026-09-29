// Example: the flipper.family widget, themed to the app, with a Reown AppKit
// (WalletConnect) wallet.
//
// Setup:
// 1. `flutter create --platforms=android,ios .` in this folder to generate the
//    platform projects, then apply the Android / iOS notes from the package
//    README (minSdk 24, INTERNET permission, url_launcher queries) and
//    AppKit's deep-link setup (the `flipperexample://` scheme below).
// 2. Get a project id at https://cloud.reown.com and put it in
//    [reownProjectId].
// 3. Optionally point `robinhoodChain` in reown_wallet.dart at your own RPC
//    provider.
//
// `flutter run` loads https://flipper.family/embed on Robinhood Chain.
// `flutter run --dart-define=FLIPPER_LOCAL=true` loads a local `./dev.sh`
// web app on the 31337 fork instead (debug builds only).

import 'package:flipper_family/flipper_family.dart';
import 'package:flutter/material.dart';
import 'package:reown_appkit/reown_appkit.dart';

import 'reown_wallet.dart';

/// Your Reown Cloud project id.
const String reownProjectId = 'YOUR_REOWN_PROJECT_ID';

/// Load the local dev embed (`--dart-define=FLIPPER_LOCAL=true`).
const bool useLocalEmbed = bool.fromEnvironment('FLIPPER_LOCAL');

const Color brandColor = Color(0xFF7C5CFF);

void main() {
  // Register Robinhood Chain with AppKit (older AppKit versions don't list it).
  ReownAppKitModalNetworks.addSupportedNetworks(
    'eip155',
    <ReownAppKitModalNetworkInfo>[robinhoodChain],
  );
  runApp(const FlipperExampleApp());
}

/// The example app.
class FlipperExampleApp extends StatelessWidget {
  /// Creates the app.
  const FlipperExampleApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'flipper.family example',
      themeMode: ThemeMode.system,
      theme: ThemeData(colorSchemeSeed: brandColor),
      darkTheme: ThemeData(
        colorSchemeSeed: brandColor,
        brightness: Brightness.dark,
      ),
      home: const FlipScreen(),
    );
  }
}

/// A screen hosting the flip widget.
class FlipScreen extends StatefulWidget {
  /// Creates the screen.
  const FlipScreen({super.key});

  @override
  State<FlipScreen> createState() => _FlipScreenState();
}

class _FlipScreenState extends State<FlipScreen> {
  late final ReownAppKitModal _appKitModal;
  ReownFlipperWallet? _wallet;
  final FlipperWidgetController _flipper = FlipperWidgetController();
  final Set<String> _announcedFlips = <String>{};
  bool _compact = false;

  @override
  void initState() {
    super.initState();
    _appKitModal = ReownAppKitModal(
      context: context,
      projectId: reownProjectId,
      metadata: const PairingMetadata(
        name: 'flipper.family example',
        description: 'Coin flips on Robinhood Chain',
        url: 'https://flipper.family',
        icons: <String>['https://flipper.family/icon.svg'],
        redirect: Redirect(native: 'flipperexample://'),
      ),
    );
    _initWallet();
  }

  Future<void> _initWallet() async {
    await _appKitModal.init();
    if (!mounted) return;
    // Until this is set the widget runs without a wallet: prices and
    // previews work, and "Connect" arrives as onConnectRequest.
    setState(() => _wallet = ReownFlipperWallet(_appKitModal));
  }

  @override
  void dispose() {
    _wallet?.dispose();
    _appKitModal.dispose();
    super.dispose();
  }

  void _connect() {
    if (_wallet == null) return;
    _appKitModal.openModalView();
  }

  void _toast(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  void _onFlipSettled(FlipperFlipSettledEvent event) {
    // A WinPending flip settles twice; announce the final result once.
    final id = event.flipId;
    if (event.pending == true || id == null || !_announcedFlips.add(id)) {
      return;
    }
    switch (event.outcome) {
      case 'won':
        _toast('You won ${event.symbol ?? ''}!');
      case 'lost':
        _toast('Tails. Better luck next flip.');
      case 'refunded':
        _toast('Flip refunded.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Acme Flips'),
        actions: <Widget>[
          ListenableBuilder(
            listenable: _appKitModal,
            builder: (BuildContext context, Widget? child) => TextButton(
              onPressed: _wallet == null ? null : _connect,
              child: Text(_appKitModal.isConnected ? 'Wallet' : 'Connect'),
            ),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          FlipperWidget(
            controller: _flipper,
            wallet: _wallet,
            baseUrl: useLocalEmbed
                ? FlipperWidget.localDevBaseUrl
                : kFlipperEmbedUrl,
            config: FlipperConfig(
              chain: useLocalEmbed ? kFlipperLocalChainId : kFlipperDefaultChainId,
              partner: 'acme-flutter',
              compact: _compact,
              extra: const <String, Object?>{
                'brandName': 'Acme Flips',
                'approval': 'exact',
              },
            ),
            // Follows the app's light / dark mode live, without a reload.
            theme: FlipperTheme(
              mode: dark ? FlipperThemeMode.dark : FlipperThemeMode.light,
              accent: FlipperTheme.accentFromArgb(brandColor.toARGB32()),
              radius: 20,
            ),
            placeholder: const Center(child: CircularProgressIndicator()),
            onConnectRequest: (FlipperConnectRequestEvent event) => _connect(),
            onFlipRequested: (FlipperFlipRequestedEvent event) =>
                _toast('Flipping...'),
            onFlipSettled: _onFlipSettled,
            onError: (FlipperErrorEvent event) {
              if (event.code == 'user-rejected') return;
              _toast(event.message ?? 'Something went wrong (${event.code}).');
            },
            onEvent: (FlipperEvent event) =>
                debugPrint('flipper: ${event.name} ${event.raw}'),
          ),
          const SizedBox(height: 16),
          SwitchListTile(
            title: const Text('Compact layout'),
            value: _compact,
            onChanged: (bool value) => setState(() => _compact = value),
          ),
          ListTile(
            title: const Text('Spanish strings'),
            subtitle: const Text('Live config through the controller'),
            onTap: () => _flipper.setConfig(<String, Object?>{'locale': 'es'}),
          ),
          ListTile(
            title: const Text('Reload the widget'),
            onTap: _flipper.reload,
          ),
        ],
      ),
    );
  }
}
