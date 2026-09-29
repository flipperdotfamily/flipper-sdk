/// Drop-in, white-label flipper.family coin-flip widget for Flutter.
///
/// [FlipperWidget] loads the hosted embed in a WebView and routes the
/// embed's wallet requests to the [FlipperWallet] your app supplies. See the
/// package README for wiring, theming and security notes.
library;

export 'src/bridge.dart'
    show
        FlipperBridge,
        FlipperJsEvaluator,
        buildFlipperDeliveryScript,
        encodeJsStringLiteral,
        kFlipperBridgeVersion,
        kFlipperDeliveryPrefix,
        kFlipperDeliverySuffix,
        kFlipperMaxMessageLength,
        kFlipperMaxQueuedMessages,
        kFlipperBatchCallMethods,
        kFlipperBridgeMethods,
        kFlipperRpcMethods,
        kFlipperSdkVersion,
        narrowFlipperMethods,
        toFlipperRpcError;
export 'src/chain.dart';
export 'src/config.dart';
export 'src/events.dart';
export 'src/url.dart';
export 'src/wallet.dart';
export 'src/widget.dart';
